# 봉인석 시즌2

원하는 정보가 담긴 목록 열어두고 개발자 도구에서 사용

## 에너지 방어 인원 목록

열어야 하는 화면 

<img width="503" height="875" alt="image" src="https://github.com/user-attachments/assets/49cd8de8-3882-46df-b939-d84ba427ffc7" />

실행시켜야 할 코드

```js
fetch("https://raw.githubusercontent.com/hiphop5782/topwar-inline-script/refs/heads/main/ssc2/energy-defense.js").then(r=>{if(!r.ok)throw Error(r.status);return r.text()}).then(code=>(0,eval)(code)).catch(console.error);
```

## 설원 열차 인원 목록

열어야 하는 화면 

<img width="494" height="867" alt="image" src="https://github.com/user-attachments/assets/ced8ad85-52b2-4058-a76c-96bf1d2199a2" />

실행시켜야 할 코드

```js
fetch("https://raw.githubusercontent.com/hiphop5782/topwar-inline-script/refs/heads/main/ssc2/train-members.js").then(r=>{if(!r.ok)throw Error(r.status);return r.text()}).then(code=>(0,eval)(code)).catch(console.error);
```

## 매머드 전투 주둔목록

열어야 하는 화면

<img width="500" height="871" alt="image" src="https://github.com/user-attachments/assets/244c219c-7a3f-4e13-8953-8fdada571adf" />

실행시켜야 할 코드

```js
fetch("https://raw.githubusercontent.com/hiphop5782/topwar-inline-script/refs/heads/main/ssc2/mammoth_defense.js").then(r=>{if(!r.ok)throw Error(r.status);return r.text()}).then(code=>(0,eval)(code)).catch(console.error);
```
