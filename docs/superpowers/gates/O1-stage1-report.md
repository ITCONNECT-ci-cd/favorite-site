# O1 게이트 검수 보고서 — 1단계 (공개 화면 읽기 전용 + 클릭 집계)

**검수 일시:** 2026-08-09 18:56 ~ 19:20 (KST)
**검수 대상:** `feat/stage-1-public` — 1단계 종료 커밋 `4d2c081`
**재실행 시점 HEAD:** `66009ba` (2단계 G1·G2·G4 커밋이 이미 얹혀 있음 — 아래 §0 주석 참조)
**검수자:** O1 gate auditor (자동 검증 · 사용자 부재 야간 자율 모드)
**판정 요약:** **조건부 통과** — 자동 검증 가능한 11개 항목 중 **9 PASS · 2 DEFER(아침)**, FAIL 0.
다만 **항목 10에서 계획서의 전제와 어긋나는 실측**이 나왔다(§10 · §F-1). 코드는 고치지 않고 보고만 한다.

---

## 0. 공통 게이트 — `npm test` · `npm run typecheck` · `npm run build`

전부 PowerShell(`E:\favorite_site`)에서 재실행했다.

| 명령 | 결과 | 근거 |
|---|---|---|
| `npm test` | **PASS** — exit 0 | 30 파일 / **579 테스트 전부 통과** (19:13:52, 4.42s) |
| `npm run typecheck` | **PASS** — exit 0 | `tsc --noEmit` 무출력 |
| `npm run build` | **PASS** — exit 0 | Next 16.3.0 Turbopack, 라우트 7개 생성 (`/`, `/_not-found`, `/api/click`, `/category/[id]`, `/daily`, `/favorites`, `/icon.png`) |

### 0-1. 검수 중 발생한 일시 실패 — 원인 규명 완료 (게이트 사유 아님)

첫 회차(18:56)에는 **545 테스트 / 30 파일 통과 · typecheck exit 0**이었으나, 19:02의 `npm run build`가
아래 한 줄로 실패했다.

```
lib/clicks.test.ts(12,10): error TS2724: '"@/lib/clicks"' has no exported member named 'bulkOpenToastText'.
Failed to type check.
```

원인은 **동시 작업 중이던 2단계 G4 에이전트의 TDD 중간 상태**다. 실측 근거:

- `lib/clicks.test.ts` 최종 수정 시각 **19:01:46** — 나의 그린 판정(18:56) *이후*
- 당시 `git status`: `lib/clicks.test.ts`·`components/ListView.test.tsx` 수정 + `test/open.ts` 미추적
- 잠시 뒤 `lib/clicks.ts`에 `bulkOpenToastText` 구현이 추가되며 자체 해소
- 19:10 커밋 `dc74d0a feat(open): 한 번에 열기 + 카드 체크 선택 (G4)` 로 정리됨

**1단계 코드가 원인이 아니다.** 확증을 위해 남의 작업 트리를 건드리지 않고
`git worktree --detach`로 **HEAD의 깨끗한 사본**을 떠서 별도 검증했다(검증 후 worktree 제거 완료):

- clean worktree @ `90dea0f`: `npm test` **545/545 PASS**, `npm run build` **exit 0**, 빌드 후 `typecheck` **exit 0**

> ⚠️ 재현 메모: 깨끗한 체크아웃에서 **빌드 전에** `npm run typecheck`를 돌리면
> `app/layout.tsx(55,56): error TS2304: Cannot find name 'LayoutProps'` 가 난다.
> `LayoutProps`/`PageProps`는 Next가 빌드 때 생성하는 전역 타입이라 `.next/types`가 없으면 존재하지 않는다
> (계획서 Tech Stack 주석·`app/category/[id]/page.tsx` 주석과 일치). **CI 순서는 build → typecheck 여야 한다.**
> 기존 작업 트리는 dev 서버가 만든 `.next/dev/types` 덕분에 이 문제가 드러나지 않는다.

---

## 1. 1440×900 첫 화면 클릭 가능 링크 ≥ 30 — **PASS**

dev 서버(포트 3210, 기동 중이던 것 재사용)에서 홈 HTML을 받아 실측했다(220,029 bytes).

### 실측 — 홈의 앵커 전수

