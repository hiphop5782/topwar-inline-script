function safeRead(object, key) {
  try {
    return object?.[key];
  } catch {
    return undefined;
  }
}

function parseObject(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function first(sources, keys) {
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const value = safeRead(source, key);
      if (value !== undefined && value !== null && value !== "") return value;
    }
  }
  return null;
}

function number(value) {
  const converted = Number(value);
  return Number.isFinite(converted) ? converted : null;
}

function text(value) {
  return value === undefined || value === null || value === "" ? null : String(value);
}

function boolean(value) {
  if (value === true || value === false) return value;
  if (Number(value) === 1) return true;
  if (Number(value) === 0) return false;
  return String(value).toLowerCase() === "true";
}

function playerSources(row) {
  const nested = ["player", "playerData", "role", "user"]
    .map(key => parseObject(safeRead(row, key)))
    .filter(Boolean);
  return [parseObject(row) || {}, ...nested];
}

function playerDetail(row, sources) {
  const candidates = [
    first(sources, ["playerInfo"]),
    safeRead(row, "detail"),
    safeRead(row, "playerDetail"),
    safeRead(row, "userDetail"),
    safeRead(row, "roleDetail")
  ];
  for (const candidate of candidates) {
    const parsed = parseObject(candidate);
    if (parsed) return parsed;
  }
  return {};
}

export function mapPlayerRow(row, index, fallbackServerId) {
  const sources = playerSources(row);
  const detail = playerDetail(row, sources);
  const onlineValue = first(sources, ["isOnline", "online"]);
  const cp = number(first(sources, ["power", "cp", "fightPower"]));
  const score = number(first(sources, ["val", "score", "value"]));
  const targetServer = Number(fallbackServerId);
  return {
    rank: number(first(sources, ["rank", "ranking"])) ?? index + 1,
    score,
    cp,
    power: cp,
    uid: text(first(sources, ["uid", "pid", "userId", "playerId", "roleId", "id"])),
    // 기존 RealPower/Java 매핑과 동일하게 랭킹이 열린 Theater 서버를 기준으로 한다.
    // 랭킹 행의 serverId는 이 화면의 소속 서버를 나타내는 신뢰 가능한 필드가 아니다.
    server: targetServer,
    serverNumber: targetServer,
    serverId: String(targetServer),
    level: number(first(sources, ["lv", "level"])),
    nickname: text(first([detail, ...sources], ["username", "userName", "nickname", "nickName"])),
    allianceId: text(first(sources, ["allianceId", "aid", "guildId"])),
    allianceTag: text(first(sources, ["allianceTag", "a_tag", "tag"])),
    allianceName: text(first(sources, ["allianceName", "guildName"])),
    lang: text(first(sources, ["lang", "language"])),
    lastLogin: number(first(sources, ["lastLoginTime", "lastLogin", "last_login"])),
    lastRequest: number(first(sources, ["lastOnlineTime", "lastRequest", "last_request"])),
    online: boolean(onlineValue),
    countryFlag: number(first([detail], ["nationalflag", "nationalFlag", "countryFlag"])),
    gender: number(first([detail], ["gender", "usergender", "userGender"])),
    profile: text(first([detail], ["avatarurl", "avatarUrl", "headimgurl", "headImgUrl"]))
  };
}

export function mapAllianceRow(row, index, fallbackServerId) {
  const source = parseObject(row) || {};
  const cp = number(first([source], ["cp", "power", "fightPower", "score", "value"]));
  const targetServer = Number(fallbackServerId);
  return {
    rank: number(first([source], ["rank", "ranking"])) ?? index + 1,
    score: cp,
    cp,
    power: cp,
    aid: text(first([source], ["aid", "allianceId", "guildId", "id"])),
    allianceId: text(first([source], ["aid", "allianceId", "guildId", "id"])),
    tag: text(first([source], ["tag", "allianceTag", "a_tag"])),
    name: text(first([source], ["name", "allianceName", "guildName"])),
    leaderName: text(first([source], ["leader_name", "leaderName", "leader", "chiefName"])),
    memberCount: number(first([source], ["memberCount", "members", "num"])),
    server: targetServer,
    serverNumber: targetServer,
    serverId: String(targetServer)
  };
}

export function fingerprintRows(rows, identity) {
  const values = rows.map(identity);
  return `${rows.length}:${values.join("|")}`;
}
