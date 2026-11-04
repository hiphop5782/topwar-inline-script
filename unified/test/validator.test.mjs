import test from "node:test";
import assert from "node:assert/strict";
import { validateTop100Session } from "../src/features/top100/validator.js";
import { buildTop100Payload } from "../src/features/top100/model.js";
import { mapPlayerRow, mapAllianceRow } from "../src/features/top100/row-mapper.js";

function validSession() {
  return {
    runId: "run-1",
    batchId: "run-1",
    serverId: 3223,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:01:00.000Z",
    serverContext: { verified: true },
    players: Array.from({ length: 100 }, (_, index) => ({
      rank: index + 1,
      uid: String(100000 + index),
      cp: 1000000 - index,
      server: 3223,
      nickname: `P${index + 1}`
    })),
    alliances: Array.from({ length: 10 }, (_, index) => ({
      rank: index + 1,
      aid: String(9007199254740993n + BigInt(index)),
      cp: 1000000 - index,
      server: 3223
    }))
  };
}

test("validates a complete and server-matched TOP100 session", () => {
  const result = validateTop100Session(validSession());
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.metrics.uniquePlayerUids, 100);
});

test("blocks duplicate UIDs and non-normalized target servers", () => {
  const session = validSession();
  session.players[1].uid = session.players[0].uid;
  session.players[2].server = 3222;
  const result = validateTop100Session(session);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(row => row.code === "PLAYER_UID_DUPLICATED"));
  assert.ok(result.errors.some(row => row.code === "PLAYER_SERVER_MISMATCH"));
});

test("blocks an unverified server context", () => {
  const session = validSession();
  session.serverContext.verified = false;
  const result = validateTop100Session(session);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(row => row.code === "SERVER_UNVERIFIED"));
});

test("payload preserves ranks, string IDs, and research time", () => {
  const session = validSession();
  const payload = buildTop100Payload(session);
  assert.equal(payload.playerList[0].rank, 1);
  assert.equal(typeof payload.allianceList[0].aid, "string");
  assert.equal(payload.researchTime, Date.parse(session.updatedAt));
  assert.equal(payload.summary.uniquePlayers, 100);
});

test("maps playerInfo JSON without converting identifiers to numbers", () => {
  const player = mapPlayerRow({
    rank: 1,
    uid: "90071992547409931234",
    serverId: 9999,
    power: 123456,
    val: 456,
    allianceId: "90071992547409931235",
    playerInfo: JSON.stringify({ username: "Tester", nationalflag: 82 })
  }, 0, 3223);
  assert.equal(player.uid, "90071992547409931234");
  assert.equal(player.allianceId, "90071992547409931235");
  assert.equal(player.nickname, "Tester");
  assert.equal(player.cp, 123456);
  assert.equal(player.server, 3223);
  assert.equal(player.serverId, "3223");

  const alliance = mapAllianceRow({
    rank: 1,
    aid: "90071992547409931235",
    serverId: 9999,
    name: "Guild",
    cp: 999999
  }, 0, 3223);
  assert.equal(alliance.aid, "90071992547409931235");
  assert.equal(alliance.server, 3223);
  assert.equal(alliance.serverId, "3223");
});
