# 확률 기반 사이트 차단 확장 프로그램

## 프로젝트 개요
고등학교 정보과학 수업 프로젝트 (8차시).
차단된 사이트에 접속하면 확률로 통과 여부를 판정하고,
통과 시 하루 한도 안에서 고른 시간만큼만 접속을 허용한다.

만드는 것:
1. **크롬 확장 프로그램** (메인) — 차단, 판정, 타이머 ← 거의 완성
2. **웹 대시보드** — 기록 통계, Vercel 배포, Supabase 연동 ← 지금 여기

일정: 1~5차시 프론트, 6~8차시 Supabase

---

## 작업 방식 (제일 중요)
- **나는 웹 개발 초보다.** 코드를 한 번에 다 만들지 말고 작은 단위로
  나눠서 진행하고, 각 코드가 무슨 역할인지 설명해줘.
- 내가 이해하고 **직접 수정할 수 있는 수준**을 목표로 한다.
  변수명은 알아보기 쉽게, 주석은 "왜 이렇게 했는지" 위주로.
- 파일을 새로 만들거나 크게 고치기 전에 **먼저 물어보고 설명해줘.**
- 화면 꾸미기(CSS)는 나중에 한 번에 할 거라 지금은 최소한으로만.

---

## 실행 / 테스트 방법

빌드 과정 없음. 순수 HTML/CSS/JS라 파일을 그대로 크롬에 올린다.

1. `chrome://extensions` → 개발자 모드 켜기 → "압축해제된 확장 프로그램을 로드"
2. **코드를 고친 뒤에는 반드시 카드의 새로고침(↻) 버튼을 누를 것.**
   특히 `manifest.json`을 고쳤으면 필수다.
3. **차단 화면 탭도 F5로 새로고침할 것.** 열려 있던 탭은 옛 코드를 그대로 들고 있다.

**설정 화면 여는 법 3가지** (카드에는 안 나온다):
- 주소창 오른쪽 **퍼즐 조각(🧩)** → 확장 이름 클릭 (압정으로 고정 가능)
- 차단 화면의 **[설정]** 버튼
- `chrome://extensions` → **세부정보** → 맨 아래 "확장 프로그램 옵션"
- 급하면 주소 직접: `chrome-extension://<확장ID>/options.html` (북마크해두면 편함)

**오류 확인**: `chrome://extensions`에서 **"서비스 워커"** 링크를 누르면
`background.js` 전용 콘솔이 열린다. Supabase 관련 경고는 `[supabase]`로 시작한다.

**시간 건너뛰기**: 차단 화면 맨 아래 테스트 칸에서 경과 시간과 오늘 사용량을
강제로 설정할 수 있다. `config.js`의 **`devMode`** 로 켜고 끈다.
제출할 때 `false`로 바꾸면 칸이 사라지고 요청 자체도 무시된다.

---

## 전체 흐름

```
유튜브 접속
   ↓  rules.json (정적 규칙, priority 1) 이 blocked.html로 리다이렉트
차단 화면 — 확률 표시, 1초마다 갱신
   ↓  [시도하기]
background.js가 난수(0~100)를 뽑아 확률과 비교
   │   → 결과를 Supabase attempts 테이블에 한 줄 기록
   │
   ├─ 주사위 < 확률 → 통과
   │      ↓  +5/+10/-5/-10 버튼으로 1분 ~ 남은 한도 사이에서 직접 정함
   │   background가 분 수를 다시 검사 (화면 값을 믿지 않는다)
   │   priority 2짜리 allow 동적 규칙을 덮어씌워 차단 해제
   │   사용량을 미리 차감 + chrome.alarms 예약
   │   → Supabase sessions 테이블에 한 줄 기록
   │      ↓  유튜브로 이동. timer.js가 우측 상단에 남은 시간 표시
   │   알람 발동 → allow 규칙 제거 → 열린 유튜브 탭 강제 새로고침
   │      ↓
   │   다시 차단 화면. 이 시각이 새 기준 (확률 0%부터 다시)
   │
   └─ 주사위 ≥ 확률 → 거부
          경과 시간이 0으로 초기화 (대기 시간은 없음)
```

