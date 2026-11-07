window.CQ26_WLB_RANK_PROMISE = (async () => {
  "use strict";

  const cc = window.cc;
  const TARGET = "CQ26WLBRankPanel";

  function valid(node) {
    try { return !!node && cc?.isValid?.(node); }
    catch { return !!node; }
  }

  function className(component) {
    try {
      const name = cc?.js?.getClassName?.(component) || component?.__classname__ || component?.constructor?.name || "";
      return String(name);
    } catch {
      return "";
    }
  }

  function nodePath(node, maxDepth = 24) {
    const parts = [];
    let current = node;
    for (let depth = 0; current && depth < maxDepth; depth++, current = current.parent) {
      parts.unshift(String(current.name || "<unnamed>"));
    }
    return parts.join("/");
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
      for (let index = (node.children || []).length - 1; index >= 0; index--) {
        stack.push(node.children[index]);
      }
    }
  }

  function findPanel() {
    let panel = null;
    walk(cc?.director?.getScene?.(), node => {
      if (!panel && node.name === TARGET) panel = node;
    });
    if (!panel) throw new Error("월드랜드 랭킹(CQ26WLBRankPanel) 화면을 먼저 열어주세요.");
    return panel;
  }

  function cloneSafe(value, options = {}) {
    const seen = new WeakSet();
    const state = {
      remaining: Math.max(80, Number(options.maxNodes ?? 900)),
      maxDepth: Math.max(1, Number(options.maxDepth ?? 4)),
      maxArray: Math.max(1, Number(options.maxArray ?? 20)),
      maxKeys: Math.max(5, Number(options.maxKeys ?? 48))
    };
    const blockedKey = /(?:sprite|frame|texture|material|prefab|asset|atlas|skeleton|animation|button|label|layout|widget|icon|node)/i;
    const blockedExact = new Set([
      "parent", "children", "_components", "_eventTargets", "__eventTargets",
      "_delegate", "_super", "_materials", "_renderData", "_assembler"
    ]);

    function visit(current, depth) {
      if (current === null || current === undefined) return current ?? null;
      if (typeof current === "string") return current.length > 800 ? `${current.slice(0, 800)}…` : current;
      if (["number", "boolean"].includes(typeof current)) return current;
      if (typeof current === "bigint") return String(current);
      if (typeof current !== "object" || depth > state.maxDepth || state.remaining-- <= 0) return undefined;
      if (seen.has(current)) return undefined;
      if (current._components || current.children || current.node || current._objFlags !== undefined) return undefined;
      seen.add(current);

      if (Array.isArray(current)) {
        const output = [];
        for (const item of current.slice(0, state.maxArray)) {
          const cloned = visit(item, depth + 1);
          if (cloned !== undefined) output.push(cloned);
        }
        return output;
      }

      const output = {};
      for (const key of Object.keys(current).slice(0, state.maxKeys)) {
        if (blockedExact.has(key) || blockedKey.test(key)) continue;
        let child;
        try { child = visit(current[key], depth + 1); }
        catch { continue; }
        if (child !== undefined) output[key] = child;
      }
      return output;
    }

    return visit(value, 0);
  }

  function sampleRows(array) {
    const selected = [];
    for (const item of array.slice(0, 3)) selected.push(item?._data ?? item);
    if (array.length > 3) selected.push(array[array.length - 1]?._data ?? array[array.length - 1]);
    return cloneSafe(selected, { maxNodes: 1200, maxArray: 4, maxDepth: 5, maxKeys: 64 }) || [];
  }

  function arrayScore(field, array) {
    const entry = array.find(item => item && typeof item === "object");
    const row = entry?._data ?? entry;
    if (!row || typeof row !== "object") return 0;
    const keys = Object.keys(row);
    let score = 0;
    if (/rankList/i.test(field)) score += 30;
    else if (/rank|player|user|member|data|info|list/i.test(field)) score += 8;
    if (keys.some(key => /rank|ranking|order|no/i.test(key))) score += 12;
    if (keys.some(key => /score|point|honor|fame|merit|contribution/i.test(key))) score += 12;
    if (keys.some(key => /uid|userId|playerId/i.test(key))) score += 6;
    if (keys.some(key => /sid|serverId|server/i.test(key))) score += 4;
    if (keys.some(key => /playerInfo|userInfo|roleInfo/i.test(key))) score += 6;
    return score;
  }

  function inspectArrays(panelNode) {
    const candidates = [];
    walk(panelNode, node => {
      for (const component of node._components || []) {
        const componentName = className(component);
        for (const field of Object.keys(component || {})) {
          let value;
          try { value = component[field]; }
          catch { continue; }
          if (!Array.isArray(value) || !value.length) continue;
          const score = arrayScore(field, value);
          if (score < 8) continue;
          const first = value.find(item => item && typeof item === "object");
          const row = first?._data ?? first;
          candidates.push({
            path: nodePath(node),
            component: componentName,
            field,
            length: value.length,
            score,
            keys: row && typeof row === "object" ? Object.keys(row).slice(0, 80) : [],
            samples: sampleRows(value),
            raw: value
          });
        }
      }
    }, 5000);
    candidates.sort((a, b) => b.score - a.score || b.length - a.length);
    return candidates.slice(0, 8);
  }

  function inspectSelfRows(panelNode) {
    const rows = [];
    walk(panelNode, node => {
      for (const component of node._components || []) {
        for (const field of Object.keys(component || {})) {
          let value;
          try { value = component[field]; }
          catch { continue; }
          if (!value || Array.isArray(value) || typeof value !== "object") continue;
          const row = value._data ?? value;
          if (!row || typeof row !== "object" || row.node || row.children || row._components) continue;
          const keys = Object.keys(row);
          if (!keys.some(key => /^(?:rank|ranking|no)$/i.test(key))) continue;
          if (!keys.some(key => /score|point|honor|fame|merit|contribution/i.test(key))) continue;
          rows.push({ path: nodePath(node), component: className(component), field, raw: row });
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
    } catch {
      return {};
    }
  }

  function firstValue(...values) {
    return values.find(value => value !== undefined && value !== null && value !== "") ?? null;
  }

  function toId(value) {
    if (value === undefined || value === null || value === "") return "";
    if (typeof value === "string") return value;
    const low = value?.low ?? value?._low;
    const high = value?.high ?? value?._high;
    if (typeof low === "number" && typeof high === "number") {
      let number = (BigInt(high >>> 0) << 32n) | BigInt(low >>> 0);
      if (!(value.unsigned ?? value._unsigned) && high < 0) number -= 1n << 64n;
      return String(number);
    }
    return String(value);
  }

  function normalizeRow(entry, index) {
    const row = entry?._data ?? entry ?? {};
    const playerInfo = parseObject(firstValue(row.playerInfo, row.player?.playerInfo, row.userInfo, row.roleInfo));
    const rank = Number(firstValue(row.rank, row.ranking, row.no, row.order)) || index + 1;
    const serverId = firstValue(row.sid, row.serverId, row.server, row.worldId, playerInfo.sid, playerInfo.serverId) ?? "";
    const uid = toId(firstValue(row.uid, row.pid, row.playerId, row.userId, row.roleId, playerInfo.uid, playerInfo.userId));
    const nickname = String(firstValue(playerInfo.username, playerInfo.nickname, playerInfo.userName, playerInfo.name, row.username, row.nickname, row.playerName, row.name, row.serverName) || "");
    const personalPoints = Number(firstValue(row.score, row.point, row.points, row.personalPoint, row.personalPoints, row.value, row.val)) || 0;
    const honor = Number(firstValue(row.score2, row.honor, row.fame, row.merit, row.contribution, row.contributionPoint)) || 0;
    return {
      rank,
      serverId,
      uid,
      nickname,
      personalPoints,
      honor
    };
  }

  function sameRow(left, right) {
    if (left.uid && right.uid) return left.uid === right.uid;
    return left.rank === right.rank && String(left.serverId) === String(right.serverId) && left.nickname === right.nickname;
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
  const candidates = inspectArrays(panelNode);
  if (!candidates.length) {
    throw new Error("활성 탭에서 랭킹 배열 후보를 찾지 못했습니다. 목록이 표시된 뒤 다시 조사하세요.");
  }

  const selected = candidates[0];
  const rawRows = [...selected.raw];
  for (const candidate of inspectSelfRows(panelNode)) {
    const normalized = normalizeRow(candidate.raw, rawRows.length);
    const duplicate = rawRows.some((entry, index) => sameRow(normalizeRow(entry, index), normalized));
    if (!duplicate) rawRows.push(candidate.raw);
  }

  const rows = [];
  for (let index = 0; index < rawRows.length; index++) {
    if (!rawRows[index] || typeof rawRows[index] !== "object") continue;
    const row = normalizeRow(rawRows[index], index);
    if (!rows.some(existing => sameRow(row, existing))) rows.push(row);
  }
  rows.sort((left, right) => left.rank - right.rank);
  if (!rows.length) throw new Error("랭킹 배열은 찾았지만 복사할 행이 없습니다.");

  const lines = ["순위\t서버\tUID\t닉네임\t개인 포인트\t공훈"];
  for (const row of rows) {
    const cells = [row.rank, row.serverId, row.uid ? `'${row.uid}` : "", row.nickname, row.personalPoints, row.honor];
    for (let index = 0; index < cells.length; index++) cells[index] = safeCell(cells[index]);
    lines.push(cells.join("\t"));
  }
  const tsv = lines.join("\n");
  window.CQ26_WLB_RANK_TSV = tsv;
  const copied = await copyText(tsv);
  if (!copied) {
    console.error(`${rows.length}행은 조사했지만 자동 복사에 실패했습니다.`);
    console.log("대체 명령: copy(window.CQ26_WLB_RANK_TSV)");
    throw new Error("콘솔에 출력된 대체 복사 명령을 실행하세요.");
  }

  const result = {
    dataset: "cq26-wlb-ranking",
    capturedAt: new Date().toISOString(),
    target: TARGET,
    count: rows.length,
    copied: true,
    source: {
      path: selected.path,
      component: selected.component,
      field: selected.field,
      length: selected.length,
      keys: selected.keys
    },
    rows
  };
  window.CQ26_WLB_RANK_RESULT = result;
  const candidateSummaries = [];
  for (const { raw, ...candidate } of candidates) candidateSummaries.push(candidate);
  window.CQ26_WLB_RANK_CANDIDATES = candidateSummaries;
  console.table(rows);
  console.log(`[SSC2 서리결정쟁탈전 랭킹조사] ${rows.length}행 Google Sheets용 복사 완료`, result.source);
  return result;
})();
