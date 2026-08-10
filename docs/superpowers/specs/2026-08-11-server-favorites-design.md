# 즐겨찾기를 서버로 옮긴다 (공용 큐레이션) — 설계

**작성일:** 2026-08-11
**상태:** 사용자 승인됨 (방향), 스펙 리뷰 대기

---

## 한 줄 요약

즐겨찾기를 **브라우저 localStorage에서 DB로** 옮긴다. 관리자가 담은 목록 한 벌이 곧 모든 방문자의 홈이 된다.

---

## 1. 배경 — 무엇이 고장났나

사용자 신고: "다른 컴퓨터에서 접속해보니 즐겨찾기가 안 나와. 관리자로 로그인해도 안 나와."

**근본 원인(조사 완료).** 버그가 아니라 1단계의 설계된 동작이다. 즐겨찾기는 `linkdash:favs` 키로
**그 브라우저의 localStorage에만** 저장된다(`lib/favorites.ts`, `lib/constants.ts:32`). 서버에는
테이블도 컬럼도 없다. 그래서:

- 다른 컴퓨터 = 빈 `linkdash:favs` = 빈 목록
- 관리자 로그인은 무관하다 — 즐겨찾기가 계정에 붙은 적이 없다. 관리자 세션이 정하는 것은
  연필·휴지통의 노출뿐이다(J1)

근거는 `docs/PRD.md:148-151`에 명시돼 있다: *"방문자 계정이 없으므로 1단계에서는 DB 테이블을 두지
않고 브라우저 localStorage에 bookmark_id 목록으로만 저장합니다. … 향후 사내 SSO를 붙이면 아래
테이블로 승격합니다."*

**배제한 원인들.** 프로덕션(`favorite.itconnect.dev`)을 비로그인으로 받아 확인했다 — 분류 트리와
링크 카드가 서버 렌더로 정상 출력된다. 읽기 RLS(`cat_read`·`bm_read`)가 `using (true)`라 익명도
본다(`supabase/migrations/0001_init.sql:78-80`). 배포·환경변수·RLS 문제가 아니다.

**증상이 심각한 이유.** 즐겨찾기는 곁다리 기능이 아니라 **홈 화면 본문 그 자체**다.
`components/HomeView.tsx:167-198`이 즐겨찾기를 세 묶음(AI 소식 / AI 서비스 / 업무용 서비스)으로
갈라 홈 위쪽에 놓고, 서버 데이터로 채워지는 것은 아래쪽 '현재 운영 중인 사이트' 하나뿐이다.
즉 관리자 본인 브라우저를 벗어나면 홈이 거의 빈 화면이다.

---

## 2. 확정된 결정 (2026-08-11 사용자 승인)

| # | 결정 | 내용 |
|---|---|---|
| F1 | 저장 위치 | **DB로 옮긴다.** 관리자 계정 기준의 공용 한 벌 |
| F2 | 누가 보나 | **누구나.** 비로그인 방문자의 홈에도 같은 목록이 나온다 — 관리자가 담은 게 모두의 홈 |
| F3 | 누가 담나 | **관리자만.** 핀은 연필·휴지통과 같은 편집 도구가 된다. 방문자에게 홈은 읽기 전용 |
| F4 | 저장 모양 | **`bookmarks` 테이블에 컬럼 두 개**(`is_favorite`·`fav_order`). 별도 테이블을 만들지 않는다 |
| F5 | 기존 데이터 | 콘솔에서 JSON을 뽑아 **시드 스크립트로 주입**. 담긴 순서까지 보존 |

### F4를 고른 이유 (탈락안 포함)

- **채택 — bookmarks 컬럼 두 개**: 즐겨찾기가 "공용 한 벌"이면 그것은 사실상 북마크의 상태다.
  `getAllData`가 이미 bookmarks 전 행을 읽으므로 **쿼리 수가 늘지 않고**, 쓰기 권한도 기존
  `bm_write`(관리자 한 명)가 그대로 덮어 **새 RLS 정책을 한 줄도 안 쓴다** — 보안 표면이 안 는다.
- **탈락 — 별도 `favorites` 테이블**: PRD가 예고한 모양이고 훗날 `user_id`를 붙이기 좋지만, 지금
  얻는 것은 "공용 한 벌"뿐인데 테이블 1 + RLS 정책 2 + 쿼리 1 + 합치는 코드가 는다. 방문자 계정이
  생기는 날 옮기면 될 비용을 미리 내는 셈이라 YAGNI로 판단.
- **탈락 — '즐겨찾기' 분류를 만들어 링크를 옮긴다**: 즐겨찾기는 분류와 **직교해야 한다**.
  `lib/fav-groups.ts:32`가 링크의 상위 분류로 세 묶음을 정하므로, 분류를 바꾸면 묶음 판정이 무너진다.

