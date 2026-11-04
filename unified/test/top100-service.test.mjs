import test from "node:test";
import assert from "node:assert/strict";
import { Top100Service } from "../src/features/top100/service.js";

class MemoryRepository {
  rows = new Map();
  async save(value) {
    const saved = structuredClone({ ...value, updatedAt: new Date().toISOString() });
    this.rows.set(saved.runId, saved);
    return saved;
  }
  async get(runId) { return this.rows.get(runId) || null; }
  async list() { return [...this.rows.values()]; }
}

function playerRows(serverId) {
  return Array.from({ length: 100 }, (_, index) => ({
    rank: index + 1,
    uid: String(100000 + index),
    serverId,
    power: 1000000 - index,
    val: 1000 - index,
    playerInfo: JSON.stringify({ username: `P${index + 1}` })
  }));
}

function allianceRows(serverId) {
  return Array.from({ length: 10 }, (_, index) => ({
    rank: index + 1,
    aid: String(900000 + index),
    serverId,
    cp: 1000000 - index,
    name: `A${index + 1}`
  }));
}

test("uploads the server payload before completing the batch", async () => {
  const calls = [];
  const adapter = {
    kind: "players",
    activeComponent(name) { return name === "WorldServerTheaterPanel" ? { node: {} } : null; },
    detectServerContext(serverId) {
      return { verified: true, expectedServerId: Number(serverId), exact: { serverId: Number(serverId) } };
    },
    rankComponent() {
      const rows = this.kind === "players" ? playerRows(3223) : allianceRows(3223);
      return { kind: this.kind, component: { _rankList: rows } };
    }
  };
  const uploader = {
    async uploadServer(payload, id) {
      calls.push({ type: "server", payload, id });
      return { ok: true, response: { accepted: true } };
    },
    async completeBatch(payload, id) {
      calls.push({ type: "complete", payload, id });
      return { ok: true, response: { completed: true } };
    }
  };
  const service = new Top100Service({
    adapter,
    repository: new MemoryRepository(),
    uploader,
    logger: { info() {} }
  });

  await service.start(3223);
  await service.captureActiveRank();
  adapter.kind = "alliances";
  await service.captureActiveRank();
  const validation = await service.validate();
  assert.equal(validation.ok, true);

  const upload = await service.upload();
  assert.equal(upload.serverAcknowledged, true);
  assert.equal(upload.completed, true);
  assert.deepEqual(calls.map(row => row.type), ["server", "complete"]);
  assert.equal(calls[0].payload.playerList.length, 100);
  assert.equal(calls[0].payload.allianceList.length, 10);
  assert.equal(calls[1].payload.expectedServers, 1);
});

test("refuses to start when the visible server cannot be verified", async () => {
  const service = new Top100Service({
    adapter: {
      activeComponent() { return { node: {} }; },
      detectServerContext() { return { verified: false, detectedServerIds: [3222] }; }
    },
    repository: new MemoryRepository(),
    uploader: {},
    logger: { info() {} }
  });

  await assert.rejects(() => service.start(3223), error => error.code === "SERVER_UNVERIFIED");
});

test("opens, captures, and closes both rank panels semantically", async () => {
  const steps = [];
  const adapter = {
    kind: null,
    activeComponent(name) { return name === "WorldServerTheaterPanel" ? { node: {} } : null; },
    detectServerContext(serverId) {
      return { verified: true, expectedServerId: Number(serverId), exact: { serverId: Number(serverId) } };
    },
    async openRank(kind) { this.kind = kind; steps.push(`open:${kind}`); },
    async waitForRankRows(kind, required) { steps.push(`wait:${kind}:${required}`); return { count: required, elapsedMs: 1 }; },
    rankComponent() {
      return {
        kind: this.kind,
        component: { _rankList: this.kind === "players" ? playerRows(3223) : allianceRows(3223) }
      };
    },
    async closeRank(kind) { steps.push(`close:${kind}`); this.kind = null; }
  };
  const service = new Top100Service({
    adapter,
    repository: new MemoryRepository(),
    uploader: {},
    logger: { info() {} }
  });
  await service.start(3223);
  const result = await service.collectRanksAutomatically();
  assert.equal(result.ok, true);
  assert.deepEqual(steps, [
    "open:players", "wait:players:100", "close:players",
    "open:alliances", "wait:alliances:10", "close:alliances"
  ]);
});
