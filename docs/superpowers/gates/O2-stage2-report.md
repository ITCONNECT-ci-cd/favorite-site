# O2 게이트 — 2단계(검색, EPIC G) 검수 보고서

- **일시**: 2026-08-09 야간 (자율 모드)
- **검수 시점 HEAD**: `d40146e` (feat(H1): Supabase Auth 세션 계층 + 관리자 계정 생성)
- **2단계 마지막 커밋**: `809e615` (docs(palette): G5 인계 문구를 실제 소유자(PaletteHost)로 갱신)
- **실행 환경**: Windows 11 / PowerShell 7 / Node 20+ / `E:\favorite_site` (대문자 드라이브 — vitest 정상)
- **근거 수집 방식**: 실측 우선. 테스트·타입·빌드는 재실행, 클릭 API는 실 DB 왕복, 화면은 dev(3210)·prod(3211) HTTP 응답 실측.

## 요약

| 구분 | 결과 |
|---|---|
| 자동 검증 항목 | **12 PASS · 3 DEFER · FAIL 0** |
| 공통 게이트 | `npm test` 676/676 · `npm run typecheck` clean · `npm run build` exit 0 — 전부 그린 |
| 계획서 G1~G5 | 전부 `[x]` — 확인 |
| 결론 | **통과 (DEFER 3건은 전부 사람 눈·실기기 몫이며 2단계 구현 결함이 아니다)** |

DEFER 3건은 ①실기기 키보드 완주(PRD 성공 기준 5) ②한 번에 열기 12개 실브라우저 팝업 차단 거동 ③V7 문구 사용자 재확인 — 모두 아침 확인 목록에 있다.

---

## 0. 공통 게이트 — 재실행 결과

| 명령 | 결과 | 근거 |
|---|---|---|
| `npm test` | **PASS** | `Test Files 33 passed (33)` · `Tests 676 passed (676)` · 5.22s |
| `npm run typecheck` | **PASS** | `tsc --noEmit` 출력 없음, exit 0 |
| `npm run build` | **PASS** | exit 0. 라우트 `ƒ /`, `ƒ /api/click`, `ƒ /category/[id]`, `ƒ /daily`, `ƒ /favorites`, `○ /icon.png`, `ƒ Proxy (Middleware)` |

### 관찰 — 빌드 로그의 `DYNAMIC_SERVER_USAGE` 한 줄 (FAIL 아님, 원인 기록)

빌드 중 다음 로그가 찍힌다.

```
셸 데이터 조회 실패 — 오류 화면으로 대체한다 Error: Dynamic server usage:
Route / couldn't be rendered statically because it used `cookies`.
  at lib\supabase\server.ts:20:29  →  lib\queries.ts:63  →  app\layout.tsx:136
```

- **원인**: H1(`d40146e`)이 `lib/supabase/server.ts`에 `await cookies()`를 넣으면서, 프리렌더 시도 중 Next 내부 제어용 예외를 **C1 셸의 try/catch(O1 F-1 산출물)가 한 번 삼킨다**.
- **실측 판정**: 그럼에도 Next는 `/`를 `ƒ`(동적)으로 확정했고, **프로덕션 런타임은 정상 화면을 낸다**. `npx next start -p 3211` 후 `GET /` → 200 · 223,067 bytes · 오류 화면 문구 **0건** · 검색 트리거 1건 · 카드 앵커 56건 · 사이드바 하위 분류 2건.
- **처분**: 2단계 산출물에 영향 없음. **H1 소관(3단계)이라 O2 평가 대상에서 제외**하고 원인만 남긴다 — 셸 catch가 `DYNAMIC_SERVER_USAGE`/`NEXT_*` 제어 예외는 되던져야 한다는 점을 **O3 점검 항목으로 인계**한다.

---

## 1. O2-1 — ⌘K → 타이핑 → ↑↓ → ↵ 새 탭까지 **마우스 없이**

**결과: PASS (자동화 몫) + DEFER (실기기 몫)**

### 통합 시나리오 테스트 실재 — 지목