---

## 파일 구조

| 파일 | 역할 |
|---|---|
| `manifest.json` | 확장 설정. 권한, background, options_page, action, content_scripts |
| `rules.json` | 정적 차단 규칙. youtube.com(main_frame) → blocked.html |
| `config.js` | **확률·시간 관련 모든 숫자의 공장 초기값.** + `devMode` |
| `probability.js` | `calcProb(경과분, 사용분, 설정)` → 확률(%). 계산만 한다 |
| `background.js` | 서비스 워커. 판정, 설정, 차단 해제/재차단, 알람, 저장 |
| `blocked.html` / `blocked.js` | 차단 화면. 확률 표시, 시도, 이용 시간 정하기 |
| `options.html` / `options.js` | 설정 화면. 슬라이더, 곡선 미리보기, 점 끌기 |
| `timer.js` | content script. 유튜브 페이지 위에 남은 시간을 띄운다 |
| `supabase.js` | 기록을 Supabase로 보내는 부분. 보내기만 한다 |
| `secrets.example.js` | Supabase 키를 넣는 틀. 저장소에 올라감 |
| `secrets.js` | **실제 키. `.gitignore`에 있어 저장소에 없다** |
| `supabase/schema.sql` | 테이블 + RLS 생성 SQL. SQL Editor에 붙여넣어 실행 |

### 역할 분리 원칙
- `probability.js` — **순수 계산만.** 저장·화면·난수 전부 금지.
  따로 떼어내서 검산할 수 있어야 한다
- `background.js` — 상태·설정·판정의 **유일한 주인.** 난수도 여기서만 뽑는다
- `blocked.js` / `timer.js` / `options.js` — **묻고 그리기만.**
  단, `options.js`는 미리보기 곡선만 직접 계산한다 (점을 끌 때마다
  background에 왕복하면 느려서). 그래서 `calcProb`가 설정을 인자로 받는다
- `supabase.js` — **보내기만.** 무엇을 보낼지는 background가 정한다

서비스 워커가 classic이라 전부 **전역 스크립트**다 (ES 모듈 아님).
`importScripts`로 불러오기 때문. `manifest.json`에 `"type": "module"`이 없다.

---

## 확률 수식

값은 `config.js`가 공장 초기값을 들고 있고, 사용자가 바꾼 값은 storage에 저장된다.
**기본 개형은 `points`(점 잇기).** `curve` 값으로 넷 중 하나를 고른다.

**points — 점 잇기 (기본)**
```
(10,3) (30,14) (45,29) (60,48) (80,72) (120,85)
```
- 점 사이를 **단조 삼차 에르미트 보간(Fritsch-Carlson)** 으로 잇는다
- 흔한 Catmull-Rom은 점 사이에서 출렁여 **확률이 내려가는 구간**이 생긴다.
  "앞을 낮게 깔고 뒤에서 올리는" 배치에서 **-4.4%까지** 내려가는 것을 확인했다.
  20분보다 25분의 확률이 낮으면 말이 안 되므로 안 쓴다
- **0분은 목록에 없어도 항상 0%로 친다.** 계산할 때 `(0,0)`을 자동으로 끼워넣는다.
  없으면 첫 점이 10분이라 0~10분이 3%로 평평해진다
- 마지막 점 이후는 마지막 y값 유지
- 설정 화면에서는 **x 고정, y만 위아래로** 끈다

**scurve — S자** `midpoint: 60`, `steepness: 0.05`
```
s(t) = 1 / (1 + exp(-steepness * (t - midpoint)))
p    = 100 * (s(t) - s(0)) / (1 - s(0))
```
> `s(0)`을 빼는 이유: 그냥 쓰면 **0분에서도 4.7%가 나온다.**

**log — 로그** `smoothness: 30`
```
p = A * ln(1 + t / smoothness)
```
> A는 "`anchorMinutes`(80분)에 `anchorProb`(50%)"에서 **역산**한다.

**linear — 직선** `linearFullMin: 150`
```
p = maxProb * (t / linearFullMin)
```