| 구분 | 개수 | 비고 |
|---|---:|---|
| `<a>` 총계 | **84** | 전부 `href` 보유 |
| 사이드바(`<aside>`) 앵커 | **14** | 브랜드 1 + 빠른 접근 4 + 분류 9 |
| 본문(`<main>`) 앵커 | **57** | 카드 28×2 + '전체 보기' 1 |
| — 카드 본문 앵커 | 28 | `a.mt-auto` (카드당 1개, 접근성 트리 노출) |
| — 파비콘 타일 앵커 | 28 | `aria-hidden` 마우스 보조 영역 (같은 목적지) |
| 모바일 칩 줄 앵커 | **13** | `min-[820px]:hidden` — **1440px에서는 렌더되지만 표시되지 않음** |

**1440px에서 실제로 보이는 링크 = 84 − 13 = 71개.**

### 첫 화면(fold) 계산

헤드리스 브라우저(playwright/puppeteer)가 이 저장소에 없어 **픽셀 스크린샷 대신 기하 계산**으로 판정했다.
입력값은 전부 소스의 확정 수치다.

- 가로: 1440 − 240(사이드바) − 1(border-r) − 56(본문 px-28 ×2) = **1143px**
- 열 수: `auto-fill minmax(158px,1fr)` + gap 10 → `n·158 + (n−1)·10 ≤ 1143` → **6열** (열폭 ≈182px)
- 세로: 헤더 60 + 1 = 61 → 본문 pt-20 → main 시작 y=81. 섹션 gap 26. 카드 `min-h-[126px]`, 행 gap 10

| y | 요소 |
|---|---|
| 81–159 | ① 내 즐겨찾기 — 헤더(~26) + 빈 상태 점선 박스(~52). **카드 0** (신규 방문자) |
| 185–487 | ② 매일 사용하는 사이트 — 헤더 40 + **12개 = 2행 완전 노출** |
| 513–815 | ③ 현재 운영 중인 사이트 — 헤더 40 + **1·2행(12개) 완전 노출** |
| 825–900 | ③의 3행(4개) — 126px 중 **75px 노출 → 클릭 가능** |

**보수적 집계(완전 노출만): 카드 24 + 사이드바 14 + '전체 보기' 1 = 39개 ≥ 30 ✅**
부분 노출까지: **43개**.

사이드바 세로 합계는 60(브랜드)+1+12+35(캡션)+34×4+35(캡션)+34×9+20 ≈ **605px < 900** 이라 14개 전부 스크롤 없이 노출된다.

> 민감도 확인: 카드 높이가 `min-h` 126px를 넘어 140px·160px로 커져도 완전 노출 카드는 24 → 24 → 18로만 줄어
> 사이드바 14 + 1을 더하면 **어느 경우에도 39개 이상**이다. 결론이 카드 실제 높이에 흔들리지 않는다.

**아침 확인:** 1440×900 실제 스크린샷으로 위 배치가 스펙과 맞는지 눈으로 대조(§A-1).

---

## 2. 히어로·일러스트·그라데이션·장식 아이콘·마케팅 카피 없음 — **PASS**

### 소스 grep (테스트 파일 제외)

```
gradient | linear-gradient | radial-gradient | hero | illustration | 일러스트
→ app/ components/ lib/ scripts/ 전 범위 0건
geist | next.svg | vercel.svg | prefers-color-scheme | dark:
→ 0건 (A1 스캐폴드 잔재 정리 완료)
```

### 렌더 HTML 실측 (홈/즐겨찾기/매일/카테고리 4화면)

| 지표 | 홈 | 즐겨찾기 | 매일 | 카테고리 |
|---|---:|---:|---:|---:|
| `gradient` | 0 | 0 | 0 | 0 |
| `hero` | 0 | 0 | 0 | 0 |
| `<img>` | 0 | 0 | 0 | 0 |
| 이모지 | 0 | 0 | 0 | 0 |
| `<svg>` | 29 | 1 | 25 | 33 |

### 아이콘 전수 — 스펙 5종(+원형) 이내

홈의 svg 29개를 path 서명으로 묶으면 **정확히 2종**이다.

- `EyeIcon` × 28 — 카드마다 1개(클릭 수 앞). `components/icons.tsx`의 스펙 path 원문
- 헤더 검색창의 **원형 아웃라인** × 1 — `<circle r="5.25">` 하나. `components/Header.tsx:61`에 "아이콘 라이브러리를 들이지 않고 circle 하나로 그린다"로 근거 명시

`icons.tsx`에는 스펙 5종(Eye·Pin·Pencil·Trash·Check)만 정의돼 있고 Pencil·Trash는 3단계(J1·J2) 전까지 소비처가 없다.
`<img>`가 0인 것은 파비콘을 전부 CSS `background-image`(홈 24건)로 깔기 때문이며, 색은 파비콘에서만 나온다.

