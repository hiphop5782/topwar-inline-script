function issue(code, message, details = null) {
  return { code, message, details };
}

function finitePositive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

export function validateTop100Session(session, options = {}) {
  const requiredPlayers = Number(options.requiredPlayers ?? 100);
  const requiredAlliances = Number(options.requiredAlliances ?? 10);
  const errors = [];
  const warnings = [];
  const players = Array.isArray(session?.players) ? session.players : [];
  const alliances = Array.isArray(session?.alliances) ? session.alliances : [];
  const targetServer = Number(session?.serverId);

  if (!session?.serverContext?.verified) {
    errors.push(issue("SERVER_UNVERIFIED", "화면에서 대상 서버를 확인하지 못했습니다."));
  }
  if (players.length < requiredPlayers) {
    errors.push(issue("PLAYERS_INCOMPLETE", `개인 랭킹이 ${players.length}/${requiredPlayers}개입니다.`));
  }
  if (alliances.length < requiredAlliances) {
    errors.push(issue("ALLIANCES_INCOMPLETE", `길드 랭킹이 ${alliances.length}/${requiredAlliances}개입니다.`));
  }

  const playerUids = players.map(row => row.uid).filter(Boolean);
  const uniqueUids = new Set(playerUids);
  if (playerUids.length !== players.length) {
    errors.push(issue("PLAYER_UID_MISSING", `${players.length - playerUids.length}명의 UID가 없습니다.`));
  }
  if (uniqueUids.size !== playerUids.length) {
    errors.push(issue("PLAYER_UID_DUPLICATED", `${playerUids.length - uniqueUids.size}개의 UID가 중복됩니다.`));
  }

  const invalidPlayerPower = players.filter(row => !finitePositive(row.cp));
  if (invalidPlayerPower.length) {
    errors.push(issue("PLAYER_POWER_INVALID", `${invalidPlayerPower.length}명의 CP가 비정상입니다.`));
  }
  const mismatchedPlayers = players.filter(row =>
    finitePositive(row.server) && Number(row.server) !== targetServer
  );
  if (mismatchedPlayers.length) {
    errors.push(issue(
      "PLAYER_SERVER_MISMATCH",
      `${mismatchedPlayers.length}명의 정규화 서버가 Theater 대상 서버와 다릅니다.`,
      mismatchedPlayers.slice(0, 10).map(row => ({ uid: row.uid, server: row.server }))
    ));
  }

  const playerRanks = players.map(row => Number(row.rank)).filter(Number.isFinite);
  if (new Set(playerRanks).size !== playerRanks.length) {
    warnings.push(issue("PLAYER_RANK_DUPLICATED", "개인 랭킹 번호가 중복됩니다."));
  }
  const missingNames = players.filter(row => !row.nickname).length;
  if (missingNames) warnings.push(issue("PLAYER_NAME_MISSING", `${missingNames}명의 닉네임이 없습니다.`));

  const allianceIds = alliances.map(row => row.aid).filter(Boolean);
  if (allianceIds.length && new Set(allianceIds).size !== allianceIds.length) {
    errors.push(issue("ALLIANCE_ID_DUPLICATED", "길드 ID가 중복됩니다."));
  }
  const invalidAlliancePower = alliances.filter(row => !finitePositive(row.cp));
  if (invalidAlliancePower.length) {
    warnings.push(issue("ALLIANCE_POWER_INVALID", `${invalidAlliancePower.length}개 길드의 CP가 비정상입니다.`));
  }

  return {
    ok: errors.length === 0,
    checkedAt: new Date().toISOString(),
    requirements: { players: requiredPlayers, alliances: requiredAlliances },
    metrics: {
      players: players.length,
      alliances: alliances.length,
      uniquePlayerUids: uniqueUids.size,
      invalidPlayerPower: invalidPlayerPower.length,
      mismatchedPlayers: mismatchedPlayers.length,
      missingNames
    },
    errors,
    warnings
  };
}
