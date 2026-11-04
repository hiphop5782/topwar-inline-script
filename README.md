# topwar-inline-script

TopWar 데이터 조사 및 자동화 스크립트 모음입니다.

## 통합 UI 스크립트

통합 UI는 [`unified`](./unified)에서 개발합니다. 기존 기능 코드는 수정하거나
재구현하지 않고 원본 그대로 번들에 포함하며, UI 탭에서 기존 컴포넌트와 실행 API를
연결합니다.

- 모듈 소스: `unified/src`
- Tampermonkey 빌드: `unified/dist/topwar-allinone.user.js`