**마케팅 카피 없음:** 홈의 산문은 섹션 보조문 3줄(`직접 고정한 12개 · 자리가 바뀌지 않습니다` 등)과
빈 즐겨찾기 안내뿐이다. 계획서 V6(하단 안내 박스 제거)도 반영되어 있다 — 커밋 `98d1e63`.

---

## 3. 카드 단일 컴포넌트 (행 목록 없음) — **PASS**

`components/LinkCard.tsx`의 **소비처는 단 둘**이다.

| 소비처 | 경유 화면 |
|---|---|
| `components/HomeView.tsx` (3곳) | `/` 홈 — 즐겨찾기·매일·운영 중 |
| `components/ListView.tsx` (1곳) | `/daily`, `/category/[id]`, `/favorites`(→ `FavoritesView` → `ListView`) |

즉 **공개 화면 전부가 같은 카드 한 개**를 쓴다. `components/palette/CommandPalette.tsx`는 카드를 쓰지 않지만
**2단계 G2 산출물**이며, 스펙 5장이 56px 한 줄 행을 요구하는 팔레트 전용 마크업임이 주석에 명시돼 있다(1단계 범위 밖).

**행 목록 부재:** `<table` / `<tr>` / `<tbody` / `role="row"` / `ListRow` / `RowItem`
→ `app/`·`components/` 전 범위 **0건**.

---

## 4. 클릭 → DB 적재 · 쿨다운 · 상한 — **PASS**

dev 서버(3210)의 **실 API + 실 Supabase**에 대고 검증했다. 고유 `visitorId`(1회용 uuid)를 써서
기존 집계와 섞이지 않게 했고, **테스트 행은 전부 삭제했다**.

대상: `bd12f640-…0008` (ChatGPT) / 검증 전용 visitorId `bb34f421-…3a04`

### 3연타 결과

| # | HTTP | 응답 본문 |
|---|---|---|
| 1 | 200 | `{"counted":true}` |
| 2 | 200 | `{"counted":false,"reason":"cooldown"}` |
| 3 | 200 | `{"counted":false,"reason":"cooldown"}` |

**첫 클릭만 집계되고 30초 쿨다운이 2·3회차를 정확히 걸러냈다.**

### 계약(400) 확인

| 요청 | 결과 |
|---|---|
| `bookmarkId: "not-a-uuid"` | 400 `{"error":"bookmarkId 는 uuid 형식의 문자열이어야 합니다."}` |
| 존재하지 않는 uuid | 400 `{"error":"존재하지 않는 bookmarkId 입니다.","code":"unknown-bookmark"}` |

### DB 적재 · 정리

- 사전 `clicks` 행수(해당 북마크): **0**
- 3연타 후 이 visitorId로 생긴 행: **1** (`id=22`, `is_bulk=false`) — 쿨다운 판정이 insert까지 막았음을 확인
- 공개 집계 뷰 `bookmark_click_counts` 반영: `{"click_count":1}` ✅
- **정리:** 1행 삭제 → 사후 행수 **0** (사전과 동일) · 잔여 테스트 행 **0** ✅

### 일일 상한(`CLICK_DAILY_CAP = 10`)

실 API로는 30초 쿨다운 때문에 10회 적재에 **최소 4.5분**이 걸려 야간 자동 검증에서 제외했다.
대신 순수 함수 단위 테스트가 못박고 있다 — `app/api/click/logic.test.ts`:

- `오늘 상한만큼 쌓였으면 daily-cap 이다`
- `상한까지 찼어도 방금 누른 기록이 있으면 cooldown 이 먼저다 (계약의 판정 순서)`
- `자정을 넘긴 직후에도 30초 전 기록이면 cooldown 이다`

---

## 5. 핀 → localStorage · 홈 반영 — **PASS**

### 렌더 HTML의 핀 버튼 실측

| 화면 | 핀 버튼 수 | 판정 |
|---|---:|---|
| `/daily` | **12** | ✅ 목록 화면은 전부 핀 노출 |
| `/category/<id>` | **16** | ✅ |
| `/favorites` | 0 | ✅ 정상 — SSR 시점엔 favs가 비어 빈 상태를 그린다(E1 SSR 규약) |
| `/` 홈 | 0 | ✅ 정상 — 즐겨찾기 섹션이 비었고, 매일·운영 중 섹션은 `showPin={false}`(관리자가 정하는 자리, DESIGN_SPEC 3장) |

홈에 핀 버튼이 0인 것은 **설계대로**이며, 핀을 담을 수 있는 자리는 홈 밖 목록 화면 전부다(PRD P10).

