# TopWar All-in-One UI

기존에 동작하던 스크립트의 수집·자동화 로직을 변경하지 않고 하나의 Tampermonkey
파일과 통합 UI에서 사용할 수 있도록 연결합니다.

## 원칙

- `worldmap-scanner-latest.js`는 원본 그대로 메인 런타임으로 포함합니다.
- 통합 UI는 기존 버튼과 `TOPWAR`, `REALPOWER` API를 DOM 컴포넌트에 연결합니다.
- 별도 도구는 원본 코드를 번들에 보관하고, 도구 탭에서 선택할 때만 실행합니다.
- 수집 형식, 서버 이동, 업로드, 재시도 알고리즘은 통합 UI에서 재작성하지 않습니다.

## 포함 도구

- 월드맵, 도시 보상, 도둑, TOP100, 보상 추적
- 캐릭터 판매·영웅 조사
- Cross PVP TOP100
- CQ26 설원 열차
- Kartz 랭킹
- HT Chip
- 영웅 이미지 추출
- SSC2 에너지 방어·맘모스 방어·열차 멤버
- 길드 공헌도

## 빌드

```powershell
npm install
npm run build
```

설치할 단일 파일:

```text
dist/topwar-allinone.user.js
```

Tampermonkey에 위 파일 하나만 설치합니다. 기존 메인 기능은 `조사` 탭에서 그대로
사용하고, 다른 원본 도구는 `도구` 탭에서 `불러오기` 또는 `실행`을 누릅니다.

`npm run build:prototype`은 이전 UI 탐색 실험용 빌드이며 실제 통합판이 아닙니다.