`components/palette/CommandPalette.test.tsx:1177` `StatefulPalette` 래퍼 — 열림 상태를 쥔 소형 호스트로 `CommandPalette` + `Toaster`를 함께 세운다. 주석(1172~1176행)이 존재 이유를 명시한다: 단위 테스트만으로는 완주가 안 보이고 PaletteHost 스위트에도 키보드 완주 경로가 없어 **PRD 성공 기준 5의 자동화된 몫**을 여기서 통과시킨다.

`CommandPalette.test.tsx:1200` — `키보드만으로 팔레트를 열어 두 번째 결과를 열고 팔레트가 닫힌다`

| 단계 | 테스트 단언 |
|---|---|
| 시작 상태 | `queryByRole('dialog')` 부재 |
| ⌘K | `press('k', { metaKey: true }, window)` → `getByRole('dialog')` 존재 + **입력에 포커스**(`expect(input()).toHaveFocus()`) |
| 타이핑 | `type('문서')` → `resultRows()` 3건 |
| ↓ | `press('ArrowDown')` → `selectedIndex()` === 1 |
| ↵ | `press('Enter')` → `recordClick('b')` 호출 · 토스트 `문서 둘 · 새 탭으로 이동` · dialog 소멸 · `document.body.style.overflow === ''`(스크롤 잠금 해제) |

**"새 탭"의 근거**: 결과 행은 실제 앵커다 — `CommandPalette.test.tsx:318` `행은 새 탭으로 가는 진짜 앵커다`가 `href`·`target="_blank"`·`rel="noopener noreferrer"` 3종을 단언하고, `:910` `↵ 는 선택 행의 앵커를 눌러 새 탭을 연다 (이동은 브라우저 몫이라 막지 않는다)`가 ↵→앵커 클릭 경로를 고정한다. jsdom은 실제 탭을 열지 않으므로 **탭 개시는 앵커 속성 + 클릭 디스패치로 갈음**된다.

보강 시나리오 `:1223` — `esc 로 닫았다가 ⌘K 로 다시 열면 지난 질의가 남아 있지 않다`(입력 초기화 + 고정 링크 줄 복귀).

### dev(3210) 팔레트 렌더 확인 — 실측과 그 한계

`GET http://localhost:3210/` → 200, 227,940 bytes.

| 확인 | 실측 |
|---|---|
| 검색 트리거 버튼 | `<button type="button" aria-haspopup="dialog" aria-expanded="false" aria-keyshortcuts="Meta+K" …>` **존재** |
| "AI 검색" 버튼 | 존재 |
| `role="dialog"` 패널 | **0건 — 정상**. 닫힘 상태에서 게이트가 `null`을 반환한다(`PaletteHost.tsx:30~33` 계약: 조건부 렌더 금지, 게이트가 안에서 스스로 비운다) |

**한계 명시**: ⌘K는 키보드 이벤트라 브라우저 자동화 없이는 HTTP로 재현할 수 없다. 서버 HTML에는 닫힌 팔레트가 애초에 없으므로 **팔레트 패널 자체의 dev 실측은 불가**하며, 위 테스트로 갈음한다. 서버 쪽에서 실측 가능한 것(트리거 버튼의 `aria-haspopup="dialog"`·`aria-keyshortcuts="Meta+K"` 배선)은 위 표대로 확인했다.

`Header.tsx:34~35` 주석대로 검색창은 **겉모습만 입력인 버튼**이라 `<input>`·`placeholder`가 없다 — HTML에 입력 요소가 없는 것은 설계이며 결함이 아니다.

### PRD 성공 기준 5 수동 검증 기록 (실기기 확인은 아침 목록 → **DEFER**)

실기기에서 그대로 따라 할 시나리오 명세를 기록으로 남긴다.

