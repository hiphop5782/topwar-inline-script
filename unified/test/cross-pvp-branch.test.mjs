import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(
  new URL("../../warzone/research-latest.js", import.meta.url),
  "utf8"
);

const start = source.indexOf("    const ARMY =");
const end = source.indexOf("    const heroName", start);

assert.notEqual(start, -1, "병종 판정 코드 시작점을 찾지 못했습니다.");
assert.notEqual(end, -1, "병종 판정 코드 끝점을 찾지 못했습니다.");

const context = {};
runInNewContext(
  `const clone = value => JSON.parse(JSON.stringify(value));\n` +
  source.slice(start, end) +
  `\nglobalThis.branchApi = { detectTroopBranch, buildBranches };`,
  context
);

const { detectTroopBranch, buildBranches } = context.branchApi;

test("uses Cross PVP armyType before legacy hero inference", () => {
  assert.equal(detectTroopBranch({ armyType: 101, firstHeroId: 338 }), "army");
  assert.equal(detectTroopBranch({ armyType: 201 }), "navy");
  assert.equal(detectTroopBranch({ armyType: 301 }), "air");
});

test("falls back to detailed troop IDs when rank metadata is missing", () => {
  assert.equal(detectTroopBranch({
    armyType: null,
    firstHeroId: null,
    formations: [{ armyById: { 10103: 4200 }, heroes: [] }]
  }), "army");

  assert.equal(detectTroopBranch({
    formations: [{ armyList: [{ armyId: 504531, armyNum: 3500 }] }]
  }), "navy");

  assert.equal(detectTroopBranch({
    formations: [{ slots: [{ armyId: 905103, count: 3200 }] }]
  }), "air");
});

test("builds the DataHub branch record for the reported failing UID", () => {
  const player = {
    uid: "165132791975",
    armyType: 101,
    firstHeroId: 170,
    rankingPower: 123456789,
    totalArmy: 4200,
    collectedAt: "2026-11-11T00:00:00.000Z",
    formations: [{ heroes: [{ id: 170 }], totalArmy: 4200 }]
  };

  const branches = buildBranches(player);

  assert.equal(branches.navy, null);
  assert.equal(branches.air, null);
  assert.equal(branches.army.power, 123456789);
  assert.equal(branches.army.totalArmy, 4200);
  assert.deepEqual(
    JSON.parse(JSON.stringify(branches.army.formations)),
    player.formations
  );
});