### 지목 테스트 스위트 (전부 재실행 통과)

| 파일 | 스위트 |
|---|---|
| `lib/favorites.test.ts` | `useFavorites` · `pickFavorites` · `favToastText` |
| `components/LinkCard.test.tsx` | `LinkCard 핀` · `LinkCard 테두리 3상태` |
| `components/HomeView.test.tsx` | `HomeView — 핀 토글 (D6)` · `HomeView — 내 즐겨찾기 섹션` |
| `components/ListView.test.tsx` | `ListView — 핀 토글 (D6)` |
| `app/favorites/page.test.tsx` | `내 즐겨찾기 — favs 반영` · `— 핀 해제 (D6)` |

**아침 확인:** 실제 브라우저에서 핀 → 새로고침 → 홈 즐겨찾기 섹션 유지까지 눈으로 1회(§A-3).

---

## 6. 375px 터치 44px — **PASS(구조 한계 명시) + 관찰 1건**

### 코드 실측 인용 — 카드 액션 버튼

`components/LinkCard.tsx:45-64`가 스스로 실측값을 남겨 두었다.

```
const ACTION = '... size-[21px] ... before:absolute before:-inset-y-[11.5px] before:-inset-x-[0.5px]'
```

주석 원문 요지:
- 보이는 크기는 스펙대로 21×21, 손가락 히트 영역만 `::before`로 확장
- 버튼 간 gap이 1px뿐이라 가로는 ±0.5px에서 멈춘다 — 더 넓히면 옆 버튼 위로 겹쳐 **눌린 버튼이 뒤바뀐다**
- **실제 눌리는 크기는 22 × 42.5px** (세로 확장분 11.5px 중 1.5px를 카드의 `overflow-hidden`이 잘라내며, 잘린 영역은 히트 테스트에서도 빠진다)
- 따라서 **WCAG 2.5.5(AAA, 44×44)를 구조적으로 만족시킬 수 없다.** 2.5.8(AA, 24×24)도 가로 22px이라 2px 모자란다
- 스펙이 21×21 + gap 1px을 고정한 결과이며, 넓히려면 **스펙의 아이콘 크기·간격을 먼저 바꿔야 한다**

→ 1단계 구현이 잘못한 것이 아니라 **스펙 자체의 제약**이고, 코드가 그 사실을 문서화한 상태다.

### 렌더 확인 — narrow 규칙

- **MobileChips**: 홈 HTML에 `nav class="... px-[14px] py-[10px] min-[820px]:hidden"` + 링크 **13개** 렌더 확인
- **2열 그리드**: 카드 그리드 클래스가 `grid grid-cols-2 gap-[8px] min-[820px]:grid-cols-[repeat(auto-fill,minmax(158px,1fr))] min-[820px]:gap-[10px]` — 모바일 우선 2열 고정 확인
- 375px 기준 카드 열폭 = (375 − 24 − 8) / 2 = **171.5px**, 카드 `min-h-[104px]` → 카드 본문 앵커(열기 영역)는 44px를 크게 상회
- 셸 narrow 규칙은 `test/shell-structure.test.ts`의 `셸 레이아웃 반응형 (<820px)` 4개 케이스가 못박음

### ⓘ 관찰 (신규 — 계획서에 기록 없음)

`MobileChips`의 칩은 `h-[30px]`이고 `py-[10px]`은 **줄(nav)의 패딩이라 링크 히트 영역 밖**이다.
즉 375px에서 칩의 세로 터치 타깃은 **30px**로 44px에 미달한다(가로는 라벨 길이만큼 충분).
프로토타입 원문 수치(`height:30px`)를 그대로 옮긴 결과이고 카드 액션 버튼과 같은 성격의 스펙 제약이지만,
**LinkCard와 달리 이 사실이 코드에 기록돼 있지 않다.** 사이드바 행도 34px이나 <820px에서는 숨으므로 무관하다.
→ 코디네이터 판단 필요(§F-2).

---

## 7. 빈 상태 3종 — **PASS**