| # | 조작 (마우스 금지) | 기대 |
|---|---|---|
| 1 | 홈에서 `⌘K`(mac) / `Ctrl+K`(Win) | 팔레트가 열리고 **캐럿이 입력에 있다** — 바로 타자 가능 |
| 2 | `문서` 타이핑 | 타자 즉시 결과가 좁혀지고 우측에 `N건` |
| 3 | `↓` 2회 · `↑` 1회 | 선택 행이 순환 이동, 선택 행에 `↵` 표시 + 배경 |
| 4 | `↵` | **새 탭**으로 이동 + 하단 토스트 `<이름> · 새 탭으로 이동` + 팔레트 닫힘 |
| 5 | 원래 탭 복귀 후 `⌘K` → `esc` | 열렸다 닫히고, 다시 열면 입력이 비어 있고 `고정해 둔 링크` 6줄 |
| 6 | 전 과정에서 마우스·트랙패드 미사용 | 1~5가 끊기지 않는다 |

추가 실기기 확인점: Windows `Ctrl+K`가 **주소창 검색에 뺏기지 않는지**(`:700` `브라우저 기본 단축키를 막는다`가 `preventDefault`를 단언하지만 실브라우저 확인 필요), 한글 IME 조합 중 `↑↓`·`↵`가 먹히지 않는지(`:791`·`:972` isComposing 가드의 실기기 대조).

---

## 2. O2-2 — 이름·설명·태그·분류·주소 매칭

**결과: PASS (테스트로 갈음)**

### API 수준 확인 불가 — 사유

`searchLinks`는 순수 함수이고 팔레트는 셸이 이미 내려준 `SiteData`를 **클라이언트에서** 훑는다(`PaletteHost.tsx:16` `data: SiteData` — 셸이 서버에서 읽은 그대로). 검색 전용 엔드포인트가 없으므로 dev(3210)에서 실질의 1건을 API로 때려 볼 대상이 없다. `lib/search.test.ts` 39건(describe 9)으로 갈음한다.

### 필드별 매칭 — 5종 전부 실재

| 스펙 요구 필드 | 테스트 | 위치 |
|---|---|---|
| 이름 (title) | `이름(title)으로 찾는다` | `lib/search.test.ts:65` |
| 설명 (description) | `설명(description)으로 찾는다` | `:73` |
| 주소 (url/host) | `주소(host)로 찾는다` / `주소는 host 만 본다 — 스킴·경로·쿼리는 대상이 아니다` | `:79`, `:85` |
| 태그 (tags) | `태그로 찾는다` | `:103` |
| 분류 (상위) | `상위 카테고리 이름으로 찾는다` | `:109` |
| 분류 (하위) | `하위 카테고리에 속하면 하위 이름으로도, 상위 이름으로도 찾는다` | `:118` |

### 부가 계약 (동시 확인)

| 계약 | 테스트 |
|---|---|
| 대소문자 무시 (질의·데이터 양방향, 5필드 전부) | `:133`, `:139`, `:156` |
| 공백 분리 **AND** (필드 교차 허용) | `:166`, `:176`, `:182` |
| `matchedIn` 우선순위 이름→설명→주소→분류→태그 | `:200`~`:279` |
| `MATCH_LABEL` 배지 문안 5종 | `:287`, `:294` |
| 입력 순서 유지 · `SEARCH_RESULT_LIMIT` 50건 절단 | `:319`, `:329` |
| 0건 · null 설명 · `category_id` null · 미아 `category_id` | `:341`~`:359` |
| 순수성(입력 불변) | `:366` |
| **실시드 대조** — `"문서"` 9건 순서가 `docs/screenshots/01-palette.png`와 일치 | `:377`, `:390` |
| 실시드 하위 분류명으로 26건(PRD 3장 표) · 태그 `"Video Editor"` 두 토큰 AND | `:401`, `:405` |

팔레트 쪽 렌더 대응도 함께 있다 — `CommandPalette.test.tsx:340` `이름·설명·주소·분류·태그 다섯 라벨을 쓴다`.

---

## 3. O2-3 — 한 번에 열기 bulk 플래그 적재 (**실 API 왕복**)

**결과: PASS**

dev(3210) 실서버 + 실 Supabase로 왕복 1건을 넣고 DB를 직접 조회한 뒤 정리했다. 방문자 해시는 예약 대역 IP(`203.0.113.77`)와 신규 UUID로 만들어 **실사용자 해시와 겹치지 않게** 격리했다.

