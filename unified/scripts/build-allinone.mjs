import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";

const unifiedRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(unifiedRoot, "..");
const dist = path.join(unifiedRoot, "dist");

const metadata = `// ==UserScript==
// @name         TopWar All-in-One UI
// @namespace    https://github.com/hiphop5782/topwar-inline-script
// @version      0.2.6
// @description  Existing TopWar tools connected through one component-based UI
// @match        https://h5.topwargame.com/*
// @match        https://h5v2.topwargame.com/*
// @match        https://*.topwargame.com/*
// @match        https://*.topwarapp.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==`;

function stripMetadata(source) {
  return source.replace(/^\s*\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/, "");
}

const coreSource = stripMetadata(await readFile(
  path.join(repoRoot, "tampermonkey", "worldmap-scanner", "worldmap-scanner-latest.js"),
  "utf8"
));

const modules = [
  ["characterTools", "information/auto-scraping-with-ui.js"],
  ["crossPvp", "warzone/research-latest.js"],
  ["train", "train-scraper/train-scraper-latest.js"],
  ["kartz", "kartz/kartz-recorder.js"],
  ["htChip", "ht-chip-collector/ht-chil-collector-latest.js"],
  ["heroImages", "hero/image-scraper.js"],
  ["energyDefense", "ssc2/energy-defense.js"],
  ["mammothDefense", "ssc2/mammoth-live-garrison.js"],
  ["mammothScore", "ssc2/mammoth-cumulative-score.js"],
  ["trainMembers", "ssc2/train-members.js"],
  ["sealRanks", "ssc2/seal-rank-reader.js"],
  ["wlbRanks", "ssc2/wlb-rank-inspector.js"],
  ["neutralCityRanks", "ssc2/neutral-city-rank-reader.js"],
  ["meritHistory", "cq26-merit-history-exporter/cq26-merit-history-exporter.js"],
  ["guildAudit", "el-contribution-checker/el-contribution-checker-ui.min.js"]
];

const installerEntries = [];
for (const [id, relativePath] of modules) {
  const source = stripMetadata(await readFile(path.join(repoRoot, relativePath), "utf8"));
  installerEntries.push(`${JSON.stringify(id)}: function install_${id}() {\n${source}\n}`);
}

const installerRegistry = `
;(() => {
  "use strict";
  const installers = {${installerEntries.join(",\n")}};
  Object.defineProperty(window, "__TOPWAR_ALLINONE_INSTALLERS__", {
    value: Object.freeze(installers), configurable: true
  });
})();`;

const uiBuild = await build({
  entryPoints: [path.join(unifiedRoot, "src", "integration-ui", "main.js")],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: ["es2022"],
  charset: "utf8",
  legalComments: "none",
  minify: false,
  write: false
});

await mkdir(dist, { recursive: true });
const output = [
  metadata,
  "\n/* Existing worldmap scanner: preserved source */\n",
  coreSource,
  "\n/* Lazy legacy module installers: preserved source */\n",
  installerRegistry,
  "\n/* Unified UI integration layer */\n",
  uiBuild.outputFiles[0].text
].join("\n");

await writeFile(path.join(dist, "topwar-allinone.user.js"), output, "utf8");
console.log(`Built dist/topwar-allinone.user.js (${output.length} chars)`);
