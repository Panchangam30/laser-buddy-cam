/**
 * Build the realistic part models in public/models from their CAD sources.
 *
 *   npm run models
 *
 * Downloads are cached in .model-cache, so only the first run needs a network.
 * The output is committed, like the part thumbnails: the app never fetches
 * anything at runtime that this script did not already check.
 */
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { OUT } from "./sources.mjs";
import { buildUno } from "./uno.mjs";
import { buildKit } from "./kit.mjs";
import { buildServo } from "./servo.mjs";
import { closeRasterizer } from "./raster.mjs";

await mkdir(OUT, { recursive: true });
const only = process.argv[2];
const kb = async (f) => `${((await stat(join(OUT, f))).size / 1024).toFixed(0)} KB`;

try {
  if (!only || only === "uno") {
    const uno = await buildUno();
    if (process.env.VERBOSE) console.log(uno.report.join("\n"), "\n", uno.materials.join(" "));
    console.log(`uno-r3.glb        ${uno.triangles} triangles, ${await kb("uno-r3.glb")}`);
  }
  if (!only || only === "kit") {
    for (const line of await buildKit()) console.log(line);
  }
  if (!only || only === "servo") console.log(await buildServo());
} finally {
  await closeRasterizer();
}