### 공통 보정
- `maxProb: 85` — 상한. 네 개형 모두 여기서 자른다
- `dailyLimit: 60` — 하루 총 이용 한도(분)
- **`usagePenalty: 0`** — 누적 사용량 보정. **꺼져 있다.**
  ```
  ratio  = min(usedToday / dailyLimit, 1)
  factor = 1 - usagePenalty * ratio
  최종   = 기본확률 * factor
  ```
  > **확률은 오직 경과 시간만 본다** (2026-09-13 결정).
  > 사용량 제한은 `dailyLimit`이 담당하고, 남은 한도가 0이면 판정 자체를 안 한다.
  > 기능은 코드에 남아 있으니 값만 올리면 되살아난다.

### 검산표 (파이썬으로 확인함)

`usagePenalty: 0`이라 오늘 사용 시간과 무관하게 아래 값이 그대로 나온다.

| 경과 | **points** (기본) | scurve | log | linear |
|---:|---:|---:|---:|---:|
| 0분 | 0.0% | 0.0% | 0.0% | 0.0% |
| 10분 | 3.0% | 3.0% | 11.1% | 5.7% |
| 20분 | 7.6% | 7.5% | 19.7% | 11.3% |
| 30분 | 14.0% | 14.2% | 26.7% | 17.0% |
| 40분 | 23.5% | 23.3% | 32.6% | 22.7% |
| 60분 | 48.0% | 47.5% | 42.3% | 34.0% |
| 80분 | 72.0% | 71.8% | 50.0% | 45.3% |
| 120분 | 85.0% (상한) | 85.0% | 61.9% | 68.0% |
| 180분 | 85.0% | 85.0% | 74.9% | 85.0% |

기본 점을 scurve와 비슷하게 잡아둬서 값이 거의 같다.
**초반이 아주 느리다** — 급하게 오르는 구간은 40~80분.
화면에서 숫자가 안 움직이는 것처럼 보여도 정상이다.

---

## 경과 시간 규칙

`waitStartAt`(확률 계산의 기준 시각)이 언제 갱신되는지가 핵심이다.

| 상황 | 기준 시각 |
|---|---|
| 설치 후 한 번도 안 씀 | **차단 화면이 처음 뜬 순간** (설치 시점이 아님) |
| 이용이 끝남 | 끝난 그 시각 → 0%부터 다시 |
| **거부당함** | **지금으로 초기화** → 0%부터 다시 |

**거부 시 초기화는 의도된 것이다.** 80분 기다려 72%를 만들었다가 실패하면
다시 80분을 기다려야 한다. 한 번의 판정을 무겁게 만들려는 설계.

**거부 후 대기 시간(쿨타임)은 없앴다** (2026-09-13).
모든 곡선이 0분에서 정확히 0%이므로, 초기화 직후에는 연타해도
`난수 < 0`이 참이 될 수 없다. 대기가 하는 일이 없었다.

---

## 설정 저장 구조

`config.js`의 `CONFIG`는 **공장 초기값**이고, 사용자가 바꾼 값은
storage의 **`settings` 키 하나에 통째로** 들어가 기본값을 덮어쓴다.

**storage를 만지는 곳은 `loadSettings` / `saveSettings` 두 함수뿐이다.**
나중에 Supabase로 옮길 때 이 둘만 고치면 된다.

바꿀 수 있는 항목 (`SETTING_RULES`):
`curve` `midpoint` `steepness` `anchorMinutes` `anchorProb` `smoothness`
`linearFullMin` `points` `maxProb` `dailyLimit` `usagePenalty`

- **허용 범위는 `SETTING_RULES`에만 적는다.** `GET_SETTINGS`가 이 표를
  같이 보내주고 옵션 화면이 슬라이더 min/max를 거기서 가져간다.
  두 군데 적으면 언젠가 어긋난다
- **하나라도 범위를 벗어나면 전부 거부한다.** 반쯤 적용된 설정이 제일 헷갈린다
- 검사는 화면이 아니라 **background에서** 한다. 화면은 우회할 수 있다
- 슬라이더를 움직여도 저장하지 않는다. **[저장]을 눌러야만** 저장된다
  (sync는 분당 120회 쓰기 제한이 있어 드래그마다 저장하면 바로 걸린다)
