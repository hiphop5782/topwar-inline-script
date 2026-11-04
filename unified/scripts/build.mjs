import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const metadata = await readFile(path.join(root, "src", "metadata.txt"), "utf8");

await mkdir(path.join(root, "dist"), { recursive: true });

await build({
  entryPoints: [path.join(root, "src", "main.js")],
  outfile: path.join(root, "dist", "topwar-unified-alpha.user.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: ["es2022"],
  charset: "utf8",
  legalComments: "none",
  banner: { js: metadata.trimEnd() },
  sourcemap: false,
  minify: false
});

console.log("Built dist/topwar-unified-alpha.user.js");
