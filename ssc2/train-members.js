
window.CQ26_TRAIN_MEMBERS_PROMISE = (async () => {
  const stack = [cc.director.getScene()];
  let popup = null;
  let scanned = 0;

  while (stack.length && scanned++ < 14000) {
    const n = stack.pop();
    if (!n || !cc.isValid(n) || !n.activeInHierarchy)
      continue;

    if (
      n.name === "CQ26TrainTroopsInfoPanel"
      || n.name === "CQ26TrainTroopInfoPanel"
      || /train.*troops?.*info|troops?.*info.*train/i.test(String(n.name || ""))
    ) {
      popup = n;
      break;
    }

    stack.push(...(n.children || []));
  }

  if (!popup) {
    throw new Error("설원 열차의 부대 정보 창을 열어주세요.");
  }

  // 게임 업데이트로 _infoList가 팝업 루트가 아닌 하위 노드로 이동해도 찾는다.
  const candidates = [];
  const queue = [{ node: popup, path: String(popup.name || "CQ26TrainTroopsInfoPanel") }];
  let inspectedNodes = 0;
  while (queue.length && inspectedNodes++ < 4000) {
    const current = queue.pop();
    const node = current.node;
    if (!node || !cc.isValid(node) || node.activeInHierarchy === false) continue;
    for (const component of node._components || []) {
      for (const field of Object.keys(component)) {
        let value;
        try { value = component[field]; } catch { continue; }
        if (!Array.isArray(value) || !value.length) continue;
        const entry = value.find(item => item && typeof item === "object");
        const sample = entry?._data ?? entry;
        if (!sample || typeof sample !== "object") continue;
        const keys = Object.keys(sample);
        let score = field === "_infoList" ? 30 : 0;
        if (/info|member|player|troop/i.test(field) && /list/i.test(field)) score += 16;
        if (keys.includes("playerInfo")) score += 12;
        if (keys.includes("userInfo")) score += 6;
        if (keys.includes("uid")) score += 8;
        if (keys.includes("serverId") || keys.includes("sid")) score += 5;
        if (score >= 12) candidates.push({ score, path: current.path, field, value });
      }
    }
    for (const child of node.children || []) {
      queue.push({ node: child, path: `${current.path}/${child.name || "<unnamed>"}` });
    }
  }
  candidates.sort((a, b) => b.score - a.score || b.value.length - a.value.length);
  const selected = candidates[0];
  const list = selected?.value;

  if (!list?.length) {
    throw new Error("열차 참여자 데이터가 없습니다. 창이 완전히 열린 뒤 다시 실행하세요.");
  }

  function parse(v) {
    if (typeof v === "string") {
      try { return JSON.parse(v); }
      catch { return { username: v }; }
    }
    return v && typeof v === "object" ? v : {};
  }

  function toId(v) {
    if (v == null) return "";

    const low = v.low ?? v._low;
    const high = v.high ?? v._high;

    if (typeof low === "number" &&
        typeof high === "number") {
      let n = (BigInt(high >>> 0) << 32n) |
              BigInt(low >>> 0);

      if (!(v.unsigned ?? v._unsigned) && high < 0)
        n -= 1n << 64n;

      return String(n);
    }

    return String(v);
  }

  const players = list.filter(Boolean).map((entry, i) => {
    const p = entry?._data ?? entry;
    const info = parse(p.playerInfo);
    const user = parse(p.userInfo);

    const tag = p.aTag ?? info.aTag ?? "";

    return {
      order: i + 1,
      serverId: p.serverId ?? p.sid ??
                info.serverId ?? user.serverId ?? "",
      uid: toId(p.uid ?? info.uid ?? user.uid),
      alliance: typeof tag === "object"
        ? (tag.name ?? tag.tag ?? "")
        : String(tag),
      username: info.username ?? info.name ??
                user.username ?? p.username ??
                p.name ?? ""
    };
  });

  const clean = v => String(v ?? "")
    .replace(/[\t\r\n]/g, " ");

  const tsv = [
    ["번호", "서버", "UID", "동맹", "닉네임"].join("\t"),
    ...players.map(p => [
      p.order,
      p.serverId,
      p.uid ? `'${p.uid}` : "",
      p.alliance,
      p.username
    ].map(clean).join("\t"))
  ].join("\n");

  window.CQ26_TROOPS_PLAYERS = players;
  window.CQ26_TROOPS_TSV = tsv;

  const missing = players.filter(
    p => !p.uid || !p.username
  );

  console.log(`참여자 데이터 ${players.length}명`);
  console.table(players);

  if (missing.length) {
    console.warn(
      `UID 또는 닉네임 누락: ${missing.length}명`
    );
    console.log("원본 첫 항목:", list[0]);
    console.log("누락 항목:", missing);
    throw new Error(`참여자 ${players.length}명 중 ${missing.length}명의 UID 또는 닉네임이 없습니다.`);
  }

  let copied = false;
  try {
    await navigator.clipboard.writeText(tsv);
    copied = true;
  } catch {}
  if (!copied) {
    const textarea = document.createElement("textarea");
    textarea.value = tsv;
    textarea.style.cssText = "position:fixed;left:-99999px;top:-99999px;opacity:0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try { copied = document.execCommand("copy"); } finally { textarea.remove(); }
  }
  if (!copied && typeof window.copy === "function") {
    window.copy(tsv);
    copied = true;
  }
  if (!copied) throw new Error(`${players.length}명은 조사했지만 클립보드 복사에 실패했습니다.`);

  const result = {
    count: players.length,
    copied,
    source: { path: selected.path, field: selected.field },
    players
  };
  window.CQ26_TRAIN_MEMBERS_RESULT = result;
  console.log(`${players.length}명 클립보드 복사 완료! Ctrl+V`, result.source);
  return result;
})();