- 프리셋(느슨/보통/엄격)은 **`curve`를 바꾸지 않는다.** 점을 다듬는 중에
  눌렀다가 S자로 튕겨나가면 곤란하므로, S자 값과 점 높이를 둘 다 담았다

---

## 상태 저장 (`chrome.storage.sync`)

`background.js` 맨 위의 `const STORE = chrome.storage.sync;` 한 곳에서 정한다.
말썽이 생기면 이 줄만 `chrome.storage.local`로 바꾸면 된다.

**주의**: `sync`는 쓰기 제한이 있다 (분당 120회, 시간당 1800회).
`saveState()`는 판정할 때와 세션 시작·종료 때만 부른다.
차단 화면이 1초마다 하는 건 **읽기뿐**이라 걸리지 않는다.

| 키 | 뜻 |
|---|---|
| `waitStartAt` | 확률 계산의 기준 시각(ms). null이면 아직 안 정해짐 |
| `todayKey` | `'2026-09-19'` 형식. 날이 바뀌면 사용량 자동 초기화 |
| `usedTodayMin` | 오늘 이미 쓴 시간(분) |
| `sessionEndAt` | 이용 중이면 끝나는 시각(ms), 아니면 null |
| `cooldownUntil` | **지금은 쓰지 않음.** 대기 시간을 없애면서 항상 null |
| `settings` | 사용자 설정 한 덩어리 |
| `clientId` | Supabase 기록에 붙이는 임의의 id. 처음 한 번 만든다 |

**사용량은 세션이 끝날 때가 아니라 시작할 때 미리 차감한다.**
끝날 때 빼면 20분을 받고 5분 만에 브라우저를 꺼버렸을 때 기록이 안 남는다.

---

## Supabase 기록

### 구조
| 테이블 | 언제 한 줄 | 컬럼 |
|---|---|---|
| `attempts` | `[시도하기]` 누를 때마다 (통과/거부 모두) | `client_id` `passed` `prob` `roll` `elapsed_min` `used_today_min` `curve` |
| `sessions` | 실제로 유튜브를 열었을 때 | `client_id` `minutes` |

**두 테이블로 나눈 이유**: 하나로 합치면 시도할 때 줄을 넣고 나중에 고쳐야 하는데,
고치려면 `UPDATE` 권한을 열어야 한다. 공개 키로 남의 기록을 고칠 수 있게 되므로
**넣기만 허용**하는 쪽을 골랐다.

### 키 관리
- `secrets.js`에 `url`과 `anonKey` 두 개. **`.gitignore`에 있어 저장소에 없다**
- 틀은 `secrets.example.js`. 이 파일만 저장소에 올라간다
- **`service_role` 키는 절대 쓰지 말 것.** RLS를 통째로 무시한다.
  확장은 사용자 PC에서 도는 코드라 누구나 파일을 열어볼 수 있다
- `anon` 키는 공개를 전제로 만든 키지만, **RLS를 켰을 때만** 안전하다.
  `schema.sql`에서 넣기만 허용했으므로 키를 주워도 읽거나 지울 수 없다
- 주소 뒤에 `/rest/v1`이나 `/`가 붙어 있어도 `supabase.js`가 떼어낸다.
  Supabase 설정 화면에 비슷한 주소가 여러 줄 있어서 어느 걸 복사해도 되게 했다

### 실패해도 확장은 돈다
인터넷이 끊겼다고 차단이 풀리거나 판정이 멈추면 안 된다.
`supabase.js`의 함수들은 **예외를 밖으로 던지지 않는다.**
`secrets.js`가 아예 없어도 기록만 조용히 꺼지고 나머지는 정상 작동한다.

전송은 **일부러 `await`로 기다린다.** 안 기다리면 답장을 보낸 뒤 서비스 워커가
잠들면서 전송이 끊길 수 있다. 대신 **3초 제한**을 걸어 오래 붙잡히지 않게 했다.

---

## 메시지 프로토콜

`background.js`의 `handleMessage`가 전부 처리한다.