| 단계 | 실측 |
|---|---|
| 요청 | `POST http://localhost:3210/api/click` · `x-forwarded-for: 203.0.113.77` · body `{bookmarkId, visitorId, isBulk: true}` |
| 응답 | `200 {"counted":true}` |
| 대상 | `bd12f640-4efc-4fab-ac9c-86e035fd0008` (ChatGPT) |
| DB 적재 | `[{"id":27,"bookmark_id":"bd12f640-…","is_bulk":true,"clicked_at":"2026-08-09T11:13:37.212422+00:00"}]` |
| 판정 | 행 수 **1** · `is_bulk` 전부 **true** |
| **대조군** (같은 링크, 다른 방문자, `isBulk` 생략) | `200 {"counted":true}` → `[{"id":28,"is_bulk":false}]` — **기본값 false 확인** |
| 정리 | 두 해시 delete 후 재조회 → **잔여 0** |

대조군까지 넣은 이유: `is_bulk:true` 하나만 보면 컬럼이 항상 true인 경우와 구분되지 않는다. true/false가 요청대로 갈리는 것까지 확인해야 "플래그가 실린다"가 성립한다.

### 코드 경로 (실측과 일치)

`recordClick(bookmarkId, isBulk = false)` (`lib/clicks.ts:27`) → body에 `isBulk` 실림(`:37`) → `parseClickBody`가 `isBulk ?? false`로 기본값 확정(`app/api/click/logic.ts:70`) → `insert({ …, is_bulk: isBulk })`(`app/api/click/route.ts:87`).

### 호출부 테스트

| 화면 | 테스트 |
|---|---|
| ListView 전체/선택 열기 | `components/ListView.test.tsx:587` `연 링크마다 isBulk=true 로 기록한다 (F3 — handleOpen 재사용이 아니다)` |
| HomeView 섹션 열기 | `components/HomeView.test.tsx:486` — `카드 클릭(F3)과 달리 두 번째 인자가 true 다 — 순위 왜곡을 막는 bulk 플래그(PRD)` |
| **음성 대조** (사람 클릭은 bulk 아님) | `ListView.test.tsx:346`, `HomeView.test.tsx:406`, `CommandPalette.test.tsx:931` — 셋 다 "인자가 id 하나뿐" 단언 |

---

## 4. 스펙 7장 인터랙션 표 — 2단계 소관 행 테스트 매핑

DESIGN_SPEC.md `## 7. 인터랙션 정리`(247행) 표에서 2단계가 책임지는 행 전부.