| # | 빈 상태 | 문구 | 지목 테스트 |
|---|---|---|---|
| 1 | 홈 · 내 즐겨찾기 섹션 | `다른 화면에서 카드 오른쪽 위의 핀을 누르면 이 자리에 모입니다. 매일 사용하는 사이트와 달리 내가 직접 담고 빼는 목록입니다.` | `components/HomeView.test.tsx` (`HomeView — 내 즐겨찾기 섹션`, L172·L350) |
| 2 | `/favorites` 화면 | `아직 담은 즐겨찾기가 없습니다. 목록에서 카드의 핀을 눌러보세요.` | `app/favorites/page.test.tsx` → `내 즐겨찾기 — 빈 상태 (DESIGN_SPEC 4장)`, `마지막 하나를 빼면 빈 상태 안내로 바뀐다` |
| 3 | 목록 화면(카테고리·매일) | `이 분류에 링크가 없습니다.` (`EMPTY_LIST_MESSAGE`) | `components/ListView.test.tsx` → `ListView — 빈 상태` 2케이스 / `app/category/[id]/page.test.tsx:158` / `app/daily/page.test.tsx:155` |

3종 모두 공용 `EmptyBox`(점선 `border-dashed border-dash`)로 그려지며, 박스 자체의 생김새는
`components/EmptyBox.test.tsx`가 담당한다. **실 렌더 확인:** `/favorites` HTML에서 2번 문구를 실제로 확인했다.

---

## 8. RLS: 익명 쓰기 전부 거부 — **PASS**

### 8-1. `npx tsx scripts/verify-schema.ts` 재실행 — **6종 전부 PASS**

```
PASS ① anon: categories·bookmarks select 성공
PASS ② anon: bookmarks insert 거부   [42501] new row violates row-level security policy
PASS ③ anon: clicks select·insert 거부  select 0행 / insert [42501]
PASS ④ service: is_pinned 13번째 → PIN_LIMIT  [P0001] 매일 고정은 최대 12개입니다
PASS ⑤ anon: bookmark_click_counts select 성공
PASS ⑥ service: 동명 상위 카테고리 중복 거부  [23505] categories_name_parent_id_key
6종 전부 통과 — B2 완료 기준을 만족합니다.
```

### 8-2. 보강 — 익명 키로 쓰기 9종 전수 시도 (verify-schema가 다루지 않는 update/delete 포함)

"**전부** 거부"를 문면 그대로 확인하기 위해 별도 프로브를 돌렸다. 결과 **9/9 DENIED**.

| 시도 | 결과 |
|---|---|
| `categories.insert` | DENIED `[42501]` |
| `categories.update` / `.delete` | DENIED — 오류 없이 **0행 영향** (정책상 대상 행이 보이지 않아 변경 불가) |
| `bookmarks.insert` | DENIED `[42501]` |
| `bookmarks.update` / `.delete` | DENIED — 0행 영향 |
| `clicks.insert` | DENIED `[42501]` |
| `clicks.select` | DENIED — 0행 (원본 비공개, 계획서 V1) |
| `clicks.delete` | DENIED — 0행 영향 |

- 원본 보존 재확인: `bookmark="ChatGPT"`, `category="AI 도구 모음"` — 변조 없음
- 마커 행 잔여 0건 (categories/bookmarks/clicks 전부)

계획서 편차 **V1**(clicks 직접 insert 차단, 기록은 `/api/click` service role 전용)이
스키마·정책 수준에서 실제로 성립한다.

---

## 9. 정성 검수 (PRD 성공 기준 1·2) — **부분 PASS / 나머지 DEFER**

### 9-1. 구조 파악 (성공 기준 1) — HTML 구조로 판정 가능한 부분 **PASS**

홈 `<main>`의 섹션 순서가 DESIGN_SPEC 3장과 일치한다(위→아래).

| 순서 | `aria-label` | 보조문 | 카드 |
|---|---|---|---|
| ① | 내 즐겨찾기 | (0개라 생략) + 점선 안내 | 0 |
| ② | 매일 사용하는 사이트 | `직접 고정한 12개 · 자리가 바뀌지 않습니다` | 12 |
| ③ | 현재 운영 중인 사이트 | `회사가 직접 운영하는 서비스 16개` | 16 |

사이드바에 분류 체계가 **캡션 2개로 명시**돼 있다.
- `빠른 접근`: 홈(290) · 내 즐겨찾기 · 매일 사용하는 사이트 · 현재 운영 중인 사이트
- `분류`: AI 도구 모음 · 마케팅 · 웹 도구 · 강의 및 출강 · 자사 포트폴리오 · UI/UX 디자인 · 기타 · 참고자료 · 구글 서비스 (9개)

→ **즐겨찾기 · 매일 · 운영 중 · 분류** 네 축이 첫 화면에 전부 글자로 드러난다.
"처음 보는 사람이 실제로 그렇게 읽는가"는 사람 판단이므로 아침 확인으로 넘긴다(§A-4).

