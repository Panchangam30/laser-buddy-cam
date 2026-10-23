/**
 * STEP in, GLB out.
 *
 * Geometry from every source is baked into one coordinate frame and merged per
 * material, so a whole Uno -- a hundred-odd parts -- is a dozen draw calls
 * rather than a thousand. The runtime never needs to address an individual
 * capacitor, so nothing is lost by flattening.
 */
import * as THREE from "three";
import occtImport from "occt-import-js";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRMaterialsClearcoat } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, quantize, weld } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";

let occt;

/**
 * Tessellate a STEP file. Returns one entry per distinct face colour, in the
 * model's own frame (KiCad: millimetres, Z up, Z=0 on the board surface).
 * Colours are linear RGB -- OpenCascade converts STEP's sRGB on read.
 */
export async function readStep(buf, deflection = 0.03) {
  occt ??= await occtImport();
  const r = occt.ReadStepFile(new Uint8Array(buf), {
    linearUnit: "millimeter",
    linearDeflectionType: "absolute_value",
    linearDeflection: deflection,
    angularDeflection: 0.35,
  });
  if (!r.success) throw new Error("STEP import failed");
  const byColor = new Map();
  for (const m of r.meshes) {
    const pos = m.attributes.position.array;
    const nrm = m.attributes.normal?.array;
    const idx = m.index.array;
    const faces = m.brep_faces?.length
      ? m.brep_faces
      : [{ first: 0, last: idx.length / 3 - 1, color: m.color }];
    for (const f of faces) {
      const color = f.color ?? m.color ?? [0.5, 0.5, 0.5];
      const key = color.map((c) => c.toFixed(3)).join(",");
      if (!byColor.has(key)) byColor.set(key, { color, tris: [] });
      const bucket = byColor.get(key);
      for (let t = f.first; t <= f.last; t++) {
        for (let k = 0; k < 3; k++) {
          const v = idx[t * 3 + k];
          bucket.tris.push(
            pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2],
            nrm ? nrm[v * 3] : 0, nrm ? nrm[v * 3 + 1] : 0, nrm ? nrm[v * 3 + 2] : 1,
          );
        }
      }
    }
  }
  return [...byColor.values()].map(({ color, tris }) => {
    const n = tris.length / 6;
    const positions = new Float32Array(n * 3);
    const normals = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      positions.set(tris.slice(i * 6, i * 6 + 3), i * 3);
      normals.set(tris.slice(i * 6 + 3, i * 6 + 6), i * 3);
    }
    return { color, positions, normals };
  });
}

/** Axis-aligned bounds of meshes returned by readStep. */
export function stepBounds(parts) {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const p of parts) {
    for (let i = 0; i < p.positions.length; i += 3) box.expandByPoint(v.fromArray(p.positions, i));
  }
  return box;
}

/**
 * Accumulates triangles per material in a single frame, then writes a GLB.
 * Materials are plain objects: { name, color (linear), metalness, roughness,
 * map?, clearcoat?, opacity?, emissive? }, keyed by name.
 */
export class Builder {
  constructor() {
    this.buckets = new Map();
  }

  bucket(mat) {
    if (!this.buckets.has(mat.name)) {
      this.buckets.set(mat.name, { mat, pos: [], nrm: [], uv: [] });
    }
    return this.buckets.get(mat.name);
  }