| # | 스펙 트리거 | 스펙 동작 | 테스트 매핑 | 상태 |
|---|---|---|---|---|
| 1 | `⌘K` / `Ctrl+K` | 검색 팔레트 열기 | `CommandPalette.test.tsx:660` describe `전역 ⌘K · Ctrl+K` 8건 — ⌘K 열기(`:665`) · Ctrl+K(`:674`) · ⇧+대문자 K(`:683`) · **수식키 없는 k는 무시**(`:692`) · `preventDefault`(`:700`) · 열린 상태 재요청(`:706`) · 콜백 부재 안전(`:715`) · 언마운트 시 리스너 해제(`:721`).<br>배선: `PaletteHost.test.tsx:98`·`:106`·`:135`(닫은 뒤 재개방 — 조건부 렌더 금지 회귀 방지) | **PASS** |
| 2 | `↑` `↓` | 결과 이동 (**순환**) | `CommandPalette.test.tsx:732` describe `↑↓ 이동 (순환)` 8건 — ↓ 이동(`:733`) · **마지막→첫**(`:742`) · **첫→마지막**(`:754`) · 캐럿 이동 차단 `preventDefault`(`:763`) · 0건에서 무동작(`:771`) · 질의 변경 시 선택 0 복귀(`:779`) · **IME 조합 중 무시**(`:791`) · 선택 인덱스 클램프(`:800`) · 닫힌 뒤 무시(`:814`).<br>부가: 스크롤 인투 뷰 `:881`, SR 발화 `:822`, 호버=선택 이동 `:860` | **PASS** |
| 3 | `↵` | 선택 결과 열기 / **결과 0건이면 AI 검색** | 열기: `:903` describe `↵ 열기 · 행 클릭 = ↵` — 앵커 클릭으로 새 탭(`:910`) · 기록+토스트+닫기(`:923`) · 클램프 후에도 남은 행(`:939`) · ↑↓ 이동 후(`:954`) · `preventDefault`(`:965`) · **IME 조합 종료 ↵ 제외**(`:972`) · 버튼/행 포커스 시 미가로채기(`:983`·`:995`).<br>0건 분기: `:1066` `결과가 없으면 ↵ 가 AI 검색을 부른다 — 질의를 인자로 준다` · 빈 입력 `:1081` · 공백 질의 `:1095` | **PASS** (0건→AI는 **자리**, 실동작 N3) |
| 4 | `⌘↵` | AI 검색 실행 | `:1059` describe 내 — **결과가 있어도 ⌘↵는 AI 검색**(`:1105`) · `Ctrl+↵` 동치(`:1127`) · **행 포커스 상태에서도 AI**(`:1138`, ↵ 예외 규칙이 여기까지 새지 않음 — `0dd4ade`가 고친 지점) · AI 버튼 포커스 시에도(`:1153`) · 콜백 부재 안전(`:1164`) · 하단 버튼과 동일 질의(`:1117`) | **PASS** (계획서상 **자리**: `PaletteHost`가 `onAiSearch`를 넘기지 않아 실앱에서는 무동작 — N3 몫으로 명시됨) |
| 5 | `esc` | 팔레트 닫기 | `CommandPalette.test.tsx:1239` describe `esc 닫기` 3건 — `onClose` 호출(`:1240`) · `preventDefault`(`:1249`) · **닫힌 뒤 미청취**(`:1255`).<br>배선: `PaletteHost.test.tsx:114`(닫힘 + `aria-expanded` false 복귀).<br>동반: 문서 스크롤 잠금 해제 `:1266`~`:1288`, 포커스 반환 `:1325` | **PASS** |
| 6 | 카드·**행** 클릭 | 새 탭 + 클릭 기록 + 토스트 | (2단계 소관 = 팔레트 **행**) `:1010` `행 클릭도 ↵ 와 같다 — 기록·토스트·알림·닫기` · **고정 링크 행도 동일 계약**(`:1024`) · **가운데 클릭은 집계하되 팔레트 유지**(`:1037`) · **우클릭은 집계 안 함**(`:1049`).<br>중복 기록 방지: `PaletteHost.test.tsx:178` `클릭 기록이 한 번만 간다 — onOpenLink 를 넘기지 않는다` | **PASS** |
| 7 | 한 번에 열기 | 대상 전체 클릭 기록 + 토스트(탭 그룹 명칭 안내) | `ListView.test.tsx:566` describe `ListView — 한 번에 열기 (G4)` — 전체 열기 순서대로(`:574`) · **isBulk=true 기록**(`:587`) · 선택 열기(`:631`) · 빈 선택 안내만(`:688`) · 빈 목록 안내만(`:699`) · 툴바 그룹 `한 번에 열기`(`:104`) · 버튼 스타일(`:413`·`:428`) · 개수 = 보이는 링크 수(`:463`).<br>`HomeView.test.tsx:456` describe `HomeView — 섹션 한 번에 열기 (G4)` — 섹션 순서대로 + bulk 기록(`:481`·`:486`) · 개수 라벨(`:145`·`:212`·`:247`·`:339`) · **즐겨찾기 섹션엔 없음**(`:188`·`:535`).<br>`SectionHeader.test.tsx:29`~`:97` 버튼 렌더·클릭·배치 7건.<br>**실 API 적재**: 본 보고서 §3 | **PASS** (문구는 V7 — 아침 재확인) |

표의 나머지 행(카드 호버·핀·연필·휴지통·드래그)은 1·3단계 소관이라 O2 범위 밖.

---

## 5. 커밋 요약 · 계획서 G1~G5 확인

### 2단계(EPIC G) 커밋 목록 — 시간순