### 9-2. 2클릭 도달 (성공 기준 2) — **PASS (290/290 = 100%)**

임의 3개 표본이 아니라 **전수**로 계산했다. 경로는 `홈 → 사이드바 상위 분류(1클릭) → 카테고리 화면의 카드(2클릭)`.

```
카테고리: 총 22 | 상위 10 | 하위 12
손자 카테고리(2단 트리 위반): 0     ← 있으면 카테고리 화면에 안 뜬다
고아 카테고리(부모 없음): 0

1클릭 (홈 카드에 직접 노출): 25
2클릭 (홈 → 사이드바 상위 → 카드): 265
2클릭 초과 / 도달 불가: 0
전체 커버리지: 290 / 290 = 100.0%
```

성립 근거는 `app/category/[id]/page.tsx`의 `ownIds = {상위} ∪ {모든 직계 하위}` — 상위 분류 화면의
'전체' 탭이 하위 링크까지 전부 담기 때문에, 하위에 매달린 링크도 상위 클릭 한 번으로 도달한다.
트리 깊이가 2단을 넘지 않는다는 점(손자 0건)이 이 성질의 전제이며 실측으로 확인했다.

> 홈 카드 28장 = 매일 12 + 운영 중 16이고, 그중 3건이 양쪽에 겹쳐 **고유 25건**이 1클릭이다.

### 9-3. 부수 확인 — `<main>` 위치 규약 · 스캐폴드 잔재 (계획서 §6 O1의 M-5)

4개 공개 화면 전부에서:
- `<main>` **정확히 1개**, 그리고 **스크롤 컨테이너 바로 안**에 위치
  (`...overflow-y-auto bg-surface px-[12px] ... "><main`) ✅
- `lang="ko"` 1개 ✅ / `Geist` 0건 ✅ / 소스에 `next.svg`·`vercel.svg`·`dark:`·`prefers-color-scheme` 0건 ✅

렌더 HTML에 `prefers-color-scheme`이 1건 잡히지만 **Next 내장 404 페이지의 인라인 스타일**(RSC 페이로드 안)이며
우리 코드가 아니다.

> **키보드 스크롤 포커스(M-6)** 는 자동 판정에서 제외했다. 스크롤 컨테이너(`overflow-y-auto` div)에
> `tabIndex`가 없어 브라우저 기본 규칙상 **내부에 포커스 가능한 요소가 있을 때만** 키보드로 스크롤된다.
> 공개 화면은 전부 카드 앵커를 담고 있어 Tab 이동으로 스크롤이 따라오지만,
> 카드가 0장인 빈 상태 화면에서는 그렇지 않을 수 있다 → 아침 키보드 확인 항목(§A-5).

---

## 10. `global-error` — **PASS(주어진 기준) / 단, 전제와 어긋나는 실측 있음**

### 10-1. 프로덕션 빌드 산출물 포함 — 확인됨

깨끗한 worktree에서 `npm run build` 성공 후 산출물을 뒤졌다.

| 산출물 | 크기 |
|---|---:|
| `.next/server/chunks/ssr/app_global-error_tsx_1kp6l3x._.js` | 1,112 B |
| `.next/server/chunks/ssr/app_global-error_tsx_0w002m_._.js` | 579 B |
| `.next/server/app/_global-error.{html,rsc,meta}` | 8,688 / 4,687 / 421 B |

**문구까지 확인:** `app_global-error_tsx_1kp6l3x._.js` 와 클라이언트 청크
`1bvmo5oaz8ddx.js` · `37xxll1v9kp70.js` 안에 `일시적인 오류가 발생했습니다` · `다시 시도` 원문이 들어 있다.
빌드 통과 + 산출물 포함이라는 **이 게이트의 기준은 충족**한다.

### 10-2. ⚠️ 런타임 실측 — 루트 레이아웃 throw 시 우리 화면이 나오지 않는다

`dev 오버레이 한계`를 우회하려고 **프로덕션 서버로 실제 재현**까지 했다.
격리된 worktree에서 `.env.local`의 `NEXT_PUBLIC_SUPABASE_URL`을 도달 불가 호스트로 바꿔 재빌드 →
`next start -p 3211` → `GET /`.

서버 로그상 의도한 오류가 정확히 발생했다.

```
TypeError: fetch failed
Caused by: Error: getaddrinfo ENOTFOUND o1-gate-unreachable.invalid
```

그런데 응답은:

