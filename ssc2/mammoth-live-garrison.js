window.CQ26_MAMMOTH_GARRISON_PROMISE = (async () => {
  "use strict";

  const cc = window.cc;
  const TARGET = "CQ26DBTroopsInfoPanel";

  function className(component) {
    try {
      const name = cc?.js?.getClassName?.(component) || component?.__classname__ || component?.constructor?.name || "";
      return String(name);
    } catch { return ""; }
  }

  function valid(node) {
    try { return !!node && cc?.isValid?.(node); } catch { return !!node; }
  }

  function walk(root, callback, limit = 12000) {
    const stack = root ? [root] : [];
    const seen = new Set();
    let count = 0;
    while (stack.length && count++ < limit) {
      const node = stack.pop();
      if (!valid(node) || seen.has(node) || node.activeInHierarchy === false) continue;
      seen.add(node);
      callback(node);
      const children = node.children || [];
      for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
    }
  }

  function findPanel() {
    let panel = null;
    walk(cc?.director?.getScene?.(), node => {
      if (!panel && node.name === TARGET) panel = node;
    });
    if (!panel) throw new Error("맘모스 방어 실시간 주둔 대열 화면을 먼저 열어주세요.");
    return panel;
  }

  function candidateScore(field, value) {
    const entry = value.find(item => item && typeof item === "object");
    const row = entry?._data ?? entry;
    if (!row || typeof row !== "object") return 0;
    const keys = Object.keys(row);
    let score = /infoList|memberList|playerList/i.test(field) ? 20 : 0;
    if (!score && /member|player|troop|data|info|list/i.test(field)) score += 8;
    if (keys.some(key => /playerInfo|userInfo/i.test(key))) score += 10;
    if (keys.some(key => /uid|userId|playerId/i.test(key))) score += 6;
    if (keys.some(key => /sid|serverId/i.test(key))) score += 4;
    if (keys.some(key => /aTag|alliance/i.test(key))) score += 3;
    return score;
  }

  function findCandidate(panelNode) {
    const candidates = [];
    walk(panelNode, node => {
      for (const component of node._components || []) {
        for (const field of Object.keys(component || {})) {
          let value;
          try { value = component[field]; } catch { continue; }
          if (!Array.isArray(value) || !value.length) continue;
          const score = candidateScore(field, value);
          if (score < 8) continue;
          candidates.push({ component: className(component), field, length: value.length, score, raw: value });
        }
      }
    }, 5000);
    candidates.sort((left, right) => right.score - left.score || right.length - left.length);
    return candidates[0] || null;
  }

  function parseObject(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    if (typeof value !== "string" || !value.trim()) return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  }

  function firstValue(...values) {
    return values.find(value => value !== undefined && value !== null && value !== "") ?? null;
  }

  function toId(value) {
    if (value === undefined || value === null || value === "") return "";
    if (typeof value === "string") return value;
    const low = value?.low ?? value?._low;
    const high = value?.high ?? value?._high;
    if (typeof low !== "number" || typeof high !== "number") return String(value);
    let number = (BigInt(high >>> 0) << 32n) | BigInt(low >>> 0);
    if (!(value.unsigned ?? value._unsigned) && high < 0) number -= 1n << 64n;
    return String(number);
  }

  function safeCell(value) {
    return String(value ?? "").replace(/[\t\r\n]/g, " ");
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.cssText = "position:fixed;left:-99999px;top:-99999px;opacity:0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    let copied = false;
    try { copied = document.execCommand("copy"); } finally { textarea.remove(); }
    if (!copied && typeof window.copy === "function") {
      try { window.copy(text); copied = true; } catch {}
    }
    return copied;
  }

  const panelNode = findPanel();
  const selected = findCandidate(panelNode);
  if (!selected) throw new Error("실시간 주둔 대열의 참여자 배열을 찾지 못했습니다.");
  const players = [];
  for (let index = 0; index < selected.raw.length; index++) {
    const row = selected.raw[index]?._data ?? selected.raw[index] ?? {};
    const user = parseObject(row.userInfo);
    const info = parseObject(firstValue(row.playerInfo, user.playerInfo));
    const tagValue = firstValue(row.aTag, info.aTag, row.alliance, info.alliance) ?? "";
    const alliance = typeof tagValue === "object" ? String(firstValue(tagValue.tag, tagValue.name) || "") : String(tagValue);
    const serverId = firstValue(row.serverId, row.sid, info.serverId, info.sid, user.serverId, user.sid) ?? "";
    const uid = toId(firstValue(row.uid, row.userId, row.playerId, info.uid, info.userId, user.uid));
    const nickname = String(firstValue(info.username, info.nickname, info.name, user.username, row.username, row.name) || "");
    players.push({ order: index + 1, serverId, uid, alliance, nickname });
  }
  if (!players.length) throw new Error("실시간 주둔 대열에서 복사할 참여자가 없습니다.");

  const lines = ["번호\t서버\tUID\t동맹\t닉네임"];
  for (const player of players) {
    const cells = [player.order, player.serverId, player.uid ? `'${player.uid}` : "", player.alliance, player.nickname];
    for (let index = 0; index < cells.length; index++) cells[index] = safeCell(cells[index]);
    lines.push(cells.join("\t"));
  }
  const tsv = lines.join("\n");
  const copied = await copyText(tsv);
  if (!copied) throw new Error(`${players.length}명은 조사했지만 Google Sheets용 복사에 실패했습니다.`);

  const result = { dataset: "cq26-mammoth-live-garrison", capturedAt: new Date().toISOString(), count: players.length, copied: true, source: { component: selected.component, field: selected.field, length: selected.length }, players };
  window.CQ26_MAMMOTH_GARRISON_RESULT = result;
  window.CQ26_MAMMOTH_GARRISON_TSV = tsv;
  console.table(players);
  console.log(`[SSC2 맘모스 실시간 주둔대열조사] ${players.length}명 복사 완료`, result.source);
  return result;
})();
