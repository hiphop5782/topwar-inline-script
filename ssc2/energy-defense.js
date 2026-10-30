
(() => {
  const sources = window.CQ26_ARK_INSPECT?.sources || [];

  const list = sources.find(
    x => x.component === "EniConquerorRankListComponent" &&
         x.field === "rankList"
  )?.raw;

  if (!Array.isArray(list)) {
    console.error("rankList를 찾지 못했습니다.");
    return;
  }

  function toId(value) {
    if (value == null) return null;

    if (typeof value === "object" &&
        typeof value.low === "number" &&
        typeof value.high === "number") {
      let n = (BigInt(value.high >>> 0) << 32n) |
              BigInt(value.low >>> 0);
      if (!value.unsigned && value.high < 0) {
        n -= 1n << 64n;
      }
      return String(n);
    }

    return String(value);
  }

  const players = list.map((p, index) => {
    let info = p.playerInfo || {};

    if (typeof info === "string") {
      try {
        info = JSON.parse(info);
      } catch {
        info = { raw: info };
      }
    }

    return {
      rank: p.rank ?? index + 1,
      serverId: p.sid ?? info.sid ?? null,
      uid: toId(p.uid),
      username: info.username ??
                info.name ??
                p.username ??
                null,
      score: p.score ?? null,
      headFrameId: p.headFrameId ?? null
    };
  });

  console.log("전체 랭킹:", players.length, "명");
  console.table(players);

  window.CQ26_ARK_PLAYERS = players;

  const blob = new Blob(
    [JSON.stringify(players, null, 2)],
    { type: "application/json;charset=utf-8" }
  );

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = "CQ26-Ark-Ranking.json";
  a.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
})();