| 항목 | 값 |
|---|---|
| HTTP | **500** |
| 본문 크기 | 3,555 B |
| `<html>` | `<html id="__next_error__">` — `lang="ko"` 아님 |
| 화면 텍스트 | **`내 링크`(title) 한 줄뿐. 본문 비어 있음** |
| `일시적인 오류가 발생했습니다` | **미포함** |
| `다시 시도` 버튼 | **미포함** |
| 배경색 `#f7f5f2` | **미포함** |

하이드레이션으로 늦게 그려질 가능성까지 확인했으나 **부정적**이다.
- 이 500 응답이 로드하는 스크립트 5개 중 우리 문구를 가진 청크가 **없다**
- 그 5개 중 어느 것도 `1bvmo5oaz8ddx` · `37xxll1v9kp70`을 **참조하지 않는다**(지연 로드 경로 없음)
- RSC 페이로드에는 `OutletBoundary`·`ViewportBoundary`·`MetadataBoundary`만 실려 있다

**정리:** `app/global-error.tsx`는 빌드에 **포함되어 있으나**, 계획서 §6 O1이 전제한
"루트 레이아웃 throw를 global-error가 담당한다"는 **SSR 단계 실패에서는 관측되지 않았다**.
사용자에게는 제목만 있는 빈 500 화면이 보인다. Next 16의 SSR-throw 처리 방식으로 보이며,
클라이언트 하이드레이션 이후 발생한 오류에는 정상 동작할 수 있다(그 경로는 미검증).

**나는 코드를 고치지 않았다.** 처분은 코디네이터 몫이다(§F-1).

---

## 11. Vercel 프리뷰 — **DEFER (로컬 확인 불가)**

Vercel 토큰·프로젝트 연결이 이 환경에 없어 프리뷰 배포·URL 확인이 불가능하다.
`vercel.json`도 저장소에 없다. → 아침 확인(§A-6).

---

## 아침 확인 목록 (사람 눈·외부 자격증명 필요)

| # | 항목 | 이유 | 참고 |
|---|---|---|---|
| A-1 | **1440×900 홈 스크린샷** — 스펙 배치 대조 | 헤드리스 브라우저 부재로 픽셀 검증 불가. 링크 수는 기하 계산으로 39개 이상 확정(§1) | C1 시각 검증 이월분 |
| A-2 | **375px 스크린샷** — 칩 줄·2열 그리드·터치감 | 클래스 렌더는 확인했으나 실제 배치는 눈 필요 | §6 |
| A-3 | **핀 → 새로고침 → 홈 반영** 브라우저 1회 | localStorage 왕복은 테스트가 덮지만 실사용 확인 1회 권장 | §5 |
| A-4 | **정성 검수 — 처음 보는 사람의 구조 파악** (PRD 성공 기준 1) | 사람 판단. 구조·문구는 §9-1에 전부 정리해 둠 | §9-1 |
| A-5 | **키보드 스크롤 포커스(M-6)** — 특히 카드 0장인 빈 상태 화면 | 스크롤 컨테이너에 `tabIndex` 없음 | §9-3 |
| A-6 | **Vercel 프리뷰 배포·URL** | 토큰 없음 | §11 |
| A-7 | **사내망에서 jsdelivr(Pretendard CDN) 도달성** | 계획서 L284가 "O1 게이트에서 확인 후 결정"으로 남겨 둔 항목. 폰트 자가호스팅 전환 여부가 여기 달림 | `app/layout.tsx:16` |
| A-8 | **프로덕션 `global-error` 브라우저 확인** | §10-2 실측 결과 확인·처분 | §F-1 |

---

## 코디네이터 처분 필요 (FAIL 아님 · 판단 요청)

### F-1. `global-error`가 SSR throw에서 관측되지 않음 — **우선순위 높음**

§10-2 참조. 게이트의 문면 기준(빌드 산출물 포함)은 통과하나 **계획서가 기대한 동작이 실측되지 않았다**.
루트 레이아웃이 DB를 읽으므로(`getAllData`) 조회 실패·환경변수 누락이 곧 이 경로다 —
운영에서 Supabase가 흔들리면 사용자는 **빈 500 화면**을 본다. 1단계 차단 사유로 볼지, 3단계 H1(미들웨어)과 함께 다룰지 판단 필요.

### F-2. `MobileChips` 칩 터치 타깃 30px — **우선순위 낮음**

§6 관찰 참조. 프로토타입 원문 수치를 따른 결과라 LinkCard(42.5×22)와 같은 성격의 스펙 제약이지만,
**코드에 그 사실이 기록돼 있지 않다.** 최소한 `LinkCard`처럼 주석으로 남겨 두는 편이 이후 재검토에 유리하다.