---

## 3. 범위 밖 (의도적으로 안 한다)

- **방문자 개인 즐겨찾기.** F2·F3 결정에 따라 localStorage 저장소는 통째로 사라진다. 두 저장소를
  공존시키지 않는다 — 상태가 하나여야 화면이 거짓말을 하지 않는다.
- **`is_pinned` 컬럼 정리.** '매일 사용하는 사이트'가 걷히며 놀게 된 죽은 컬럼이다
  (`lib/constants.ts:27`). 이번 작업과 무관하므로 손대지 않는다. **재활용도 하지 않는다** —
  이미 `true`로 남아 있는 행들이 있어 재활용하면 담은 적 없는 링크가 홈에 뜬다.
- **화면 이름 변경.** `FAVORITES_TITLE = '내 즐겨찾기'`는 그대로 둔다. 공용이 된 마당에 '내'가
  어색하긴 하나, 이 상수는 사이드바·홈 섹션·`/favorites` 세 자리가 공유하고 판정에도 쓰여
  (`lib/constants.ts:20`) 이름을 바꾸면 이번 고침과 무관한 변경이 번진다. 별건으로 다룬다.

---

## 4. 아키텍처

### 4.1 데이터 — 마이그레이션 `0006_server_favorites.sql`

```sql
alter table bookmarks
  add column if not exists is_favorite boolean not null default false,
  add column if not exists fav_order   int     not null default 0;
```

- **RLS 정책을 새로 쓰지 않는다.** `bm_read`(공개 select)·`bm_write`(관리자 전용 all)는 컬럼이
  아니라 행에 걸리므로 새 컬럼에 자동으로 적용된다.
- **인덱스를 만들지 않는다.** 290행이고 `getAllData`가 어차피 전 행을 읽어 JS에서 거른다.
- `fav_order`를 따로 두고 `sort_order`를 재활용하지 않는 이유: `sort_order`는 **분류 안에서의**
  차례다. 재활용하면 홈에서 카드를 끈 것이 카테고리 화면의 순서까지 바꾼다. 지금 설계가 일부러
  갈라 둔 축이다.
- 기존 마이그레이션 규약을 따른다: 파일 상단에 적용 방법·재실행 안전성·근거 주석, `if not exists`로
  재실행 안전.

### 4.2 읽기 경로

| 파일 | 변경 |
|---|---|
| `lib/types.ts` | `Bookmark`에 `is_favorite: boolean; fav_order: number;` 두 줄 |
| `lib/queries.ts` | `BOOKMARK_COLUMNS`에 두 칸 추가. **쿼리 수는 3개 그대로** |
| `lib/favorites.ts` | `pickFavorites`가 `favs` Set 대신 북마크 배열만 받는다 |

`pickFavorites(bookmarks)`는 `is_favorite`으로 거르고 `fav_order`(동점이면 `id`)로 세운다.
타이브레이커를 두는 것은 `lib/queries.ts:63`이 이미 같은 이유로 하는 일이다 — 동점이면 순서가 매
요청 달라져 진단이 어려워진다.

이 변경으로 **`lib/favorites.ts`가 `'use client'` 없는 순수 모듈이 된다.**

### 4.3 쓰기 경로 — `lib/mutations.ts`

기존 12개 액션과 같은 모양을 따른다: `writeClient()` 게이트 → `null`이면 `DENIED` → 성공 시
`succeed()`가 `revalidatePath('/', 'layout')`.

**`setFavorite(id: string, next: boolean): Promise<ActionResult>`**

토글이 아니라 **방향을 명시**한다. 화면은 서버가 내려준 현재 상태를 이미 알고 있고, 그러면
서버에서 읽고-뒤집고-쓰는 경합 구간이 없어지며 같은 요청이 두 번 와도 결과가 같다(멱등).
담을 때 `fav_order`는 `max(fav_order) + 1`로 맨 뒤에 붙인다.

**`reorderFavorites(orderedIds: string[]): Promise<ActionResult>`**

`lib/mutations.ts:702` `reorderBookmarks`와 **같은 알고리즘**을 `fav_order`에 쓴다: 받은 id들이
쥐고 있던 슬롯을 모아 재배치. 이 방식이라 홈의 세 묶음처럼 **한 묶음의 id만 와도** 다른 묶음의
상대 순서가 흔들리지 않는다 — 지금 `useFavorites().reorder`가 주는 보장과 같다.

이를 위해 `lib/mutations.ts:862` `writeOrder`가 `sort_order`로 하드코딩한 컬럼을 인자로 받게
넓힌다(기존 호출부는 `'sort_order'`를 넘겨 동작 불변).

### 4.4 화면 배선

