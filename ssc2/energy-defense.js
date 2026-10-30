
(async () => {
  const scene = cc.director.getScene();
  const stack = [scene];
  let popup = null;

  // 랭킹 팝업 검색
  while (stack.length) {
    const node = stack.pop();

    if (!node || !cc.isValid(node) ||
        !node.activeInHierarchy) continue;

    if (node.name === "CQ26ArkRankPop") {
      popup = node;
      break;
    }

    stack.push(...(node.children || []));
  }

  if (!popup) {
    console.error("랭킹 팝업을 열어주세요.");
    return;
  }

  const scroll = popup.getChildByName("bg")
    ?.getChildByName("scrollView");

  const component = (scroll?._components || [])
    .find(c => Array.isArray(c.rankList));

  const list = component?.rankList;

  if (!list?.length) {
    console.error("랭킹 데이터가 없습니다.");
    return;
  }

  // UID 변환
  function toId(v) {
    if (v == null) return "";

    const low = v.low ?? v._low;
    const high = v.high ?? v._high;

    if (typeof low === "number" &&
        typeof high === "number") {
      let n = (BigInt(high >>> 0) << 32n) |
              BigInt(low >>> 0);
      if (!(v.unsigned ?? v._unsigned) && high < 0) {
        n -= 1n << 64n;
      }
      return String(n);
    }

    return String(v);
  }

  // 필요한 5개 항목만 추출
  const players = list.map((p, i) => {
    let info = p.playerInfo || {};

    if (typeof info === "string") {
      try {
        info = JSON.parse(info);
      } catch {
        info = {};
      }
    }

    return {
      rank: p.rank ?? i + 1,
      serverId: p.sid ?? p.serverId ??
                info.sid ?? info.serverId ?? null,
      uid: toId(p.uid),
      username: info.username ??
                info.name ?? p.username ?? "",
      score: p.score ?? 0
    };
  });

  // 구글 스프레드시트용 TSV
  const header = [
    "순위", "서버", "UID", "닉네임", "포인트"
  ];

  const tsv = [
    header.join("\t"),
    ...players.map(p => [
      p.rank,
      p.serverId,
      p.uid,
      p.username,
      p.score
    ].map(v => String(v ?? "")
      .replace(/[\t\r\n]/g, " ")
    ).join("\t"))
  ].join("\n");

  window.CQ26_ARK_PLAYERS = players;
  window.CQ26_ARK_TSV = tsv;

  // 클립보드 복사
  let copied = false;

  try {
    await navigator.clipboard.writeText(tsv);
    copied = true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = tsv;
    textarea.style.cssText =
      "position:fixed;left:-9999px;top:0";

    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      copied = document.execCommand("copy");
    } finally {
      textarea.remove();
    }
  }

  // JSON 저장
  const blob = new Blob(
    [JSON.stringify(players, null, 2)],
    { type: "application/json;charset=utf-8" }
  );

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = `CQ26-Ark-Ranking-${Date.now()}.json`;

  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 15000);

  console.table(players);
  console.log(`총 ${players.length}명 추출 완료`);

  if (copied) {
    console.log("클립보드 복사 완료 → Ctrl+V");
  } else {
    console.warn(
      "자동 복사 실패: copy(window.CQ26_ARK_TSV) 실행"
    );
  }
})();
