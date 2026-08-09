/**
 * 관리자 신원의 **단일 출처**.
 *
 * 이 저장소에서 "관리자"는 계정 하나뿐이다(PRD·계획서 H1 — 사내 수동 생성이라 가입 흐름이
 * 아예 없다). 그 사실을 여러 곳이 각자 알고 있으면 언젠가 어긋나므로 값을 여기 한 번만
 * 적고 모두가 읽어 간다:
 *
 * - **게이트** — `lib/supabase/server.ts` 의 `getAdminSession()` 이 이 이메일인 사용자에게만
 *   세션을 돌려준다. 다른 계정으로 로그인해도 `null` 이다.
 * - **계정 생성** — `scripts/create-admin.ts` 가 이 이메일로 계정을 만든다.
 * - **RLS** — `supabase/migrations/0002_admin_write_policy.sql` 의 쓰기 정책 술어가 이 이메일이다.
 *   SQL 은 이 모듈을 import 할 수 없어 값이 **복사돼 있다.** 바꿀 때는 반드시 함께 바꿔라 —
 *   한쪽만 바꾸면 "로그인은 되는데 저장은 전부 실패한다"(또는 그 반대)가 된다.
 *
 * ## 이 파일에 `import 'server-only'` 를 붙이지 마라
 *
 * `scripts/create-admin.ts` 가 `npx tsx` 로, 즉 Next 의 `react-server` 조건 **밖에서** 이
 * 모듈을 import 한다. `server-only` 를 붙이면 그 순간 스크립트가 import 만으로 throw 한다
 * (`lib/supabase/admin.ts` 주석 참조). 여기 든 것은 비밀이 아니라 **공개 상수**다 —
 * 브라우저 번들에 실려도 아무 권한도 주지 않는다. 권한을 정하는 것은 세션과 RLS다.
 */
export const ADMIN_EMAIL = 'contact@itconnect.dev';