**핀 노출 (F3).** `components/LinkCard.tsx`의 핀 버튼은 `showPin && isAdmin`일 때만 렌더한다.
판정을 카드에 두는 것은 어느 화면이 배선을 빠뜨려도 방문자 응답에 관리 도구 마크업이 실리지
않게 하기 위해서다 — 연필·휴지통과 같은 규칙이다(README 주의사항 7: 그려 두고 CSS로 감추지 마라).

**핀 상태.** `isFaved` prop을 없애고 카드가 이미 받은 `bookmark.is_favorite`을 읽는다. 두 값이
어긋날 자리를 없앤다.

**핀 클릭.** `components/useCardHandlers.ts`의 `handleToggleFav(id)`가 그 화면이 들고 있는
`bookmarks`에서 링크를 찾아(제목을 찾느라 이미 하는 일이다) `setFavorite(id, !bookmark.is_favorite)`을
불러 결과를 기다린 뒤 토스트를 띄운다 — 성공이면 `favToastText`, 실패면 액션이 준 문구.
낙관적 갱신은 두지 않는다: 연필·휴지통·인라인 편집이 모두 왕복을 기다린 뒤 `revalidatePath`로
반영되는 것과 같은 취급이다.

**드래그 정렬.** `components/useCardReorder.ts`의 `onCommit?: (ids) => void`를
`commit?: (ids: string[]) => Promise<ActionResult>`로 바꾸고 기본값을 `reorderBookmarks`로 둔다.
지금은 localStorage 경로가 동기·무오류라 99-104행이 try/catch·토스트를 건너뛰는 **별도 분기**인데,
서버 액션이 되면 실패할 수 있으므로 두 경로가 같은 오류 처리를 타야 한다. 분기가 사라진다.

`components/ListView.tsx`의 `reorderStore: 'server' | 'favorites'`는 남는다 — 의미가 "어느
저장소냐"에서 "어느 컬럼이냐"로 바뀌어 `'favorites'`가 `reorderFavorites`를 넘긴다.

**사이드바 개수.** `app/(public)/layout.tsx`가 이미 부른 `getAllData`에서
`bookmarks.filter((b) => b.is_favorite).length`로 직접 세어 `Sidebar`에 넘긴다.

### 4.5 삭제되는 것들

서버가 알게 되면서 **우회 장치들이 존재 이유를 잃는다.** 이 작업의 순증 코드량은 음수에 가깝다.

| 대상 | 왜 사라지나 |
|---|---|
| `lib/favorites.ts`의 `useFavorites` 훅 전체 | 스토어·`memoryFavs` 폴백·`storage` 이벤트 구독·SSR 스냅샷·`getSnapshot` 캐시가 전부 "서버가 모르는 값"을 다루려던 장치다 |
| `components/SidebarContainer.tsx` (+ 테스트) | 개수 하나를 브라우저에서 채우려고 만든 클라이언트 경계. 그 JSDoc이 적어 둔 "죽은 id 때문에 숫자가 어긋난다" 문제도 원인이 사라진다 |
| `components/FavoritesView.tsx` | 서버가 목록을 알므로 `app/(public)/favorites/page.tsx`가 `pickFavorites` 후 `ListView`를 직접 렌더하면 된다 |
| `components/card/DeleteConfirm.tsx`의 `useFavorites().remove` 호출 | 링크 행이 지워지면 `is_favorite`도 함께 사라진다 — 죽은 id 자체가 생기지 않는다 |
| `lib/constants.ts`의 `FAVS_KEY` | 쓰는 곳이 없어진다 |
| `useCardReorder`의 `onCommit` 분기 | 4.4 참조 |

### 4.6 문구 수정

두 문구는 `components/FavoritesView.tsx`가 사라지면서(4.5) `app/(public)/favorites/page.tsx`로 옮겨간다.

| 자리 | 지금 | 바꿀 것 |
|---|---|---|
| `/favorites` 설명 | `카드의 핀을 눌러 담은 링크입니다 · 이 브라우저에만 저장됩니다` | 브라우저 문구 삭제 — 이제 거짓이다 |
| `/favorites` 빈 문구 | `아직 담은 즐겨찾기가 없습니다. 목록에서 카드의 핀을 눌러보세요.` | `isAdmin`으로 가른다. 방문자에게는 핀이 없으므로 행동을 지시하지 않는 문구 |

---

## 5. 기존 데이터 이관 (F5)

**뽑기** — `favorite.itconnect.dev`를 담긴 브라우저로 연 뒤 개발자도구 콘솔에서:

```js
copy(localStorage.getItem('linkdash:favs'))
```

**넣기** — `scripts/import-favorites.ts`. 기존 시드 스크립트 패턴을 따라
`scripts/lib/service-client.ts`(service role)로 붙는다. 받은 배열의 **차례를 그대로** `fav_order`
0,1,2…로 쓰고 `is_favorite = true`로 표시한다.

