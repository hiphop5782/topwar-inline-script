import test from "node:test";
import assert from "node:assert/strict";
import { extractServerMatches } from "../src/adapters/cocos-adapter.js";

test("recognizes the observed Warzone and short server labels", () => {
  const matches = extractServerMatches([
    { text: "Warzone#2820", path: "HEADER/TITLE" },
    { text: "S4477", path: "minimap/serverLabel" },
    { text: "[S005] player", path: "nameLabel" }
  ]);
  assert.deepEqual(matches.map(row => row.serverId), [2820, 4477]);
});
