window.CQ26_MAMMOTH_SCORE_PROMISE = (async () => {
  "use strict";

  const cc = window.cc;
  const TARGET = "CQ26DBRankView";

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
    if (!panel) throw new Error("맘모스 수위병 랭킹 화면을 먼저 열어주세요.");
    return panel;
  }

  function candidateScore(field, value) {
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
          const score = candidateScore(field, value);
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

  function normalize(entry, index) {
    const row = entry?._data ?? entry ?? {};
    const user = parseObject(row.userInfo);
    const info = parseObject(firstValue(row.playerInfo, user.playerInfo, row.roleInfo));
    const rank = Number(firstValue(row.rank, row.ranking, row.no, row.order)) || index + 1;
    const serverId = firstValue(row.serverId, row.sid, row.server, row.worldId, info.serverId, info.sid, user.serverId, user.sid) ?? "";
    const uid = toId(firstValue(row.uid, row.pid, row.playerId, row.userId, row.roleId, info.uid, info.userId, user.uid));
    const nickname = String(firstValue(info.username, info.nickname, info.name, user.username, row.username, row.nickname, row.name) || "");
    const points = Number(firstValue(row.score, row.point, row.points, row.value, row.val)) || 0;
    return { rank, serverId, uid, nickname, points };
  }

  function sameRow(left, right) {
    if (left.uid && right.uid) return left.uid === right.uid;
    return left.rank === right.rank && left.nickname === right.nickname && String(left.serverId) === String(right.serverId);
  }

  function safeCell(value) {
    return String(value ?? "").replace(/[\t\r\n]/g, " ");
  }

  async function copyText(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.readOnly = true;
    textarea.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:.01;z-index:2147483647";
    document.documentElement.appendChild(textarea);
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(0, text.length);
    let copied = false;
    try { copied = document.execCommand("copy"); } finally { textarea.remove(); }
    if (copied) return true;
    try {
      if (typeof copy === "function") {
        copy(text);
        return true;
      }
    } catch {}
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  const panelNode = findPanel();
  const candidates = rankCandidates(panelNode);
  if (!candidates.length) throw new Error("현재 선택된 수위병 랭킹 데이터를 찾지 못했습니다.");
  const selected = candidates[0];
  const rawRows = [...selected.raw];
  for (const selfRow of selfRows(panelNode)) {
    const row = normalize(selfRow, rawRows.length);
    let duplicate = false;
    for (let index = 0; index < rawRows.length; index++) {
      if (sameRow(normalize(rawRows[index], index), row)) duplicate = true;
    }
    if (!duplicate) rawRows.push(selfRow);
  }

  const rows = [];
  for (let index = 0; index < rawRows.length; index++) {
    if (!rawRows[index] || typeof rawRows[index] !== "object") continue;
    const row = normalize(rawRows[index], index);
    if (!rows.some(existing => sameRow(existing, row))) rows.push(row);
  }
  rows.sort((left, right) => left.rank - right.rank);
  if (!rows.length) throw new Error("현재 수위병 랭킹에서 복사할 행이 없습니다.");

  const lines = ["순위\t서버\tUID\t닉네임\t누적 포인트"];
  for (const row of rows) {
    const cells = [row.rank, row.serverId, row.uid ? `'${row.uid}` : "", row.nickname, row.points];
    for (let index = 0; index < cells.length; index++) cells[index] = safeCell(cells[index]);
    lines.push(cells.join("\t"));
  }
  const tsv = lines.join("\n");
  window.CQ26_MAMMOTH_SCORE_TSV = tsv;
  const copied = await copyText(tsv);
  if (!copied) {
    console.error(`${rows.length}행은 조사했지만 자동 복사에 실패했습니다.`);
    console.log("대체 명령: copy(window.CQ26_MAMMOTH_SCORE_TSV)");
    throw new Error("콘솔에 출력된 대체 복사 명령을 실행하세요.");
  }

  const result = { dataset: "cq26-mammoth-cumulative-score", capturedAt: new Date().toISOString(), count: rows.length, copied: true, source: { component: selected.component, field: selected.field, length: selected.length }, rows };
  window.CQ26_MAMMOTH_SCORE_RESULT = result;
  console.table(rows);
  console.log(`[SSC2 맘모스 누적점수조사] ${rows.length}행 복사 완료`, result.source);
  return result;
})();
