import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { mkdir, copyFile, readdir, unlink } from "node:fs/promises";

const require = createRequire(import.meta.url);
const source = dirname(require.resolve("onnxruntime-web"));
const destination = new URL("../public/ort/", import.meta.url);
await mkdir(destination, { recursive: true });
for (const file of await readdir(destination)) {
  if (file.startsWith("ort-wasm-")) await unlink(new URL(file, destination));
}
// Serve matching WASM + loader locally. No runtime CDN code or special host needed.
for (const file of [
  "ort-wasm-simd-threaded.asyncify.wasm",
  "ort-wasm-simd-threaded.asyncify.mjs",
]) {
  await copyFile(join(source, file), new URL(file, destination));
}