  /** Add non-indexed triangles, transformed by `matrix`. */
  addTriangles(positions, normals, matrix, mat, uvs) {
    const b = this.bucket(mat);
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    // A mirroring matrix flips winding; undo it so faces stay outward.
    const flip = matrix.determinant() < 0;
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let t = 0; t < positions.length / 9; t++) {
      const order = flip ? [0, 2, 1] : [0, 1, 2];
      for (const k of order) {
        const i = t * 3 + k;
        p.fromArray(positions, i * 3).applyMatrix4(matrix);
        n.fromArray(normals, i * 3).applyMatrix3(nm).normalize();
        b.pos.push(p.x, p.y, p.z);
        b.nrm.push(n.x, n.y, n.z);
        if (uvs) b.uv.push(uvs[i * 2], uvs[i * 2 + 1]);
      }
    }
  }

  /** Add the parts of a STEP model, each coloured part mapped to a material. */
  addStep(parts, matrix, materialFor) {
    for (const part of parts) {
      const mat = materialFor(part.color);
      if (mat) this.addTriangles(part.positions, part.normals, matrix, mat);
    }
  }

  /** Add a three.js geometry. `mats` is one material, or one per geometry group. */
  addGeometry(geometry, matrix, mats) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (!g.attributes.normal) g.computeVertexNormals();
    const pos = g.attributes.position.array;
    const nrm = g.attributes.normal.array;
    const uv = g.attributes.uv?.array;
    const groups = g.groups.length ? g.groups : [{ start: 0, count: pos.length / 3, materialIndex: 0 }];
    for (const grp of groups) {
      const mat = Array.isArray(mats) ? mats[grp.materialIndex] : mats;
      if (!mat) continue;
      const s = grp.start, e = grp.start + grp.count;
      this.addTriangles(pos.subarray(s * 3, e * 3), nrm.subarray(s * 3, e * 3), matrix, mat,
        mat.map && uv ? uv.subarray(s * 2, e * 2) : undefined);
    }
  }

  bounds() {
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (const b of this.buckets.values()) {
      for (let i = 0; i < b.pos.length; i += 3) box.expandByPoint(v.fromArray(b.pos, i));
    }
    return box;
  }

  translate(dx, dy, dz) {
    for (const b of this.buckets.values()) {
      for (let i = 0; i < b.pos.length; i += 3) {
        b.pos[i] += dx; b.pos[i + 1] += dy; b.pos[i + 2] += dz;
      }
    }
  }

  triangleCount() {
    let n = 0;
    for (const b of this.buckets.values()) n += b.pos.length / 9;
    return n;
  }

  async writeGlb(path, nodeName) {
    const doc = new Document();
    const buffer = doc.createBuffer();
    const mesh = doc.createMesh(nodeName);
    const clearcoat = doc.createExtension(KHRMaterialsClearcoat);
    const textures = new Map();
    for (const { mat, pos, nrm, uv } of this.buckets.values()) {
      if (!pos.length) continue;
      const m = doc.createMaterial(mat.name)
        .setBaseColorFactor([...mat.color, mat.opacity ?? 1])
        .setMetallicFactor(mat.metalness ?? 0)
        .setRoughnessFactor(mat.roughness ?? 0.5);
      if (mat.opacity !== undefined && mat.opacity < 1) m.setAlphaMode("BLEND");
      if (mat.emissive) m.setEmissiveFactor(mat.emissive);
      if (mat.doubleSided) m.setDoubleSided(true);
      if (mat.clearcoat) {
        m.setExtension("KHR_materials_clearcoat", clearcoat.createClearcoat()
          .setClearcoatFactor(mat.clearcoat).setClearcoatRoughnessFactor(mat.clearcoatRoughness ?? 0.25));
      }
      if (mat.map) {
        if (!textures.has(mat.map)) {
          textures.set(mat.map, doc.createTexture(`${mat.name}-map`)
            .setImage(mat.map).setMimeType(mat.mapType ?? "image/png"));
        }
        m.setBaseColorTexture(textures.get(mat.map));
      }
      const prim = doc.createPrimitive()
        .setMaterial(m)
        .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setBuffer(buffer)
          .setArray(new Float32Array(pos)))
        .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setBuffer(buffer)
          .setArray(new Float32Array(nrm)));
      if (mat.map && uv.length) {
        prim.setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setBuffer(buffer)
          .setArray(new Float32Array(uv)));
      }
      mesh.addPrimitive(prim);
    }
    doc.createScene().addChild(doc.createNode(nodeName).setMesh(mesh));
    await MeshoptEncoder.ready;
    await doc.transform(
      weld(),
      dedup(),
      prune(),
      quantize({ quantizePosition: 14, quantizeNormal: 10 }),
      meshopt({ encoder: MeshoptEncoder, level: "medium" }),
    );
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
    await io.write(path, doc);
  }
}

/** sRGB hex to the linear triple glTF expects. */
export function linear(hex) {
  const c = new THREE.Color(hex);       // three converts hex (sRGB) to linear
  return [c.r, c.g, c.b];
}
