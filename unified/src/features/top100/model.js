function randomId(prefix) {
  const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

export function createTop100Session(serverId, serverContext) {
  const numericServerId = Number(serverId);
  const runId = randomId("top100-run");
  return {
    schemaVersion: 2,
    runId,
    batchId: runId,
    requestIds: {
      server: randomId("top100-server"),
      complete: randomId("top100-complete")
    },
    serverId: numericServerId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    serverContext,
    players: null,
    alliances: null,
    captures: {},
    validation: null,
    upload: {
      serverAcknowledged: false,
      completed: false,
      lastError: null
    }
  };
}

export function buildTop100Payload(session) {
  const players = Array.isArray(session.players) ? session.players : [];
  const alliances = Array.isArray(session.alliances) ? session.alliances : [];
  const researchTime = Date.parse(session.updatedAt || session.createdAt) || Date.now();
  return {
    schemaVersion: 2,
    source: "topwar-unified-alpha",
    runId: session.runId,
    batchId: session.batchId,
    batchIndex: 1,
    batchTotal: 1,
    batchCompleted: true,
    serverId: Number(session.serverId),
    serverNumber: Number(session.serverId),
    server: Number(session.serverId),
    researchTime,
    exportedAt: new Date(researchTime).toISOString(),
    playerList: players,
    allianceList: alliances,
    summary: {
      players: players.length,
      alliances: alliances.length,
      uniquePlayers: new Set(players.map(row => row.uid).filter(Boolean)).size,
      totalPlayerPower: players.reduce((sum, row) => sum + Number(row.cp || 0), 0),
      totalAlliancePower: alliances.reduce((sum, row) => sum + Number(row.cp || 0), 0)
    }
  };
}
