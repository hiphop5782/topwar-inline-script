window.CQ25_NEUTRAL_CITY_RANK_PROMISE = (async () => {
  "use strict";

  const cc = window.cc;
  const TARGET = "CQ25NeutralScorePanel";

  function valid(node) {
    try { return !!node && cc?.isValid?.(node); } catch { return !!node; }
  }

  function className(component) {
    try {
      const name = cc?.js?.getClassName?.(component) || component?.__classname__ || component?.constructor?.name || "";
      return String(name);
    } catch { return ""; }
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
    if (!panel) throw new Error("중립도시 포인트 랭킹 화면을 먼저 열어주세요.");
    return panel;
  }

  function labelText(root) {
    let text = "";
    walk(root, node => {
      if (text) return;
      for (const component of node._components || []) {
        if (className(component) !== "cc.Label") continue;
        const value = String(component.string ?? component._string ?? "").trim();
        if (value) text = value;
      }
    }, 120);
    return text;
  }

  function selectedTab(panelNode) {
    let selected = "";
    walk(panelNode, node => {
      if (selected) return;
      for (const component of node._components || []) {
        if (!/Toggle$/i.test(className(component))) continue;
        if (!(component.isChecked ?? component._isChecked)) continue;
        const text = labelText(node);
        if (/^\d{1,2}-\d{1,2}$/.test(text)) selected = text;
      }
    }, 3000);
    return selected;
  }

  function arrayScore(field, value) {
    const entry = value.find(item => item && typeof item === "object");
    const row = entry?._data ?? entry;
    if (!row || typeof row !== "object") return 0;
    const keys = Object.keys(row);
    let score = /rankList/i.test(field) ? 30 : 0;
    if (!score && /rank|player|user|data|info|list/i.test(field)) score += 8;
    if (keys.some(key => /^(rank|ranking|no|order)$/i.test(key))) score += 12;
    if (keys.some(key => /score|point|value|val/i.test(key))) score += 12;
    if (keys.some(key => /playerInfo|userInfo|roleInfo/i.test(key))) score += 6;
    if (keys.some(key => /uid|userId|playerId/i.test(key))) score += 5;
    return score;
  }

  function rankCandidates(panelNode) {
    const candidates = [];
    walk(panelNode, node => {
      for (const component of node._components || []) {
        for (const field of Object.keys(component || {})) {
          let value;
          try { value = component[field]; } catch { continue; }
          if (!Array.isArray(value) || !value.length) continue;
          const score = arrayScore(field, value);
          if (score < 12) continue;
          candidates.push({ component: className(component), field, length: value.length, score, raw: value });
        }
      }
    }, 5000);
    candidates.sort((left, right) => right.score - left.score || right.length - left.length);
    return candidates;
  }

  function selfRows(panelNode) {
    const rows = [];
    walk(panelNode, node => {
      for (const component of node._components || []) {
        for (const field of Object.keys(component || {})) {
          let value;
          try { value = component[field]; } catch { continue; }
          if (!value || Array.isArray(value) || typeof value !== "object") continue;
          const row = value._data ?? value;
          if (!row || row.node || row.children || row._components) continue;
          const keys = Object.keys(row);
          if (!keys.some(key => /^(rank|ranking|no|order)$/i.test(key))) continue;
          if (!keys.some(key => /score|point|value|val/i.test(key))) continue;
          rows.push(row);
        }
      }
    }, 5000);
    return rows;
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

  function normalize(entry, index, date) {
    const row = entry?._data ?? entry ?? {};
    const info = parseObject(firstValue(row.playerInfo, row.userInfo, row.roleInfo, row.player?.playerInfo));
    const rank = Number(firstValue(row.rank, row.ranking, row.no, row.order)) || index + 1;
    const serverId = firstValue(row.sid, row.serverId, row.server, row.worldId, info.sid, info.serverId) ?? "";
    const uid = toId(firstValue(row.uid, row.pid, row.playerId, row.userId, row.roleId, info.uid, info.userId));
    const nickname = String(firstValue(info.username, info.nickname, info.userName, info.name, row.username, row.nickname, row.playerName, row.name) || "");
    const points = Number(firstValue(row.score, row.point, row.points, row.value, row.val)) || 0;
    return { date, rank, serverId, uid, nickname, points };
  }

  function sameRow(left, right) {
    if (left.uid && right.uid) return left.uid === right.uid;
    return left.rank === right.rank && left.nickname === right.nickname && String(left.serverId) === String(right.serverId);
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
  const date = selectedTab(panelNode);
  const candidates = rankCandidates(panelNode);
  if (!candidates.length) throw new Error("현재 날짜 탭의 랭킹 데이터를 찾지 못했습니다.");
  const selected = candidates[0];
  const rawRows = [...selected.raw];
  for (const selfRow of selfRows(panelNode)) {
    const row = normalize(selfRow, rawRows.length, date);
    let duplicate = false;
    for (let index = 0; index < rawRows.length; index++) {
      if (sameRow(normalize(rawRows[index], index, date), row)) duplicate = true;
    }
    if (!duplicate) rawRows.push(selfRow);
  }

  const rows = [];
  for (let index = 0; index < rawRows.length; index++) {
    if (!rawRows[index] || typeof rawRows[index] !== "object") continue;
    const row = normalize(rawRows[index], index, date);
    if (!rows.some(existing => sameRow(existing, row))) rows.push(row);
  }
  rows.sort((left, right) => left.rank - right.rank);
  if (!rows.length) throw new Error("현재 날짜 탭에서 복사할 랭킹 행이 없습니다.");

  const lines = ["날짜\t순위\t서버\tUID\t닉네임\t포인트"];
  for (const row of rows) {
    const cells = [row.date, row.rank, row.serverId, row.uid ? `'${row.uid}` : "", row.nickname, row.points];
    for (let index = 0; index < cells.length; index++) cells[index] = safeCell(cells[index]);
    lines.push(cells.join("\t"));
  }
  const tsv = lines.join("\n");
  const copied = await copyText(tsv);
  if (!copied) throw new Error(`${rows.length}행은 읽었지만 Google Sheets용 복사에 실패했습니다.`);

  const result = { dataset: "cq25-neutral-city-ranking", capturedAt: new Date().toISOString(), date, count: rows.length, copied: true, source: { component: selected.component, field: selected.field, length: selected.length }, rows };
  window.CQ25_NEUTRAL_CITY_RANK_RESULT = result;
  window.CQ25_NEUTRAL_CITY_RANK_TSV = tsv;
  console.table(rows);
  console.log(`[SSC2 중립도시 랭킹] ${date || "현재 탭"} · ${rows.length}행 복사 완료`, result.source);
  return result;
})();