| 요청 | 보내는 쪽 | 응답 |
|---|---|---|
| `GET_STATUS` | blocked.js (1초마다) | `buildStatus()` 결과 |
| `ATTEMPT` | blocked.js | `{ passed, roll, prob, status }` |
| `START_SESSION` `{minutes}` | blocked.js | `{ ok, endAt }` 또는 `{ ok:false, error }` |
| `GET_SESSION` | timer.js | `{ sessionEndAt }` |
| `GET_SETTINGS` | options.js | `{ settings, rules, defaults }` |
| `SET_SETTINGS` `{settings}` | options.js | `{ ok, settings }` 또는 `{ ok:false, errors:[] }` |
| `DEV_SET_ELAPSED` / `DEV_SET_USED` | blocked.js (테스트) | 갱신된 status |

`buildStatus()`가 돌려주는 것: `elapsedMin` `usedTodayMin` `remainingMin`
`cooldownLeftSec` `dailyLimit` `prob` `canAttempt`

> **함정 1**: `ATTEMPT`가 한도에 막히면 `{ passed:false, blocked:true, status }`가
> 온다. 이때는 `roll`과 `prob`이 **없다.** `outcome.blocked`를 먼저 확인하지
> 않으면 `undefined.toFixed()`로 터진다.
>
> **함정 2**: `START_SESSION`은 실패할 수 있다. `result.ok`를 확인할 것.
> background가 분 수를 다시 검사한다 (1분 미만, 남은 한도 초과는 거부).

---

## 차단 해제 메커니즘

`rules.json`은 **건드리지 않는다.** 이용 중에만 동적 규칙을 위에 덮어씌운다.

| | id | priority | action |
|---|---|---|---|
| 정적 (`rules.json`) | 1 | 1 | redirect → blocked.html |
| 동적 (`background.js`) | 1000 | **2** | allow |

`setAllowRule()`은 항상 `removeRuleIds: [ALLOW_RULE_ID]`를 먼저 넣는다.
같은 id의 규칙이 이미 있으면 오류가 나기 때문이다.

---

## 크롬 MV3 함정 (전부 실제로 부딪힌 것)

1. **서비스 워커는 몇 초 만에 잠든다.** 기억할 값은 반드시 `chrome.storage`.

2. **`setTimeout`으로 긴 타이머를 재면 안 된다.** 중간에 워커가 죽는다.
   → `chrome.alarms`를 쓴다.

3. **차단 규칙은 "새로 이동할 때"만 작동한다.** 시간이 끝나도 열려 있던 탭은
   그대로 재생된다. → `reloadYoutubeTabs()`로 직접 새로고침한다.

4. **브라우저 재시작 시 알람은 날아가는데 동적 규칙은 남는다.**
   → `reconcile()`이 `onStartup`/`onInstalled`에서 상태를 맞춘다.
   이용 중이면 **통과 규칙도 다시 세워야 한다** (규칙은 프로필마다 따로라서).

5. **`onMessage`에서 `return true`를 빼먹으면 답장이 안 간다.**

6. **화면은 스스로 갱신되지 않는다.** 한 번 그리고 끝내면 시간이 흘러도
   숫자가 멈춰 있다. → `blocked.js`가 1초마다 다시 물어본다.

7. **`chrome.tabs.query`는 `host_permissions`로 동작 중이다.**
   `<all_urls>`를 좁히면 `reloadYoutubeTabs()`가 조용히 깨진다.

8. **`importScripts`는 파일이 없으면 워커를 죽인다.**
   `secrets.js`는 없을 수 있으므로 `try/catch`로 감쌌다.

9. **설정 화면 입구가 확장 카드에 안 나온다.** 세부정보 안에 숨어 있다.
   그래서 `action`(툴바 아이콘)과 차단 화면 [설정] 버튼을 따로 만들었다.

---

## 알려진 문제 / 기술 부채

- **차단 대상 도메인이 3곳에 흩어져 있다.** 사이트를 추가하려면 `rules.json`,
  `background.js`의 `setAllowRule()`, `manifest.json`의 `content_scripts.matches`를
  **동시에** 고쳐야 한다. 숫자는 `config.js`에 모았지만 도메인은 아직 못 모았다.