| SHA | 제목 | 스토리 |
|---|---|---|
| `6ba5e69` | feat(search): 키워드 필터 searchLinks — ⌘K 팔레트의 관문 (G1) | G1 |
| `33db476` | fixup(G1): MATCH_LABEL 배지 문안 export + 필드 선언 일원화 | G1 |
| `90dea0f` | feat(palette): ⌘K 검색 팔레트 UI — 입력 즉시 필터까지 (G2) | G2 |
| `66009ba` | fixup(G2): 팔레트 영역 testid · 결과 수 라이브 영역 · 게이트 명시 전달 | G2 |
| `dc74d0a` | feat(open): 한 번에 열기 + 카드 체크 선택 (G4) | G4 |
| `3e4714b` | fixup(G4): 한 번에 열기 토스트·안내문을 실제 동작에 맞춘다 (V7) | G4 |
| `51987f8` | feat(palette): 키보드 내비게이션 + 결과 행 클릭 (G3) | G3 |
| `afd0d1c` | fixup(G4): 품질 리뷰 처분 반영 — isBulk 계약 정정·툴바 묶음 이름·제목 상수화 | G4 |
| `0dd4ade` | fixup(G3): ⌘↵ 를 앵커·버튼 예외보다 앞으로 + 편차 ③ 주석화 | G3 |
| `dd04bec` | feat: 헤더 ↔ ⌘K 팔레트 배선 (G5) | G5 |
| `51bc27a` | fixup(G3): 품질 리뷰 처분 — AI 계약에 질의·aiBusy 추가, 선택 인덱스 클램프 | G3 |
| `809e615` | docs(palette): G5 인계 문구를 실제 소유자(PaletteHost)로 갱신 | G5 |

기능 커밋 5 + fixup/docs 7 = **12건**. 스토리 5개 전부 `feat` 1건 + 리뷰 처분 fixup을 갖췄다.

### 계획서 체크박스

| 스토리 | 계획서 위치 | 상태 |
|---|---|---|
| G1 키워드 필터 | 519행 | `[x]` ✅ |
| G2 ⌘K 팔레트 UI | 524행 | `[x]` ✅ |
| G3 키보드 내비 + 행 클릭 | 529행 | `[x]` ✅ |
| G4 한 번에 열기 + 체크 선택 | 533행 | `[x]` ✅ |
| G5 헤더 연결 | 537행 | `[x]` ✅ |

**G1~G5 전부 `[x]` — 확인.**

### 2단계 관련 테스트 규모 (참고)

| 파일 | it |
|---|---|
| `components/palette/CommandPalette.test.tsx` | 104 |
| `components/ListView.test.tsx` | 54 |
| `lib/search.test.ts` | 39 |
| `components/HomeView.test.tsx` | 34 |
| `lib/clicks.test.ts` | 19 |
| `components/PaletteHost.test.tsx` | 12 |
| `components/SectionHeader.test.tsx` | 7 |

2단계 소관 7파일 묶음 재실행: `Test Files 7 passed (7)` · `Tests 264 passed (264)`.

---

## 6. 이월 확인

### 6-1. N3(5단계 AI) 인계 3종 — **PASS**

`components/palette/CommandPalette.tsx`에 셋 다 실재하고, 게이트→패널로 그대로 전달된다.

| prop | 선언 | 전달 | 소비 |
|---|---|---|---|
| `aiSlot?: ReactNode` | `:152` | `:199`, `:235`, `:250` | `:545` — 결과 목록 아래·하단 바 위에 렌더 |
| `aiBusy?: boolean` | `:160` | `:200`, `:236`, `:251`(기본 `false`) | `:305` showEmpty 조건 |
| `onAiSearch?: (query: string) => void` | `:171` | `:201`, `:237`, `:252` | `:374`(⌘↵) · `:441`(0건 ↵) · `:577`(하단 AI 버튼) — **세 자리가 한 계약** |

`:190~191` 파일 주석이 인계를 문서로도 못박았다: `N3(AI): aiSlot(내용) · aiBusy(0건 안내 감추기) · onAiSearch(질의를 인자로 받는다)`.
테스트 뒷받침: `:617` describe `후속 자리 — N3` 3건(슬롯 위치 `:618` · 슬롯 없어도 정상 `:627` · AI 버튼 콜백 `:633`).
`PaletteHost.tsx:39~42`가 "지금은 넘기지 않아 AI 경로가 무동작"임과 N3의 작업 지점을 명시 — **인계 경로가 코드·주석·테스트 3중으로 남았다.**

