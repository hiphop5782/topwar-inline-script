
window.CQ26_MAMMOTH_DEFENSE_PROMISE = (async () => {
  const TARGET = "CQ26DBRankView";
  const stack = [cc.director.getScene()];
  let popup = null;
  let scanned = 0;

  // 팝업 검색
  while (stack.length && scanned++ < 14000) {
    const n = stack.pop();
    if (!n || !cc.isValid(n) || !n.activeInHierarchy)
      continue;

    if (
      n.name === TARGET
      || /(?:CQ26|DB|Mammoth|Boss).*Rank(?:View|Panel)/i.test(String(n.name || ""))
    ) {
      popup = n;
      break;
    }

    stack.push(...(n.children || []));
  }

  if (!popup) {
    throw new Error("맘모스 방어 수위병 랭킹 창을 열어주세요.");
  }

  function cname(c) {
    return c.__classname__ ||
      cc.js?.getClassName?.(c) ||
      c.constructor?.name || "";
  }

  // 현재 선택된 랭킹 배열과 하단의 본인 순위 데이터를 탐색한다.
  const candidates = [];
  const selfCandidates = [];
  const queue = [{node: popup, path: TARGET}];

  function addCandidate(value, path, component, field) {
    if (!Array.isArray(value) || !value.length) return;

    const sampleEntry = value.find(
      x => x && typeof x === "object"
    );
    const sample = sampleEntry?._data ?? sampleEntry;
    if (!sample) return;

    const keys = Object.keys(sample);
    let score = 0;

    if (/rankList/i.test(field)) score += 20;
    else if (/rank|player|data|info/i.test(field)) score += 8;
    if (keys.includes("rank")) score += 10;
    if (keys.includes("score") || keys.includes("point") || keys.includes("points")) score += 8;
    if (keys.includes("playerInfo")) score += 6;
    if (keys.includes("uid")) score += 5;
    if (keys.includes("serverId")) score += 3;
    if (keys.includes("sid")) score += 2;
    if (keys.includes("aTag")) score += 1;

    if (score < 4) return;

    candidates.push({
      path, component, field,
      length: value.length,
      keys: keys.join(", "),
      score,
      raw: value
    });
  }

  let inspected = 0;

  while (queue.length && inspected++ < 4000) {
    const {node, path} = queue.pop();
    if (!cc.isValid(node)) continue;

    for (const c of node._components || []) {
      const name = cname(c);

      for (const key of Object.keys(c)) {
        let value;
        try { value = c[key]; }
        catch { continue; }

        addCandidate(value, path, name, key);

        if (value && !Array.isArray(value) && typeof value === "object") {
          const row = value._data ?? value;
          const rowKeys = Object.keys(row || {});
          if (
            rowKeys.includes("rank")
            && (rowKeys.includes("playerInfo") || rowKeys.includes("uid"))
            && (rowKeys.includes("score") || rowKeys.includes("point") || rowKeys.includes("points"))
          ) {
            selfCandidates.push({ path, component: name, field: key, raw: row });
          }
        }

        if (
          value && !Array.isArray(value) &&
          typeof value === "object" &&
          /data|list|info|member|player/i.test(key)
        ) {
          for (const subKey of Object.keys(value).slice(0, 40)) {
            try {
              addCandidate(
                value[subKey], path, name,
                key + "." + subKey
              );
            } catch {}
          }
        }
      }
    }

    for (const n of node.children || []) {
      queue.push({
        node: n,
        path: path + "/" + n.name
      });
    }
  }

  candidates.sort(
    (a, b) => b.score - a.score || b.length - a.length
  );

  console.log("=== 수위병 랭킹 배열 후보 ===");
  console.table(candidates.map(
    ({raw, ...rest}) => rest
  ));

  window.CQ26_DB_CANDIDATES = candidates;

  const selected = candidates[0];

  if (!selected || selected.score < 6) {
    throw new Error("맘모스 방어 랭킹 배열을 찾지 못했습니다. 수위병 랭킹 창이 완전히 열린 뒤 다시 실행하세요.");
  }

  console.log("선택된 배열:", selected.field);
  console.log("원본 첫 항목:", selected.raw[0]);

  // 데이터 변환
  function parse(value) {
    if (typeof value === "string") {
      try { return JSON.parse(value); }
      catch { return {}; }
    }
    return value && typeof value === "object"
      ? value : {};
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

  const rawRows = [...selected.raw];
  for (const candidate of selfCandidates) {
    const row = candidate.raw;
    const duplicate = rawRows.some(entry => {
      const current = entry?._data ?? entry;
      return (row.uid != null && current?.uid != null && toId(row.uid) === toId(current.uid))
        || (row.rank != null && current?.rank === row.rank && row.playerInfo === current?.playerInfo);
    });
    if (!duplicate) rawRows.push(row);
  }

  const players = rawRows
    .filter(p => p && typeof p === "object")
    .map((entry, i) => {
      const p = entry._data ?? entry;
      const user = parse(p.userInfo);
      const info = parse(
        p.playerInfo ?? user.playerInfo
      );
      return {
        rank: Number(p.rank ?? p.ranking ?? p.no ?? i + 1) || i + 1,
        serverId: p.serverId ?? p.sid ??
          info.serverId ?? info.sid ?? user.serverId ?? user.sid ?? "",
        uid: toId(p.uid ?? info.uid ?? user.uid),
        username: info.username ?? info.name ??
          info.nickName ?? user.username ??
          p.username ?? p.name ?? "",
        points: Number(p.score ?? p.point ?? p.points ?? p.value ?? 0) || 0
      };
    })
    .filter((player, index, rows) => rows.findIndex(other =>
      (player.uid && other.uid === player.uid)
      || (!player.uid && other.rank === player.rank && other.username === player.username)
    ) === index)
    .sort((a, b) => a.rank - b.rank);

  window.CQ26_DB_PLAYERS = players;
  window.CQ26_DB_RANKINGS = players;

  console.log("수위병 랭킹:", players.length, "명");
  console.table(players);

  const missing = players.filter(
    p => !p.uid || !p.username
  );

  if (missing.length) {
    console.warn(
      `UID 또는 닉네임 누락 ${missing.length}명:`,
      missing
    );
    console.warn(
      "원본 구조를 확인해야 하므로 복사는 보류합니다."
    );
    throw new Error(`랭킹 ${players.length}명 중 ${missing.length}명의 UID 또는 닉네임이 없습니다.`);
  }

  const safe = v => String(v ?? "")
    .replace(/[\t\r\n]/g, " ");

  const tsv = [
    "순위\t서버\tUID\t닉네임\t개인 포인트",
    ...players.map(p => [
      p.rank, p.serverId, p.uid ? `'${p.uid}` : "",
      p.username, p.points
    ].map(safe).join("\t"))
  ].join("\n");

  window.CQ26_DB_TSV = tsv;

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
    source: { path: selected.path, component: selected.component, field: selected.field },
    players
  };
  window.CQ26_MAMMOTH_DEFENSE_RESULT = result;
  console.log(`${players.length}명 클립보드 복사 완료 → Ctrl+V`, result.source);
  return result;
})();