- **프로필·계정 전환으로 우회할 수 있다.** 확장은 자기가 설치된 프로필 안에서만
  동작하므로 코드로는 막을 수 없는 **구조적 한계**다.
  - 압축해제 확장은 구글 계정을 따라 동기화되지 않아, 새 프로필엔 확장이 없다
  - `storage.sync`가 커버하는 건 "같은 계정 + 각 프로필에 수동 설치"뿐
  - **다른 구글 계정 간 한도 공유는 `sync`로 불가능** → Supabase "공유 코드"로 해결 예정
  - 시크릿/게스트 모드, `chrome://extensions`에서 토글 끄기로도 뚫린다
  - 크롬 정책 레지스트리로 막을 수 있으나 **하지 않기로 함** (통제가 너무 강함)
  → **보고서에는 "완전 차단이 아니라 우회에 마찰을 주는 것이 목표"로 쓸 것.**
- **유튜브는 SPA라 내부 이동이 `main_frame`으로 안 잡힌다.** 지금은 문제 없지만
  다른 사이트를 추가할 때 다시 볼 것.
- **종료 1분 전 알림 미구현.** `timer.js`가 마지막 1분에 빨개지는 것까지만.
- **`cooldownUntil` 상태값이 남아 있다.** 쓰지 않지만 배관은 그대로다.
  대기 시간을 되살릴 일이 없으면 정리해도 된다.

---

## 하지 말 것

- `manifest.json`과 `rules.json`은 **함부로 고치지 말고 먼저 물어볼 것.**
- 숫자를 `config.js` 밖에 흩뿌리지 말 것. 범위는 `SETTING_RULES`에만.
- `background.js`에서 값을 일반 변수에 담아두지 말 것 (워커가 잠들면 사라진다).
- `blocked.js`/`timer.js`에서 확률을 직접 계산하지 말 것.
  판정의 주인은 `background.js` 하나여야 한다.
- **`secrets.js`를 커밋하지 말 것.** `service_role` 키는 어디에도 넣지 말 것.
- 화면 꾸미기를 지금 하지 말 것. 나중에 한 번에 할 예정.
- 크롬 정책 레지스트리는 **하지 않기로 결정**했다. 다시 꺼내지 말 것.

---

## 작업 로그

기록 형식: `### YYYY-MM-DD [태그]` — 작업 내용 / 결정 사항 / TODO

### 1차시 [Claude Code]
- 저장소 생성. `manifest.json`, `rules.json`, `blocked.html`로 최소 차단 확인
- `declarativeNetRequest` 정적 규칙 + `web_accessible_resources` 구조 확정

### 2026-09-07 (2차시) [Claude Code]
- **작업**: 확률 로직과 판정 흐름 전체 연결.
  `config.js` / `probability.js` / `background.js` / `blocked.js` / `timer.js`
- **결정**: `probability.js`는 순수 계산만 / 전역 스크립트 방식 /
  scurve에서 `s(0)`을 빼고 정규화 / 사용량은 시작할 때 미리 차감 /
  `rules.json` 대신 priority 2 동적 allow 규칙 / **거부 시 경과 시간도 초기화**
- **버그 수정**: 차단 화면이 한 번만 확률을 받아와 숫자가 멈춰 있던 문제
  → 1초마다 `GET_STATUS` 재요청

### 2026-09-10 [Claude Code]
- 코드 전체를 다시 읽고 CLAUDE.md를 실제 구현 기준으로 재작성

### 2026-09-12 [Claude Code]
- `_metadata/`를 저장소에서 제거, `devMode` 스위치 추가
- 저장소를 `storage.local` → **`storage.sync`** 로 전환 (`STORE` 한 줄로 모음)
- **버그 수정**: `reconcile()`이 이용 중일 때 통과 규칙을 안 세우던 문제

### 2026-09-13 [Claude Code]
- **알게 된 것**: 압축해제 확장은 구글 계정을 따라 동기화되지 않는다.
  다른 계정 간 한도 공유는 `sync`로 원천 불가
