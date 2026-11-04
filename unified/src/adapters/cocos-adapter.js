import { TopWarError } from "../core/errors.js";

const KNOWN_COMPONENTS = [
  "WorldServerListPanel",
  "WorldServerTheaterPanel",
  "WorldServerPowerRank",
  "WorldServerAlliancePowerRank"
];

function cocos() {
  return globalThis.cc || null;
}

function componentName(component) {
  return String(
    component?.__classname__ ||
    component?.constructor?.name ||
    component?.name ||
    "UnknownComponent"
  );
}

function isNodeActive(node) {
  return node?.active !== false && node?.activeInHierarchy !== false;
}

function nodeChildren(node) {
  return Array.isArray(node?.children) ? node.children : [];
}

function nodeComponents(node) {
  return Array.isArray(node?._components) ? node._components : [];
}

function ancestorByName(node, name, maxDepth = 12) {
  let current = node;
  for (let depth = 0; current && depth < maxDepth; depth++) {
    if (String(current.name || "") === name) return current;
    current = current.parent;
  }
  return null;
}

function abortError() {
  return new TopWarError("TASK_ABORTED", "작업이 중지되었습니다.");
}

function ownNodeText(node) {
  const values = [];
  for (const component of nodeComponents(node)) {
    for (const key of ["string", "_string", "text", "_text"]) {
      let value;
      try {
        value = component?.[key];
      } catch {
        continue;
      }
      if (typeof value === "string" && value.trim()) values.push(value.trim());
    }
  }
  return [...new Set(values)];
}

export function nodePath(node, maxDepth = 12) {
  const parts = [];
  let current = node;
  for (let depth = 0; current && depth < maxDepth; depth++) {
    parts.unshift(String(current.name || "<unnamed>"));
    current = current.parent;
  }
  return parts.join("/");
}

function describeClickHandler(handler) {
  return {
    component: String(handler?.component || handler?._componentName || ""),
    handler: String(handler?.handler || handler?._handler || ""),
    customEventData: handler?.customEventData ?? handler?._customEventData ?? null,
    targetPath: handler?.target ? nodePath(handler.target) : null
  };
}

