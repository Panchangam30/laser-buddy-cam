/**
 * Where every CAD source comes from, and a download cache in front of it.
 *
 * Nothing here is hand-made: the Uno is Arduino's own released board file, the
 * parts are KiCad's library models, and the servo is from FreeCAD's parts
 * library. All are pinned so a rebuild next year produces the same meshes, and
 * public/models/CREDITS.md carries the attribution their licences ask for.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const WEB = resolve(here, "../..");
export const CACHE = join(WEB, ".model-cache");
export const OUT = join(WEB, "public/models");

/** KiCad library release the part models and footprints are taken from. */
export const KICAD_REF = "10.0.7";

const ARDUINO_UNO_ZIP =
  "https://raw.githubusercontent.com/arduino/docs-content/main/content/hardware/uno/boards/uno-rev3/downloads/A000066-cad-files.zip";

async function cached(url, name) {
  const path = join(CACHE, name);
  if (existsSync(path)) return readFile(path);
  await mkdir(CACHE, { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(path, buf);
  process.stdout.write(`  fetched ${name}\n`);
  return buf;
}

/** A KiCad 3D model, as STEP. `lib` is the library name without ".3dshapes". */
export function kicadModel(lib, name) {
  return cached(
    `https://gitlab.com/kicad/libraries/kicad-packages3D/-/raw/${KICAD_REF}/${lib}.3dshapes/${encodeURIComponent(name)}.step`,
    `${name}.step`,
  );
}

/** A KiCad footprint, for its pad positions. `lib` is without ".pretty". */
export async function kicadFootprint(lib, name) {
  const buf = await cached(
    `https://gitlab.com/kicad/libraries/kicad-footprints/-/raw/${KICAD_REF}/${lib}.pretty/${encodeURIComponent(name)}.kicad_mod`,
    `${name}.kicad_mod`,
  );
  return buf.toString("utf8");
}

/** FreeCAD parts library commit the SG90 servo is taken from (CC-BY 3.0). */
export const FREECAD_LIBRARY_REF = "6f071a4bab37fff7784092548e6dbff21499b751";

/** A STEP file from FreeCAD's parts library, by its path in that repository. */
export function freecadPart(path) {
  return cached(
    `https://raw.githubusercontent.com/FreeCAD/FreeCAD-library/${FREECAD_LIBRARY_REF}/${path.split("/").map(encodeURIComponent).join("/")}`,
    `freecad-${path.split("/").pop()}`,
  );
}

/** Arduino's released Eagle board file for the Uno R3 (A000066, Rev3e). */
export async function arduinoUnoBoard() {
  await cached(ARDUINO_UNO_ZIP, "A000066-cad-files.zip");
  return execFileSync("unzip", ["-p", join(CACHE, "A000066-cad-files.zip"),
    "A000066-cad-files/UNO-TH_Rev3e.brd"], { maxBuffer: 64 << 20 }).toString("utf8");
}
