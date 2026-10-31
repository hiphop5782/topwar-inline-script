
(() => {
  const TARGET = "CQ26DBTroopsInfoPanel";
  const stack = [cc.director.getScene()];
  let popup = null;
  let scanned = 0;

  // 팝업 검색
  while (stack.length && scanned++ < 14000) {
    const n = stack.pop();
    if (!n || !cc.isValid(n) || !n.activeInHierarchy)
      continue;

    if (n.name === TARGET) {
      popup = n;
      break;
    }

    stack.push(...(n.children || []));
  }

  if (!popup) {
    console.error("방어 보스 부대 정보 창을 열어주세요.");
    return;
  }

  function cname(c) {
    return c.__classname__ ||
      cc.js?.getClassName?.(c) ||
      c.constructor?.name || "";
  }

  // 참여자 데이터 배열 탐색
  const candidates = [];
  const queue = [{node: popup, path: TARGET}];

  function addCandidate(value, path, component, field) {
    if (!Array.isArray(value) || !value.length) return;

    const sample = value.find(
      x => x && typeof x === "object"
    );
    if (!sample) return;

    const keys = Object.keys(sample);
    let score = 0;

    if (/infoList|memberList|playerList/i.test(field))
      score += 10;
    if (keys.includes("playerInfo")) score += 5;
    if (keys.includes("uid")) score += 4;
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

  console.log("=== 참여자 배열 후보 ===");
  console.table(candidates.map(
    ({raw, ...rest}) => rest
  ));

  window.CQ26_DB_CANDIDATES = candidates;

  const selected = candidates[0];

  if (!selected || selected.score < 6) {
    console.warn("참여자 배열 확인이 필요합니다.");
    return;
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

  const players = selected.raw
    .filter(p => p && typeof p === "object")
    .map((entry, i) => {
      const p = entry._data ?? entry;
      const user = parse(p.userInfo);
      const info = parse(
        p.playerInfo ?? user.playerInfo
      );
      const tag = p.aTag ?? info.aTag ?? "";

      return {
        order: i + 1,
        serverId: p.serverId ?? p.sid ??
          info.serverId ?? user.serverId ?? "",
        uid: toId(p.uid ?? info.uid ?? user.uid),
        alliance: typeof tag === "object"
          ? (tag.tag ?? tag.name ?? "")
          : String(tag),
        username: info.username ?? info.name ??
          info.nickName ?? user.username ??
          p.username ?? p.name ?? ""
      };
    });

  window.CQ26_DB_PLAYERS = players;

  console.log("참여자:", players.length, "명");
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
    return;
  }

  const safe = v => String(v ?? "")
    .replace(/[\t\r\n]/g, " ");

  const tsv = [
    "번호\t서버\tUID\t동맹\t닉네임",
    ...players.map(p => [
      p.order, p.serverId, p.uid,
      p.alliance, p.username
    ].map(safe).join("\t"))
  ].join("\n");

  window.CQ26_DB_TSV = tsv;

  if (typeof copy === "function") {
    copy(tsv);
    console.log(
      `${players.length}명 클립보드 복사 완료 → Ctrl+V`
    );
  } else {
    console.log(
      "복사 명령: copy(window.CQ26_DB_TSV)"
    );
  }
})();