export function extractServerMatches(rows) {
  const patterns = [
    /(?:전투\s*지역|battle\s*area|戦闘\s*地域|战斗\s*区域|warzone|전쟁\s*구역)\s*[s#]?\s*(\d+)/i,
    /(?:server|서버|サーバー|服务器)\s*[s#]?\s*(\d+)/i
  ];
  const matches = [];
  for (const row of rows || []) {
    const value = String(row?.text || "");
    const shortLabel = value.match(/^S\s*(\d+)$/i);
    if (shortLabel) {
      matches.push({ serverId: Number(shortLabel[1]), text: value, path: row?.path || "" });
    }
    for (const pattern of patterns) {
      const match = value.match(pattern);
      if (!match) continue;
      matches.push({ serverId: Number(match[1]), text: value, path: row?.path || "" });
    }
  }
  return matches;
}

export class CocosAdapter {
  scene() {
    return cocos()?.director?.getScene?.() || null;
  }

  requireScene() {
    const scene = this.scene();
    if (!scene) {
      throw new TopWarError("GAME_SCENE_MISSING", "게임 Scene을 찾지 못했습니다.");
    }
    return scene;
  }

  walk(root = this.requireScene(), limit = 15000) {
    const rows = [];
    const stack = [root];
    const visited = new Set();
    while (stack.length && rows.length < limit) {
      const node = stack.pop();
      if (!node || visited.has(node)) continue;
      visited.add(node);
      rows.push(node);
      const children = nodeChildren(node);
      for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
    }
    return rows;
  }

  findComponents(name, { activeOnly = false } = {}) {
    const matches = [];
    for (const node of this.walk()) {
      if (activeOnly && !isNodeActive(node)) continue;
      for (const component of nodeComponents(node)) {
        if (componentName(component) === name) matches.push(component);
      }
      try {
        const direct = node.getComponent?.(name);
        if (direct && !matches.includes(direct)) matches.push(direct);
      } catch {
        // Some game builds throw for unknown component names.
      }
    }
    return matches;
  }

  activeComponent(name) {
    return this.findComponents(name, { activeOnly: true })
      .find(component => isNodeActive(component?.node)) || null;
  }

  visibleTexts(limit = 1000, root = null) {
    const rows = [];
    for (const node of this.walk(root || this.requireScene())) {
      if (!isNodeActive(node)) continue;
      for (const text of ownNodeText(node)) {
        rows.push({ text, path: nodePath(node) });
        if (rows.length >= limit) return rows;
      }
    }
    return rows;
  }

  detectServerContext(expectedServerId = null) {
    const target = Number(expectedServerId);
    const theater = this.activeComponent("WorldServerTheaterPanel");
    // 대상 서버 검증은 Theater 내부 텍스트만 신뢰한다. 서버 목록 뒤쪽의 다른
    // 서버 카드가 active 상태로 남아 있어도 대상 서버로 오인하지 않는다.
    // 서버 제목은 TheaterPanel 내부가 아니라 같은 UIFrameScreen의 HEADER에 있다.
    // 프레임 전체만 조사하면 뒤에 남아 있는 서버목록 카드들은 제외하면서 제목은 포함한다.
    const scopedRoot = theater
      ? ancestorByName(theater.node, "UIFrameScreen") || theater.node
      : null;
    // 게임의 미니맵 서버 라벨은 "S4477"처럼 단독 표기된다. 길드 태그
    // "[S005]"를 서버번호로 오인하지 않도록 문자열 전체가 일치할 때만 받는다.
    const matches = extractServerMatches(this.visibleTexts(1000, scopedRoot));
    const uniqueIds = [...new Set(matches.map(row => row.serverId).filter(Number.isFinite))];
    const exact = Number.isFinite(target)
      ? matches.find(row => row.serverId === target) || null
      : null;
    return {
      expectedServerId: Number.isFinite(target) ? target : null,
      verified: !!theater && !!exact,
      scope: theater ? "WorldServerTheaterFrame" : "scene-unverified",
      exact,
      detectedServerIds: uniqueIds,
      matches
    };
  }

  rankComponent() {
    const personal = this.activeComponent("WorldServerPowerRank");
    const alliance = this.activeComponent("WorldServerAlliancePowerRank");
    if (personal && alliance) {
      throw new TopWarError(
        "RANK_PANEL_AMBIGUOUS",
        "개인 랭킹과 길드 랭킹이 동시에 활성 상태입니다."
      );
    }
    if (personal) return { kind: "players", component: personal };
    if (alliance) return { kind: "alliances", component: alliance };
    throw new TopWarError(
      "RANK_PANEL_MISSING",
      "활성화된 TOP100 개인/길드 랭킹 화면을 찾지 못했습니다."
    );
  }

  async openRank(kind, { signal, timeoutMs = 8000 } = {}) {
    const personal = kind === "players";
    const targetName = personal ? "WorldServerPowerRank" : "WorldServerAlliancePowerRank";
    const methodName = personal ? "onClickPlayerRank" : "onClickAllianceRank";
    if (this.activeComponent("WorldServerPowerRank") ||
        this.activeComponent("WorldServerAlliancePowerRank")) {
      throw new TopWarError("RANK_PANEL_ALREADY_OPEN", "다른 랭킹 화면이 이미 열려 있습니다.");
    }
    const theater = this.activeComponent("WorldServerTheaterPanel");
    if (!theater || typeof theater[methodName] !== "function") {
      throw new TopWarError(
        "RANK_OPEN_METHOD_MISSING",
        `${methodName} 메서드를 찾지 못했습니다.`
      );
    }
    theater[methodName]();
    return this.waitForComponent(targetName, { signal, timeoutMs, active: true });
  }

  async closeRank(kind, { signal, timeoutMs = 5000 } = {}) {
    const name = kind === "players" ? "WorldServerPowerRank" : "WorldServerAlliancePowerRank";
    const rank = this.activeComponent(name);
    if (!rank) return { ok: true, alreadyClosed: true };
    const frame = ancestorByName(rank.node, "UIFrameScreen");
    let dialog = null;
    try {
      dialog = frame?.getComponent?.("DialogFrameComponent") || null;
    } catch {
      dialog = null;
    }
    if (!dialog) {
      dialog = nodeComponents(frame).find(component => componentName(component) === "DialogFrameComponent") || null;
    }
    if (!dialog || typeof dialog.close !== "function") {
      throw new TopWarError("RANK_CLOSE_METHOD_MISSING", "랭킹 프레임의 close 메서드를 찾지 못했습니다.");
    }
    dialog.close();
    await this.waitForComponent(name, { signal, timeoutMs, active: false });
    return { ok: true, method: "DialogFrameComponent.close" };
  }

  async waitForRankRows(kind, requiredCount, { signal, timeoutMs = 20000 } = {}) {
    const name = kind === "players" ? "WorldServerPowerRank" : "WorldServerAlliancePowerRank";
    const startedAt = Date.now();
    let lastCount = 0;
    while (Date.now() - startedAt < timeoutMs) {
      if (signal?.aborted) throw abortError();
      const component = this.activeComponent(name);
      const rows = component?._rankList;
      lastCount = Array.isArray(rows) ? rows.length : 0;
      if (component && lastCount >= requiredCount) {
        return { component, rows, count: lastCount, elapsedMs: Date.now() - startedAt };
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new TopWarError(
      "RANK_DATA_TIMEOUT",
      `${kind === "players" ? "개인" : "길드"} 랭킹 데이터가 ${lastCount}/${requiredCount}에서 시간 초과되었습니다.`
    );
  }

  async waitForComponent(name, { signal, timeoutMs = 8000, active = true } = {}) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (signal?.aborted) throw abortError();
      const component = this.activeComponent(name);
      if ((active && component) || (!active && !component)) {
        return { ok: true, component, elapsedMs: Date.now() - startedAt };
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new TopWarError(
      "COMPONENT_WAIT_TIMEOUT",
      `${name} ${active ? "활성화" : "종료"}를 기다리다 시간 초과되었습니다.`
    );
  }

  snapshot() {
    const scene = this.requireScene();
    const nodes = this.walk(scene);
    const activeNodes = nodes.filter(isNodeActive);
    const components = [];
    const buttons = [];
    const texts = [];

    for (const node of activeNodes) {
      const path = nodePath(node);
      const ownTexts = ownNodeText(node);
      for (const text of ownTexts) texts.push({ text, path });
      for (const component of nodeComponents(node)) {
        const name = componentName(component);
        components.push({ name, nodeName: String(node.name || ""), path });
        const clickEvents = component?.clickEvents;
        if (Array.isArray(clickEvents)) {
          buttons.push({
            nodeName: String(node.name || ""),
            path,
            text: ownTexts.join(" | "),
            handlers: clickEvents.map(describeClickHandler)
          });
        }
      }
    }

    const componentCounts = components.reduce((acc, row) => {
      acc[row.name] = (acc[row.name] || 0) + 1;
      return acc;
    }, {});

    const activeScreen = this.activeComponent("WorldServerPowerRank")
      ? "personal-rank"
      : this.activeComponent("WorldServerAlliancePowerRank")
        ? "alliance-rank"
        : this.activeComponent("WorldServerTheaterPanel")
          ? "theater"
          : this.activeComponent("WorldServerListPanel")
            ? "server-list"
            : "scene";

    return {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      url: location.href,
      scene: String(scene.name || ""),
      activeScreen,
      totals: {
        nodes: nodes.length,
        activeNodes: activeNodes.length,
        components: components.length,
        buttons: buttons.length,
        texts: texts.length
      },
      knownComponents: Object.fromEntries(
        KNOWN_COMPONENTS.map(name => [name, {
          total: this.findComponents(name).length,
          active: this.findComponents(name, { activeOnly: true }).length
        }])
      ),
      serverContext: this.detectServerContext(),
      componentCounts,
      components,
      buttons,
      texts
    };
  }
}