### F-3. CI 순서 — `build` → `typecheck`

§0-1 재현 메모 참조. 깨끗한 체크아웃에서 typecheck를 먼저 돌리면 `LayoutProps` 미정의로 실패한다.
CI 파이프라인을 짤 때(4단계 L 계열) 순서를 못박아야 한다.

---

## 1단계 커밋 요약

- **범위:** `5d0239d^..4d2c081` — 총 **58 커밋**
- 그중 2단계(G1) 선행 커밋 2건(`6ba5e69`, `33db476`)을 제외한 **1단계 커밋 = 56건**
- 시작 `5d0239d` (2026-08-09) · 종료 `4d2c081` (2026-08-09) — 전 작업이 하루에 수행됨
- 구성: 기능 커밋 + `fixup(...)` 리뷰 반영 커밋이 스토리마다 짝을 이루는 형태(스펙·품질 2단 리뷰 결과)

### 주요 SHA (스토리 완료 기준)

| 스토리 | SHA | 제목 |
|---|---|---|
| 준비 | `5d0239d` | 이전 프로토타입 제거, 디자인 핸드오프 번들과 5단계 구현 계획 추가 |
| A1 | `eb5e30d` | Next.js 스캐폴드 및 테스트 인프라 구축 |
| A2 | `046b5ba` | 디자인 토큰·전역 스타일 정의 및 스캐폴드 잔재 정리 |
| B1 | `123b57d` | Supabase 클라이언트 헬퍼 3종 + .env.example |
| B2 | `4a66964` | B2 스키마 마이그레이션 SQL + 검증 스크립트 추가 |
| B3 | `f5160a1` | links.json 시드 매퍼 buildSeed 추가 (순수 함수) |
| B4·B5 | `e4a2958` | 파비콘 수집·업로드(B4) + 시드 실행(B5) |
| C1 | `b3edfe6` → `1d7bd17` | 공통 셸 레이아웃 → 사이드바·헤더·토스터 배선 |
| C2 | `07999a7` | 링크 카드 컴포넌트 구현 |
| C3 | `0ae04b0` | 사이드바 트리 컴포넌트 추가 |
| C4 | `5d53293` | 헤더 컴포넌트 구현 |
| C5 | `f3de291` | 보조 컴포넌트 4종 (CardGrid·SectionHeader·EmptyBox·Toast) |
| D1 | `6398545` | 데이터 로딩 계층 — getAllData + 카운트 롤업 |
| D2 | `f0821a9` | 홈 화면 — 3섹션 (+ `98d1e63` V6 하단 안내 제거) |
| D3 | `4f319e1` | 공용 목록 화면(ListView) + 카테고리 페이지 |
| D4 | `5db4069` | 내 즐겨찾기·매일 사용하는 사이트 목록 화면 |
| D5 | `997ecd0`·`74d46b9` | <820px 반응형 (+ `4d2c081` 최종 fixup) |
| D6 | `31933eb` | 전 목록 화면에 핀 토글 배선 + pickFavorites 추출 |
| E1 | `741a379` | useFavorites 훅 |
| F1 | `5ecbe33` | 방문자 ID 유틸 |
| F2 | `524c587` | POST /api/click 클릭 집계 라우트 |
| F3 | `9833df2` | 카드 클릭 → /api/click 기록 배선 + 열기 토스트 |

---

## 결론 — 게이트 판정

**조건부 통과 (CONDITIONAL PASS).**

자동 검증 가능한 11개 항목에서 **FAIL은 없다.** 공통 게이트(테스트 579개·타입·빌드) 전부 그린이고,
클릭 집계·RLS·2클릭 도달 100%·무채색 제약·카드 단일화처럼 **실 DB·실 API·실 렌더로 확인한 항목이
모두 기대대로 동작**한다. 1단계 코드 자체에서 발견된 결함은 없다.

다만 **§F-1(global-error가 SSR throw에서 관측되지 않음)** 은 계획서가 이 게이트에서 확인하라고
지목한 항목이 **전제와 다르게 나온 경우**라, 사용자 확인 전에 코디네이터의 처분이 필요하다.
이 한 건과 아침 확인 목록(A-1~A-8)이 정리되면 1단계 게이트를 종료할 수 있다.

> 검수 원칙: FAIL·이상 징후를 발견해도 **코드를 수정하지 않았다.** 다른 에이전트의 작업 트리·
> 계획서 미커밋 변경도 건드리지 않았다. 검증용 임시 파일과 worktree, DB 테스트 행은 전부 정리했다.
