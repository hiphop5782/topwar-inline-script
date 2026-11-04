window.CQ26_SEAL_RANK_PROMISE = (async () => {
  "use strict";

  const cc = window.cc;
  const TARGET = "CQ26MainRankPanel";
  const CONTENT_NAMES = ["CQ26AllRankNode", "CQ26RoundRankNode", "CQ26PresonRankNode"];

  function valid(node) {
    try { return !!node && cc.isValid(node); } catch { return !!node; }
  }

  function className(component) {
    try {
      return String(
        cc.js?.getClassName?.(component)
        || component?.__classname__
        || component?.constructor?.name
        || ""
      );
    } catch {
      return "";
    }
  }

  function nodePath(node, maxDepth = 20) {
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
      if (!valid(node) || seen.has(node)) continue;
      seen.add(node);
      callback(node);
      for (let index = (node.children || []).length - 1; index >= 0; index--) {
        stack.push(node.children[index]);
      }
    }
  }

  function findPanel() {
    let found = null;
    walk(cc?.director?.getScene?.(), node => {
      if (!found && node.name === TARGET && node.activeInHierarchy !== false) found = node;
    });
    if (!found) throw new Error("봉인석 랭킹 창을 먼저 열어주세요.");
    return found;
  }

  function componentOn(node, wanted) {
    return (node?._components || []).find(component => className(component) === wanted) || null;
  }

  function findMainComponent(panelNode) {
    const component = componentOn(panelNode, TARGET);
    if (!component) throw new Error("CQ26MainRankPanel 컴포넌트를 찾지 못했습니다.");
    return component;
  }

  function labelText(node) {
    for (const component of node?._components || []) {
      if (className(component) !== "cc.Label") continue;
      const value = component.string ?? component._string;
      if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
    return "";
  }

  function cloneSafe(value, options = {}) {
    const seen = new WeakSet();
    const state = {
      remaining: Math.max(100, Number(options.maxNodes ?? 1200)),
      maxDepth: Math.max(1, Number(options.maxDepth ?? 3)),
      maxArray: Math.max(1, Number(options.maxArray ?? 200)),
      maxKeys: Math.max(5, Number(options.maxKeys ?? 40))
    };
    const blockedKey = /(?:sprite|frame|texture|material|prefab|asset|atlas|skeleton|animation|button|label|layout|widget|icon)/i;
    const blockedExact = new Set([
      "node", "parent", "children", "_components", "_eventTargets", "__eventTargets",
      "_delegate", "_super", "_materials", "_renderData", "_assembler", "_spriteFrame"
    ]);

    function visit(current, depth) {
      if (current === null || current === undefined) return current ?? null;
      if (typeof current === "string") return current.length > 1200 ? `${current.slice(0, 1200)}…` : current;
      if (["number", "boolean"].includes(typeof current)) return current;
      if (typeof current === "bigint") return String(current);
      if (typeof current !== "object" || depth > state.maxDepth || state.remaining-- <= 0) return undefined;
      if (seen.has(current)) return undefined;
      if (current._components || current.children || current.node || current._objFlags !== undefined) return undefined;
      seen.add(current);
      if (Array.isArray(current)) {
        return current.slice(0, state.maxArray)
          .map(item => visit(item, depth + 1))
          .filter(item => item !== undefined);
      }
      const output = {};
      for (const key of Object.keys(current).slice(0, state.maxKeys)) {
        if (blockedExact.has(key) || blockedKey.test(key)) continue;
        let child;
        try { child = visit(current[key], depth + 1); } catch { continue; }
        if (child !== undefined) output[key] = child;
      }
      return output;
    }

    return visit(value, 0);
  }

  function componentSummary(component) {
    const fields = {};
    for (const key of Object.keys(component || {})) {
      if (!/(data|info|item|reward|rank|round|score|point|honor|fame|count|num|id)/i.test(key)) continue;
      if (/(?:sprite|frame|texture|material|prefab|asset|atlas|node|component)/i.test(key)) continue;
      let value;
      try { value = component[key]; } catch { continue; }
      if (typeof value === "function" || value?.node || value?.children) continue;
      const cloned = cloneSafe(value, { maxNodes: 350, maxArray: 80, maxDepth: 3, maxKeys: 32 });
      if (Array.isArray(cloned) && !cloned.length) continue;
      if (cloned && typeof cloned === "object" && !Array.isArray(cloned) && !Object.keys(cloned).length) continue;
      if (cloned !== undefined) fields[key] = cloned;
    }
    return { component: className(component), fields };
  }

  function visibleRows(contentNode) {
    const rows = [];
    walk(contentNode, node => {
      if (node.activeInHierarchy === false || node.name !== "item") return;
      const texts = [];
      const rewards = [];
      walk(node, child => {
        const text = labelText(child);
        if (text) texts.push(text);
        for (const component of child._components || []) {
          if (className(component) !== "PropItem") continue;
          const itemId = component._ItemId ?? component.itemId ?? component.id ?? null;
          const itemType = component._ItemType ?? component.itemType ?? component.type ?? null;
          const count = component._itemCount ?? component.itemCount ?? component.count ?? null;
          const needCount = component._needCount ?? component.needCount ?? null;
          const extraData = cloneSafe(
            component._itemExtraData ?? component.itemExtraData ?? component.extraData ?? null,
            { maxNodes: 80, maxArray: 20, maxDepth: 2, maxKeys: 20 }
          );
          rewards.push({ itemId, itemType, count, needCount, extraData });
        }
      }, 800);
      if (texts.length || rewards.length) rows.push({ texts, rewards });
    }, 4000);
    return rows;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function activeScrollView(contentNode) {
    let found = null;
    walk(contentNode, node => {
      if (found || node.activeInHierarchy === false) return;
      found = (node._components || []).find(component =>
        /ScrollView$/i.test(className(component))
        && (typeof component.scrollToBottom === "function" || typeof component.scrollToOffset === "function")
      ) || null;
    });
    return found;
  }

  function rewardRange(texts) {
    return (texts || []).find(text => /^\d+(?:-\d+)?$/.test(String(text).trim())) || "";
  }

  async function collectRewardRows(contentNode) {
    const collected = [];
    const append = rows => {
      for (const row of rows) {
        const range = rewardRange(row.texts);
        const key = range || JSON.stringify(row.rewards);
        if (!collected.some(item => item.key === key)) collected.push({ key, ...row });
      }
    };

    append(visibleRows(contentNode));
    const scroll = activeScrollView(contentNode);
    if (scroll) {
      try {
        scroll.stopAutoScroll?.();
        scroll.scrollToBottom?.(0, false);
        await sleep(120);
        append(visibleRows(contentNode));
        scroll.scrollToTop?.(0, false);
      } catch {}
    }
    return collected;
  }

  function arrayCatalog(contentNode) {
    const arrays = [];
    walk(contentNode, node => {
      for (const component of node._components || []) {
        if (className(component) !== "EniConquerorRankListComponent") continue;
        const value = component.rankList;
        if (!Array.isArray(value) || !value.length) continue;
        arrays.push({
          path: nodePath(node),
          component: className(component),
          field: "rankList",
          length: value.length,
          truncated: value.length > 3000,
          items: cloneSafe(value, {
            maxNodes: 24000,
            maxArray: 3000,
            maxDepth: 4,
            maxKeys: 48
          })
        });
      }
    });
    return arrays.sort((a, b) => b.length - a.length).slice(0, 1);
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
    return copied;
  }

  const panelNode = findPanel();
  const panel = findMainComponent(panelNode);
  const selectedIndex = Number(panel._selectIdx);
  if (![0, 1].includes(selectedIndex)) {
    throw new Error("봉인석 총 랭킹 또는 봉인석 라운드 랭킹 탭을 선택하세요.");
  }

  const contentList = Array.isArray(panel._contentList) ? panel._contentList : [];
  const contentNode = contentList[selectedIndex]
    || (panelNode.children || []).find(node => node.name === CONTENT_NAMES[selectedIndex]);
  if (!contentNode) throw new Error("선택된 봉인석 랭킹 콘텐츠를 찾지 못했습니다.");

  const view = selectedIndex === 0 ? "seal-total" : "seal-round";
  const arrays = arrayCatalog(contentNode);
  const rootComponents = (contentNode._components || []).map(componentSummary);
  const rankArray = arrays.find(item => item.field === "rankList")
    || arrays.find(item => /rank/i.test(item.field));
  const rankData = rankArray?.items || [];
  const hasServerRankings = rankData.some(row => Number(row?.sid ?? row?.serverId) > 0);
  const rankings = hasServerRankings ? rankData.map(row => ({
    rank: Number(row?.rank) || null,
    serverId: Number(row?.sid ?? row?.serverId) || null,
    totalPoints: Number(row?.score ?? row?.point ?? row?.totalPoints) || 0,
    honor: Number(row?.score2 ?? row?.honor ?? row?.fame) || 0,
    serverFlag: Number(row?.serverFlag) || null
  })) : [];
  const rows = hasServerRankings ? [] : await collectRewardRows(contentNode);
  const rowByRange = new Map(rows.map(row => [rewardRange(row.texts), row]));
  const tierDefinitions = hasServerRankings ? [] : rankData.map(row => {
    const rawRange = String(row?.extStr || row?.rank || "");
    const match = rawRange.match(/^(\d+)-(\d+)$/);
    const range = match && match[1] === match[2] ? match[1] : rawRange;
    return { rankStart: Number(row?.rank) || null, rankRange: range };
  });
  const rewardTiers = tierDefinitions.map(definition => {
    const row = rowByRange.get(definition.rankRange);
    return {
      ...definition,
      available: !!row,
      rewards: row?.rewards || []
    };
  });
  const roundComponent = rootComponents.find(item => item.component === "CQ26RoundRankNode");
  const result = {
    schemaVersion: 3,
    dataset: "cq26-seal-ranking",
    capturedAt: new Date().toISOString(),
    view,
    selectedIndex,
    contentName: contentNode.name,
    round: selectedIndex === 1 ? {
      current: Number(roundComponent?.fields?._curRound ?? roundComponent?.fields?.curRound) || null,
      total: Number(roundComponent?.fields?._totalRound ?? roundComponent?.fields?.totalRound) || null
    } : null,
    mode: hasServerRankings ? "server-ranking" : "reward-table",
    count: hasServerRankings ? rankings.length : rewardTiers.length,
    rankings,
    rewardTiers
  };

  const json = JSON.stringify(result, null, 2);
  const copied = await copyText(json);
  if (!copied) throw new Error("랭킹은 읽었지만 JSON 클립보드 복사에 실패했습니다.");
  result.copied = true;
  window.CQ26_SEAL_RANK_RESULT = result;
  window.CQ26_SEAL_RANK_JSON = json;
  console.log(`[SSC2 봉인석 랭킹] ${view} · ${result.count}행 JSON 복사 완료`, {
    view: result.view,
    mode: result.mode,
    count: result.count,
    round: result.round,
    rewardTierCount: result.rewardTiers.length
  });
  return result;
})();