### 6-2. 팔레트 narrow `calc(100% - 24px)` — **PASS (구현됨)**

`CommandPalette.tsx:67`

```
'w-[calc(100%-24px)] min-[820px]:w-[800px] max-h-[calc(100%-128px)]',
```

`:64` 주석이 스펙 출처를 적어 둔다(`패널 — 상단 64px · 폭 800px(모바일 calc(100% - 24px)) · 최대 높이 calc(100% - 128px)`).
테스트: `CommandPalette.test.tsx:495` `패널: 상단 64px · 폭 800px(모바일 calc(100%-24px)) · 최대 높이 calc(100%-128px) · 라운드 12px · 그림자`.
모바일 우선으로 좁은 값을 기본에 두고 `min-[820px]`에서 800px로 올리는 방향 — 프로젝트의 다른 narrow 규칙과 같은 축(820px).

### 6-3. G2 `showEmpty` 조건 — **PASS (자리 마련 완료)**

`CommandPalette.tsx:305`

```ts
const showEmpty = trimmed !== '' && results.length === 0 && !aiBusy;
```

`:156~158` 주석이 프로토타입 원본과의 관계를 명시한다 — 프로토타입 1002행의 `showEmpty`는 `st.ai !== 'loading' && !(st.ai === 'done' && …)`까지 보지만, 2단계에는 AI 상태가 없으므로 **`aiBusy` 한 값으로 압축**해 두고 N3이 `aiSlot`을 채울 때 이 prop만 함께 켜면 되도록 했다.

테스트 3건이 조건의 세 갈래를 각각 고정한다.

| 갈래 | 테스트 |
|---|---|
| 빈 입력에서는 0건 안내 없음(고정 링크 자리) | `:459` |
| `aiBusy` 면 감춘다 | `:465` |
| `aiBusy` 꺼지면 다시 뜬다 (N3이 이 한 값만 토글) | `:472` |

---

## 7. 아침 확인 목록 (사람 눈·실기기 필요)

| # | 항목 | 왜 자동화로 못 했나 | 하는 법 |
|---|---|---|---|
| **B-1** | **PRD 성공 기준 5 — 실기기 키보드 완주** | ⌘K는 OS/브라우저 키 이벤트라 HTTP·jsdom으로 재현 불가 | §1의 6단계 시나리오 표를 mac Safari/Chrome + Windows Chrome/Edge에서 그대로 수행 |
| **B-2** | Windows `Ctrl+K`가 **주소창 검색에 뺏기지 않는지** | `preventDefault` 호출은 단언했으나 실브라우저 우선순위는 별개 | Windows Chrome·Edge에서 홈에 포커스 두고 Ctrl+K |
| **B-3** | **한글 IME 조합 중** ↑↓·↵ 거동 | jsdom `isComposing` 은 합성 이벤트라 실 IME와 다를 수 있음 | 두벌식으로 `문서` 입력 도중 ↑↓·↵ — 조합이 깨지거나 팔레트가 반응하면 안 됨 |
| **B-4** | **한 번에 열기 12개 실행** — 팝업 차단 안내 | 다중 `window.open` 차단은 브라우저 정책, jsdom 무의미 | `매일 사용하는 사이트`에서 `12개 한 번에 열기` → 탭 12개 열림 + 차단 시 안내 토스트 |
| **B-5** | **전체 열기 118건**(AI 도구 모음) 실거동 | 위와 동일 + 부하 | 카테고리 목록에서 전체 열기 — 브라우저 반응·차단 지점 관찰 (4단계 L1 rate limit V5 전제와도 연결) |
| **B-6** | **V7 문구 사용자 재확인** | 제품 오너 결정 사항 | 토스트 `크롬에서 "X" 탭 그룹으로 묶어 두면 좋습니다`(제안형)와 툴바 안내문 승인 — 계획서 §0 V7이 "아침 사용자 재확인 항목"으로 지정 |
| **B-7** | 팔레트 **1440×900 스크린샷 대조** | 실제 렌더 픽셀 비교 | `docs/screenshots/01-palette.png`와 실화면 대조 (검색 `문서` 9건 순서는 테스트로 이미 일치 확인) |
| **B-8** | 팔레트 **<820px narrow** 실화면 | CSS 클래스는 단언했으나 실뷰포트 확인은 별개 | 375px에서 ⌘K — 패널 폭이 `calc(100%-24px)`로 줄고 내용이 넘치지 않는지 |
| **B-9** | Vercel preview 배포 + 프리뷰에서 ⌘K | 배포는 게이트 공통 요구(§6) — 로컬 실측만 수행함 | preview 배포 후 B-1을 프리뷰 URL에서 1회 반복 |

