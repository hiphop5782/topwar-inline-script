
(() => {
  const stack = [cc.director.getScene()];
  let popup = null;
  let scanned = 0;

  while (stack.length && scanned++ < 14000) {
    const n = stack.pop();
    if (!n || !cc.isValid(n) || !n.activeInHierarchy)
      continue;

    if (n.name === "CQ26TrainTroopsInfoPanel") {
      popup = n;
      break;
    }

    stack.push(...(n.children || []));
  }

  if (!popup) {
    console.error("부대 정보 창을 열어주세요.");
    return;
  }

  const component = (popup._components || [])
    .find(c => Array.isArray(c._infoList));

  const list = component?._infoList;

  if (!list?.length) {
    console.error("참여자 데이터가 없습니다.");
    return;
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

  const players = list.filter(Boolean).map((p, i) => {
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
      p.uid,
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
    console.warn(
      "데이터 확인 후 복사하세요."
    );
    return;
  }

  try {
    if (typeof copy === "function") {
      copy(tsv);
      console.log("클립보드 복사 완료! Ctrl+V");
    } else {
      console.log(
        "복사 명령: copy(window.CQ26_TROOPS_TSV)"
      );
    }
  } catch (e) {
    console.warn("자동 복사 실패:", e);
    console.log(
      "직접 실행: copy(window.CQ26_TROOPS_TSV)"
    );
  }
})();