- **사양 변경**: `usagePenalty` `0.5` → **`0`**. 확률은 오직 경과 시간만 본다
- **사양 변경**: **거부 후 대기 시간 제거.** 0분에서 확률이 0%라 대기가 무의미
- 크롬 정책 레지스트리는 쓰지 않기로 결정

### 2026-09-13~14 [Claude Code]
- **`points` 곡선 추가** (네 번째 개형, 이후 기본값이 됨)
  - Fritsch-Carlson 단조 보간. Catmull-Rom은 확률이 내려가는 구간이 생겨 배제
    (실측: "앞을 낮게 깔고 뒤에서 올리는" 배치에서 -4.4%)
  - `calcProb`가 설정을 인자로 받도록 변경. 옵션 화면이 저장 전 값으로
    미리보기를 그려야 하기 때문. 기본값을 `CONFIG`로 둬서 기존 호출부는 그대로
  - 첫 점이 0분이 아니게 되면서 **`(0,0)` 자동 삽입** 규칙 추가
- **설정 화면 추가** (`options.html` / `options.js`)
  - `GET_SETTINGS` / `SET_SETTINGS`. 검사는 background에서
  - 허용 범위를 `SETTING_RULES`에만 두고 화면이 받아 쓰게 함
  - 곡선 미리보기 canvas. **점을 마우스로 끌어서** 곡선을 만든다 (y만)
  - 모양 자동 설정 4종, 프리셋 3종
  - `manifest.json`에 `options_page`와 `action` 추가 (입구가 안 보여서)
- **이용 시간을 +/- 로 직접 정하게 변경.** `durationOptions` 목록 제거
  - `startSession`에서 분 수를 다시 검사 (원래도 화면 값을 믿는 구멍이었음)
  - 한도에 닿으면 버튼을 잠근다. 안 그러면 눌러도 안 움직여 고장으로 보인다

### 2026-09-19 [Claude Code]
- **Supabase 기록 저장 연동 완료**
  - `supabase/schema.sql` — `attempts` / `sessions` 두 테이블 + RLS(넣기만 허용)
  - `supabase.js` — 보내기 전담. 예외를 던지지 않고 3초 제한
  - `secrets.js`(gitignore) / `secrets.example.js` 구조
  - `background.js`에 `clientId` 추가, 판정·세션 시작 시 기록
- **겪은 문제**
  - `secrets.js` 대신 `secrets.example.js`를 고치는 혼동이 있었다
  - Supabase URL에 `/rest/v1`이 붙어 와서 404. **코드가 떼어내도록** 수정
  - SQL Editor에 붙여넣기가 안 돼 `Set-Clipboard`로 직접 넣어 해결
- **확인됨**: 실제 브라우저에서 시도 → `attempts`에 확률·난수·경과시간 기록,
  통과 시 `sessions`에도 기록. RLS로 읽기가 막힌 것도 확인

---

## 다음에 할 것

1. **Supabase 활용** ← 지금 여기. 기록은 쌓이는데 아직 보는 화면이 없다
   - **웹 대시보드** (Vercel) — 시도 횟수·통과율·사용 시간, 최근 7일 그래프.
     읽기용 RLS 정책을 추가해야 한다 (`client_id`로 자기 것만)
   - **확장 안에 간단한 통계 화면** — 대시보드보다 먼저 해볼 수 있는 작은 버전
   - **"공유 코드"** — 각 프로필에 같은 코드를 넣으면 계정과 무관하게 한도 공유.
     `loadState`/`saveState`만 Supabase를 보게 바꾸면 된다
2. **화면 꾸미기** — 지금은 동작 확인용 최소 상태
3. **종료 1분 전 알림** — `timer.js`가 빨개지는 것까지만 되어 있음
4. **도메인 설정 일원화 / 차단 사이트 추가**
   - 1단계: `setAllowRule()`만 `config.js`를 읽게 (안전, 5분)
   - 2단계: `rules.json`을 동적 규칙으로, `content_scripts`를 `chrome.scripting`으로
5. 제출 전 `config.js`의 `devMode`를 `false`로