### O3(3단계)으로 인계

| # | 항목 |
|---|---|
| **C-1** | 셸(`app/layout.tsx`)의 try/catch가 Next 제어 예외(`DYNAMIC_SERVER_USAGE`/`NEXT_*`)를 삼킨다 — 되던지도록 보강 검토. H1의 `cookies()` 도입(`d40146e`)으로 드러났고 **현재 런타임 영향은 없음**(§0 실측). |
| **C-2** | `⌘↵`·0건 `↵`·하단 AI 버튼은 **자리만 있고 실앱에서 무동작** — 계획서상 N3 몫이나, 3단계까지 사용자에게 노출되는 상태이므로 오해 소지 여부를 O3에서 판단. |

---

## 8. 결론

**O2 통과.** 자동 검증 12항목 PASS · 3항목 DEFER · **FAIL 0**.

> 집계 기준 — PASS 12: 공통 게이트 3(test·typecheck·build) + O2 체크리스트 4(키보드 완주 자동화·dev 렌더 확인·5필드 매칭·bulk 실 API) + 매핑/기록 2(스펙 7장 표·커밋과 G1~G5 체크박스) + 이월 3(N3 인계·narrow·showEmpty). DEFER 3: 실기기 키보드 완주(B-1 계열) · 실브라우저 한 번에 열기(B-4·B-5) · V7 문구 사용자 재확인(B-6).

- 계획서 §6 O2가 요구한 3항목은 전부 확인됐다 — 키보드 완주는 `StatefulPalette` 통합 시나리오로 **실재 지목**(`CommandPalette.test.tsx:1200`), 5필드 매칭은 `lib/search.test.ts` 6개 테스트로 **필드별 실재**, bulk 플래그는 **실 API·실 DB 왕복 + 대조군 + 정리(잔여 0)**로 실측했다.
- 스펙 7장 2단계 소관 7개 행이 전부 테스트에 매핑된다(§4). 매핑 없는 행은 없다.
- G1~G5 계획서 체크박스 5개 전부 `[x]`, 커밋 12건이 스토리별로 대응한다.
- 이월 3종(N3 인계 `aiSlot`·`aiBusy`·`onAiSearch` / 팔레트 narrow / G2 `showEmpty`)은 전부 **구현·문서·테스트 3중으로 확인**됐다.
- DEFER 3건(B-1·B-4·B-6 계열)은 **브라우저·실기기·제품 오너 판단이 본질적으로 필요한 항목**이며 2단계 구현 결함이 아니다. 아침 목록 B-1~B-9로 넘긴다.
- H1 작업 파일(`lib/supabase/*`·`scripts/create-admin.ts`)은 검수 중 `d40146e`로 커밋됐고, 그 여파 1건(§0 빌드 로그)은 원인만 기록해 O3에 인계했다 — O2 평가 대상에서 제외.

> 본 보고서는 계획서 `docs/superpowers/plans/2026-08-09-link-dashboard-full-plan.md`를 수정하지 않았다. 검수 시점에 해당 파일이 다른 에이전트에 의해 미커밋 편집 중(48+/30-)이라 `git commit --only`로 본 보고서만 커밋한다. 계획서 §7-2에 해당하는 O2 결과 기록은 코디네이터가 편집을 마친 뒤 반영하면 된다.
