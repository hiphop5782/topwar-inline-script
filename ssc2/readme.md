# 봉인석 시즌2

에너지 방어 정보 추출기
목록 열어두고 개발자 도구에서 사용

# 사용할 스크립트

```js
fetch("https://raw.githubusercontent.com/hiphop5782/topwar-inline-script/refs/heads/main/ssc2/energy-defense.js").then(r=>{if(!r.ok)throw Error(r.status);return r.text()}).then(code=>(0,eval)(code)).catch(console.error);
```
