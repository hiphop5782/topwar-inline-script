# EL 공헌도 체크 유틸

EL 기간동안 사용할 수 있는 공헌도 체크용 플러그인입니다.  
이 코드는 PC 탑워에서만 사용하실 수 있으며 `Chrome` 브라우저 사용을 권장합니다.

## 사용법

1. Topwar PC버전 실행
2. 개발자 도구 실행
3. 플러그인 설치 코드 작성
4. 길드원 명단 추출
5. 공헌도 명단 추출
6. 복사
7. 스프레드시트에 붙여넣기

## 1. Topwar PC버전 실행

Topwar PC버전을 실행합니다.  
앱이 아닌 브라우저에서 실행해야 합니다.

## 2. 개발자 도구 실행

`도구 더보기` - `개발자 도구` 를 눌러 실행합니다.

<img width="581" height="251" alt="image" src="https://github.com/user-attachments/assets/7db6e72c-9b4e-4452-b5a1-14fb8998190e" />

## 3. 플러그인 설치 코드 작성

한번도 개발자 도구를 사용한 적이 없다면 개발자 도구는 보안상 코드를 붙여넣는걸 허용하지 않습니다.  
`allow pasting`을 입력하고 엔터를 친 이후부터 코드 붙여넣기가 가능합니다.  

```javascript
(async()=>{const u="https://cdn.jsdelivr.net/gh/hiphop5782/topwar-inline-script/el-contribution-checker/el-contribution-checker.min.js";const r=await fetch(u,{cache:"no-store"});if(!r.ok)throw Error(`스크립트 다운로드 실패: ${r.status}`);(0,eval)(await r.text())})();
```

정상적으로 설치되었다면 다음과 같은 코멘트가 나옵니다.

<img width="394" height="199" alt="image" src="https://github.com/user-attachments/assets/1b1ea7aa-02c1-417f-8643-ba3743ea8d08" />

## 4. 길드원 명단 추출

길드의 길드원 탭을 열고 다음 명령을 개발자 콘솔에 작성합니다.

```js
await guildAudit.members();
```

## 5. 길드원 공헌도 명단 추출

길드의 공헌 메뉴를 누르고 조사하고 싶은 메뉴 탭으로 이동한 뒤 개발자 콘솔에 다음과 같이 작성합니다.

```js
await guildAudit.contributions();
```

## 6. 최종 결과를 복사

4번과 5번에서 각각 추출한 데이터는 현재 따로 저장되어 있으므로 이를 합쳐서 외부로 내보낼 수 있게 다음 명령을 작성하여 복사를 시도합니다.

```js
await guildAudit.copy();
```

## 7. 스프레드시트에 복사

복사된 내용을 스프레드시트에 넣으시면 길드원 명단과 해당 공헌 수치에 대한 랭킹을 확인하실 수 있습니다.