- 배열에 있으나 DB에 없는 id(그 사이 지워진 링크)는 **건너뛰고 몇 건인지 보고**한다 — 조용히
  삼키면 개수가 안 맞는 이유를 알 수 없다.
- 재실행 안전해야 한다: 먼저 전 행을 `is_favorite = false`로 되돌린 뒤 목록대로 다시 세운다.
  그래야 두 번 돌려도 결과가 같고, 잘못 넣었을 때 올바른 목록으로 다시 돌리면 복구된다.
- 한 번 쓰고 지우지 않고 `scripts/`에 남긴다 — 이미 운영 도구 모음이 있는 자리다.

---

## 6. 오류 처리

기존 규약을 그대로 따른다.

- 두 액션 모두 비로그인·비관리자면 `DENIED`. 게이트는 `getAdminSession()` 하나뿐이다.
- DB 실패는 `describeFailure`로 분류해 문구를 만든다. 실패 시 `revalidatePath`를 부르지 않는다.
- 순서 저장의 부분 성공은 기존 `failAfterPartialChange` 규약을 그대로 쓴다 — 일부만 바뀌었으면
  화면을 DB와 맞춘다.
- 클라이언트에서 서버 액션 호출은 **반드시 try/catch로 감싼다.** 트랜지션 안에서 던지면 가장
  가까운 오류 경계로 올라가는데 공개 화면 위에는 `app/global-error.tsx` 하나뿐이라, 핀 한 번
  거부된 것으로 화면 전체가 오류 화면이 된다(`useCardReorder`가 이미 적어 둔 근거).

---

## 7. 테스트 전략

코로케이트 규약(`*.test.ts(x)`를 소스 옆에)을 따른다. **Windows 주의: 테스트는 반드시 PowerShell
대문자 드라이브 경로에서 실행한다** — Git Bash 소문자 경로에서는 vitest가 오작동한다.

| 파일 | 무엇을 지키나 |
|---|---|
| `lib/favorites.test.ts` | 훅 테스트를 걷어내고 `pickFavorites`의 새 계약: `is_favorite` 거르기, `fav_order` 정렬, 동점 시 `id` 타이브레이커 |
| `lib/mutations.test.ts` | `setFavorite` — 비로그인 거부 / 담을 때 맨 뒤 / 멱등. `reorderFavorites` — 한 묶음만 보내도 다른 묶음이 안 흔들림 / 없는 id 무시 |
| `components/LinkCard.test.tsx` | **비관리자 응답에 핀 마크업이 실리지 않는다**(감춤이 아니라 미렌더) |
| `components/useCardReorder.test.ts` | 서버 실패 시 오류 경계로 던지지 않고 토스트로 접는다 |
| `app/(public)/page.test.tsx` | 홈 세 묶음이 **서버 데이터만으로** 그려진다(브라우저 상태 없이) |
| `app/(public)/favorites/page.test.tsx` | 같은 목록·같은 순서. 관리자/방문자 빈 문구 분기 |

**회귀 방지의 핵심 한 가지**: 홈이 서버 데이터만으로 채워지는지 보는 테스트다. 그것이 이번
신고(다른 컴퓨터에서 빈 화면)를 직접 막는 검사다.

---

## 8. 위험과 맞바꿈

| 위험 | 판단 |
|---|---|
| 방문자 개인 즐겨찾기가 사라진다 | F2·F3에서 사용자가 명시적으로 선택. 이 사이트는 관리자 큐레이션이 목적이다 |
| 핀 토글에 서버 왕복이 생겨 즉시성이 준다 | 연필·휴지통과 같은 체감. 관리자만 쓰는 동작이라 수용 |
| 배포와 이관 사이에 홈이 비어 보인다 | 마이그레이션 → 이관 스크립트 → 배포 순으로 진행하면 창이 없다. 컬럼 기본값이 `false`라 이관 전 배포하면 홈이 빈다 |
| 훗날 사용자별 즐겨찾기로 갈 때 이사 비용 | `favorites` 테이블로 옮기고 컬럼 두 개를 버리면 된다. 그날의 비용을 오늘 내지 않기로 한 판단(F4) |

---

## 9. 작업 순서 (의존성)

1. **마이그레이션 0006** 적용 — 이후 전부의 선행
2. **읽기 경로**(타입·쿼리·`pickFavorites`) — 3과 병렬 가능
3. **쓰기 경로**(`setFavorite`·`reorderFavorites`·`writeOrder` 일반화) — 2와 병렬 가능
4. **화면 배선 + 삭제** — 2·3에 의존
5. **이관 스크립트 실행** — 1에 의존, 4와 병렬 가능
6. **배포** — 전부에 의존. 5보다 뒤여야 홈이 비는 순간이 없다
