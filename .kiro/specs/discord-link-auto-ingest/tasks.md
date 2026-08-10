# Discord 링크 자동 수집 구현 계획

> 기준: [`requirements.md`](./requirements.md), [`design.md`](./design.md)
> 상태 표기: `[x]` 기획·설계 완료, `[ ]` 구현 또는 운영 작업 대기

## 실행 원칙

- 각 task는 관련 테스트를 먼저 추가하거나 같은 commit에 포함한다.
- DB 동작은 SQL 문자열 검사만으로 완료 처리하지 않고 실제 PostgreSQL integration으로 검증한다.
- migration·script·문서 어디에도 role password나 DSN 값을 기록하지 않는다.
- 구현 task마다 가장 가까운 코드 관례와 `AGENTS.md`를 다시 읽고, 관련 파일만 stage·commit한다.

---

- [x] 0. 중단된 spec을 검토하고 구현 차단 결정을 종결한다
  - [x] 기존 `requirements.md`와 schema·mutation·admin UI·favicon collector의 실제 동작을 대조한다.
  - [x] custom API key와 agent direct DB 대신 HMAC ingest API + 서버 전용 최소권한 DSN을 선택한다.
  - [x] public source/private provenance, receipt/rate ring 분리, URL unique, 9-result contract를 확정한다.
  - [x] favicon SSRF·starvation·upload timeout을 safe mode·fair claim·deadline으로 해소한다.
  - [x] rollout·rollback·kill switch와 requirement-to-test traceability를 확정한다.
  - _Requirements: 1~9_

- [ ] 1. 구현 환경과 live-schema preflight를 준비한다
  - [ ] `npm ci` 후 `node_modules/next/dist/docs/`에서 Server Actions, route segment `maxDuration`,
    cache/revalidation 관련 Next 16.3 문서를 읽고 design 가정과 다른 점을 먼저 반영한다.
  - [ ] `scripts/verify-schema.ts`의 현재 0003·0004 대표 함수 존재 검사와 비-missing 오류 통과를
    catalog·ACL·대표 body 계약 검사로 보강한 뒤 운영 DB 적용 상태를 확인한다.
  - [ ] 운영 DB backup 또는 복구 지점을 만들고 일시·담당자·복구 방법을 기록한다.
  - [ ] 0005와 동일한 normalizer를 쓰는 별도 read-only preflight report로 URL 문법 위반,
    normalized collision, title/description/URL 길이 위반의 bookmark ID·이유·충돌 group을 출력한다.
  - [ ] 위반이 있으면 자동 수정하지 말고 backup 뒤 행별 목표값이 승인된 remediation SQL을 transaction으로
    적용한다. 현재 표시 전용 `/admin/cleanup`을 수정 수단으로 간주하지 않는다.
  - [ ] direct DB integration에 필요한 admin test DSN은 local secret로만 주입하고 `.env*`에 실제 값을
    넣지 않는다.
  - **완료 증거:** 0002~0004 검증 PASS, preflight 0건, backup/restore 기록
  - _Requirements: 3.12, 9.5~9.7_

- [ ] 2. URL canonicalization과 bookmark 공통 constraint를 구현한다
  - [ ] `supabase/migrations/0005_discord_link_auto_ingest.sql`에
    versioned `public.normalize_bookmark_url_v1(text)` helper를 `IMMUTABLE STRICT SET search_path=''`로 만든다.
  - [ ] ASCII host/IPv4/localhost, port, percent escape, userinfo·IPv6·raw IDN 거부 문법을 구현한다.
  - [ ] scheme/host case, default port, fragment, tracking query, stable query sort, trailing slash 순서를
    design 고정 corpus로 테스트한다.
  - [ ] `bookmarks.source`, generated `normalized_url`, URL/title/description check constraint와
    normalized unique index를 추가한다.
  - [ ] generated normalizer EXECUTE는 두 function owner·authenticated·service_role에만 주고
    PUBLIC·anon·runtime에서 회수한 뒤 manual mutation·favicon update·seed·ingest 쓰기를 각각 검증한다.
  - [ ] normalizer 규칙 변경은 v2 함수·전체 rewrite·index rebuild migration으로만 가능하고 v1
    `CREATE OR REPLACE`를 금지하는 schema/source test를 추가한다.
  - [ ] migration preflight가 위반 상세를 남긴 뒤 fail-fast하도록 하고 자동 절단·병합은 넣지 않는다.
  - [ ] 기존 관리자 insert/update도 generated unique와 문자열 constraint를 통과하는 integration test를
    추가한다.
  - **완료 증거:** corpus 전부 PASS, seeded `normalize(normalize(x))` property PASS, 동시 insert 중 하나만 성공
  - _Requirements: 2.1, 2.5~2.11, 3.1~3.13_

- [ ] 3. private provenance·receipt·bounded rate 저장소를 구현한다
  - [ ] Data API exposed schema가 아닌 `private` schema를 만들고 기본 권한을 모두 회수한다.
  - [ ] `private.discord_ingest_provenance`를 bookmark FK cascade, private message ID,
    favicon attempt/lease/UUID claim-token column으로 만든다.
  - [ ] `private.discord_ingest_receipts`를 `(message_id, url_key)` PK, terminal result, 90일 expiry로 만든다.
  - [ ] core `pg_catalog.sha256(pg_catalog.convert_to(..., 'UTF8'))`로 URL key를 만들어 extension·추가
    grant 의존성을 만들지 않는다.
  - [ ] `private.discord_ingest_rate_events`를 만들고 함수 경로 밖에서 agent가 접근하지 못하게 한다.
  - [ ] 만료 receipt cleanup function과 일일 Supabase Cron job을 정의하고 job 존재·schedule·run history를
    검증할 수 있게 한다.
  - [ ] cron이 늦어도 expired receipt가 기능상 claim을 막지 않는 integration test를 추가한다.
  - [ ] expired backlog·oldest age를 주기적으로 검사해 24시간 전에 alert하고 수동 cleanup·Cron 조사
    runbook으로 연결한다.
  - **완료 증거:** anon/authenticated/runtime direct access 거부, provenance cascade PASS,
    90일 경계·cleanup PASS
  - _Requirements: 2.2~2.4, 4.1~4.7, 5.2~5.7_

- [ ] 4. DB runtime role과 `ingest_bookmark` transaction을 구현한다
  - [ ] password 없는 `discord_ingest_owner NOLOGIN`, `discord_favicon_owner NOLOGIN`과
    `discord_ingest_runtime LOGIN` 역할을 만들고 role attributes·운영 기본 timeout을 설정한다. role
    timeout을 강제 보안 경계로 설명하지 않는다.
  - [ ] ingest owner에는 ingest/cleanup 최소 grant와 전용 RLS policy만, favicon owner에는 provenance와
    bookmark `favicon_url` update 최소 grant/policy만, runtime에는 category 4-column SELECT와 ingest 함수
    EXECUTE만 준다. owner끼리 권한을 합치거나 참조 table/schema를 소유하지 않고 어느 역할에도
    membership 또는 `BYPASSRLS`를 주지 않으며 `pg_has_role`로 검사한다.
  - [ ] 애플리케이션 함수의 `PUBLIC EXECUTE`와 runtime의 기존 object 권한을 감사·회수하고 default
    privilege가 미래 RPC를 열지 않게 한다.
  - [ ] `p_` prefix를 쓴 5개 text 입력, 9-result code, 한 행 `RETURNS TABLE`의
    `public.ingest_bookmark`를 구현한다.
  - [ ] 함수 진입 시 `clock_timestamp()`를 한 번 캡처하고, 기다리지 않는 global
    `pg_try_advisory_xact_lock`과 함수 `SET lock_timeout` 아래 rate prune/count/current insert/latest-30
    cap을 구현한다. try-lock false는 generic 503 경로로 보낸다.
  - [ ] message ID → URL/key → receipt → category → duplicate → atomic bookmark/provenance 순서를 구현한다.
  - [ ] expected validation은 고정 result code로, constraint-specific URL unique는 `duplicate_url`로,
    나머지 nested exception은 rollback + sanitized `internal_error`로 접는다.
  - [ ] advisory lock 획득 timeout·query cancellation은 result row로 접지 않고 transaction을 실패시켜
    API의 generic 503 경로로 보내며 rate event 비보장을 테스트한다.
  - [ ] title/description trim·fallback·Unicode truncate와 fixed tags/favicon/pin/source/sort 값을 구현한다.
  - [ ] 함수 본문은 `SET search_path=''`, 모든 객체 schema qualification, dynamic SQL 없음으로 만든다.
  - **완료 증거:** 9-result decision table PASS, SQL 원문 비노출, partial write 0건,
    same message/URL concurrent call bookmark 1건
  - _Requirements: 1.1, 1.4~1.12, 2.2~2.12, 4.1~4.7, 5.1~5.8, 6.1~6.8_

- [ ] 5. 실제 DB 검증기와 서명된 ingest API 경계를 완성한다
  - [ ] `scripts/verify-discord-ingest.ts` 또는 동등한 real-Postgres runner를 추가하고 필요한 최소 DB
    client dependency를 명시한다.
  - [ ] runtime DSN을 읽는 유일한 `server-only` adapter에 `listCategories`·`ingest`만 export하고 각각
    parameterized auto-commit statement 한 개, driver query hard deadline, `application_name`을 고정한다.
  - [ ] `POST /api/discord-ingest`에 16 KiB limit, 두 operation field allowlist, ±300초 timestamp,
    raw-body HMAC-SHA-256 constant-time 검증, Node runtime, force-dynamic/no-store, generic 4xx/503 응답과
    body·signature logging 금지를 구현한다.
  - [ ] `Content-Length` 선거부와 16 KiB+1 streaming cancel을 모두 테스트해 무제한 `request.text()`
    allocation이 없게 한다.
  - [ ] ESLint/source scan으로 adapter 밖 DSN env·DB client import, transaction/multi-statement API를 막고
    agent가 DB DSN을 보유하지 않는 secret inventory test를 추가한다.
  - [ ] 루트 `proxy.ts` matcher에서 `/api/discord-ingest`를 제외하고 invalid HMAC 요청 전에 Supabase Auth
    `getUser()`가 호출되지 않는 회귀 테스트를 `lib/supabase/proxy.test.ts`에 추가한다.
  - [ ] `.env.example`에는 server-only `DISCORD_INGEST_DATABASE_URL`, `DISCORD_INGEST_HMAC_SECRET` 이름과
    발급 안내만 추가하고 값이나 `NEXT_PUBLIC_` 노출은 넣지 않는다.
  - [ ] runtime role로 categories 허용과 bookmarks/clicks/private/storage/direct DML 전부 거부를 확인한다.
  - [ ] catalog의 effective table/column/function/view privilege를 whitelist와 비교하고 예상 밖 권한 하나면
    fail-loud한다.
  - [ ] 29/30/31번째 호출, 정확한 600초 경계, blocked call의 window 연장, `retry_at`, ring ≤30을 확인한다.
  - [ ] 오래 열린 별도 transaction에서도 clock이 stale하지 않고 API auto-commit 반환 직후 advisory lock이
    해제되는지 두 connection으로 검증한다.
  - [ ] 두 DB connection으로 same/different message·same normalized URL 경합을 반복 검증한다.
  - [ ] 저장 실패를 주입해 bookmark/provenance/receipt rollback과 rate event 유지 여부를 확인한다.
  - [ ] `scripts/verify-schema.ts`에 0005 적용·ACL·cron 대표 check를 추가하고 `.env.example`의 검증 안내를
    실제 검사 수와 맞춘다. runtime DSN은 Next.js secret store에만, HMAC secret은 agent와 Next.js의
    분리된 secret store에만 둔다고 명시한다.
  - **완료 증거:** schema/ingest verifier와 route/adapter tests 모두 PASS; 임시 fixture cleanup PASS
  - _Requirements: 1~6_

- [ ] 6. 앱 read model과 관리자 mutation을 새 schema에 맞춘다
  - [ ] `lib/types.ts`의 `Bookmark`에 `source` union을 추가하고 모든 typed fixture에 manual/discord를
    의도대로 지정한다.
  - [ ] `lib/queries.ts`의 explicit bookmark column list에 `source`를 추가한다.
  - [ ] `app/admin/page.tsx`의 `AdminLink` mapping에 source만 추가하고 message ID는 client로 보내지 않는다.
  - [ ] `createBookmark`와 `updateBookmark`에 URL 2048, title 120, description 200 검증을 추가한다.
  - [ ] DB parser와 같은 고정 corpus를 공유하는 app URL validator로 userinfo·IPv6·raw Unicode host 등
    DB가 거부하는 문법도 사전에 거부하고, DB URL check 위반은 수정 가능한 사용자 문구로 매핑한다.
  - [ ] DB unique constraint 이름을 구분해 URL 중복을 `NAME_TAKEN`이 아닌 전용 사용자 문구로 반환한다.
  - [ ] patch whitelist에 source/provenance를 넣지 않고 자동 링크 수정 전후 불변을 테스트한다.
  - **완료 증거:** `lib/queries.test.ts`, `lib/mutations.test.ts`, `app/admin/page.test.tsx` 관련 test PASS
  - _Requirements: 2.1~2.8, 3.10~3.13, 7.1~7.5_

- [ ] 7. 관리자 source 표시·필터·제목 편집 UX를 구현한다
  - [ ] `AdminLink`에 source를 추가하고 name cell에 행당 정확히 한 개의 `자동`/`직접` badge를 표시한다.
  - [ ] title 정적 text를 접근 가능한 inline form으로 바꾸고 120자 제한, busy 상태, ref 기반 중복 제출
    방지, 성공 baseline, 실패 draft 보존을 구현한다.
  - [ ] `LinkFilterValue`에 `sourceFilter`를 추가하고 `전체`/`자동만` control을 별도 접근성 group으로 둔다.
  - [ ] `visibleLinks`가 query·sub·source를 AND한 뒤 기존 stable sort를 적용하게 한다.
  - [ ] category 변경 시 query/sub/source는 reset하고 sort는 기존처럼 유지한다.
  - [ ] 0건 안내에 source filter를 포함하고 header 유지·narrow flex-wrap을 회귀 테스트한다.
  - **완료 증거:** `FilterRow.test.tsx`, `LinkTable.test.tsx`, page test와 접근성 query PASS
  - _Requirements: 7.1~7.8_

- [ ] 8. fair claim과 safe favicon collector를 구현한다
  - [ ] 각각 admin JWT email, 빈 search path, 최소권한 owner, PUBLIC/anon revoke를 갖는
    claim/finalize/failure/release RPC를 `discord_favicon_owner` 소유로 0005에 추가한다.
    null·1~10 밖 limit은 claim 없이 거부한다.
  - [ ] source/null favicon/server-side max10, URL-changed 우선, last-attempt fair order,
    `FOR UPDATE SKIP LOCKED`, 120초 lease와 UUID token을 구현한다. claim 순간 attempt 시각·URL을 쓴다.
  - [ ] finalize는 `(bookmark_id, token, claimed_url)`과 현재 source/url/null favicon을 원자적으로 확인하고,
    failure/release도 같은 triple CAS로 stale worker나 URL 수정 뒤 worker가 새 claim을 지우지 못하게 한다.
  - [ ] `lib/discord-favicon-fill.ts` 같은 전용 server action을 만들고 첫 줄에서 관리자 session을 확인한다.
  - [ ] Storage upload·삭제는 URL을 받지 않고 bookmark UUID·claim token·bytes·MIME·AbortSignal만 받는
    `server-only` 전용 boundary로 격리하고 그 파일만
    `eslint.config.mjs`의 admin-client import allowlist에 추가한다. 다른 신규 모듈의 service-role import는
    lint와 guard test로 계속 거부하며 service client의 `.from()`·`.rpc()`도 source/runtime guard로 막는다.
  - [ ] 기존 favicon 수집 core를 분리하되 자동 path는 bookmark origin direct fetch를 절대 호출하지 않고
    fixed provider/Storage allowlist만 쓰게 한다.
  - [ ] local/private/reserved/raw-IDN host와 PSL상 등록 불가 host를 provider 요청 전에 거부하고 allowlist
    밖 redirect를 막는다. provider hostname 전달의 privacy 승인을 rollout gate로 둔다.
  - [ ] 선언·실측 1 MB 상한, PNG/ICO/JPEG/GIF/WebP magic sniff, SVG·불일치 거부를 기존 core와 공유한다.
  - [ ] `discord/<bookmark UUID>/<claim token>` storage key, upload timeout 4초, item 10초, action 진입부터
    전체 50초, concurrency 3, 최대 10개를 구현한다. Auth·모든 RPC·provider·Storage 요청에 남은 예산의
    실제 AbortSignal을 전달하고 필요하면 Supabase client에 deadline-aware custom fetch를 주입한다.
  - [ ] action deadline 6초 전 새 작업을 멈추고 5초 전 in-flight를 abort/settle한 뒤 미완료 claim을
    release하며 finalize·남은 수·응답을 예산 안에 끝낸다.
  - [ ] stale finalize나 update 실패 시 자기 token object를 best-effort 삭제하고, 24시간 지난 미참조
    `discord/` object reconciliation을 추가한다.
  - [ ] `app/admin/page.tsx`의 `maxDuration=60`을 bundled Next 16.3 문서와 배포 환경에서 확인한다.
  - [ ] FilterRow에 실행 button, busy/중복 제출 방지, `채움·실패·남음` toast를 추가한다.
  - [ ] 성공 행 재선택 금지, crash 행 round-robin, A lease expiry 뒤 B 재claim, 중간 URL 수정, stale CAS,
    partial failure, abort 뒤 side effect와 token별 object 경합을 테스트한다.
  - **완료 증거:** network spy에서 bookmark origin 요청 0회, action/component tests PASS,
    배포 preview의 10개 worst-case가 toast 전 504 없이 종료
  - _Requirements: 8.1~8.13_

- [ ] 9. agent handoff와 운영 runbook을 작성한다
  - [ ] `list_categories`와 `ingest` 두 JSON schema, timestamp/raw-body HMAC canonicalization, HTTP/result
    mapping을 agent 설정에 넣고 DB query·DSN은 제공하지 않는다.
  - [ ] URL 최대 5개, string snowflake, fresh leaf categories, 9-result response, retry 정책,
    markdown/mention escape를 고정 checklist로 만든다.
  - [ ] agent web tool이 HMAC secret/signing client process env를 볼 수 없고 DNS result·redirect hop마다
    private/reserved 대역을 막는다는 네트워크 증거를 수집한다.
  - [ ] 격리를 증명할 수 없는 환경의 no-fetch host/empty-description fallback을 설정하고 smoke한다.
  - [ ] Next.js의 direct IPv6 또는 Supavisor pooler DSN 선택, TLS, fixed egress allowlist, DB/HMAC 분리
    secret store와 각각의 rotation 절차를 문서화한다.
  - [ ] 감시 process 중지 → `NOLOGIN + pg_terminate_backend` kill switch 순서를
    copy/paste 가능한 runbook으로 만들되 실제 secret 값은 포함하지 않는다.
  - [ ] receipt expired oldest-age alert와 수동 cleanup/Cron 조사, Storage orphan reconciliation runbook의
    담당자와 실행 주기를 정한다.
  - **완료 증거:** staging channel에서 9-result fixture, no-mention, no-raw-error, kill-switch smoke 기록
  - _Requirements: 1.2~1.3, 1.7~1.8, 6.8, 9.1~9.7, 에이전트 지침_

- [ ] 10. 단계적 rollout과 24시간 canary를 완료한다
  - [ ] DB backup → 보강된 0002~0004 검증 → preflight 0 → 관리자 쓰기 일시 중지 → 0005 적용 →
    DB verifier 순서를 실행한다.
  - [ ] DB password·server DSN·server-side HMAC secret을 분리 발급하고 runtime ACL·connection limit·network
    restriction을 재검증한 뒤 agent에 HMAC secret을 아직 전달하지 않은 상태로 앱을 배포한다.
  - [ ] manual bookmark 생성·수정·공개 read·통계·cleanup과 URL 오류 문구를 smoke한 뒤 관리자 쓰기를
    재개한다.
  - [ ] 한 staging channel에서 no-fetch canary 후, network gate가 있으면 metadata mode canary를 실행한다.
  - [ ] 정식 활성화 전에 관리자 쓰기를 잠시 멈추고 previous app rollback → read smoke → forward restore를
    실제 수행해 deployment ID·시각·결과를 기록한다.
  - [ ] 정식 활성화 전에 agent stop → role NOLOGIN → session terminate → 복구의 kill-switch
    drill도 이상 유무와 무관하게 실제 수행한다.
  - [ ] 자동 favicon을 켜기 전에 provider hostname 전달 privacy review를 승인하거나 버튼을 비활성화한다.
  - [ ] production 감시 channel을 한 곳만 guarded activation하고 즉시 중지할 담당자를 지정한다.
  - [ ] 첫 24시간 자동 행, receipt outcome, expired oldest age, rate ring, DB session, favicon/orphan backlog를
    전수/집계 검토한다.
  - [ ] 이상 시 agent stop → role NOLOGIN → session terminate → app rollback을 수행하고
    schema/data는 보존한다.
  - [ ] 이상이 없으면 guarded activation을 정식 승인하고 출시 기록에 verifier 결과를 첨부한다.
  - **완료 증거:** canary 기록, 24시간 review, rollback drill, 최종 승인
  - _Requirements: 1~9_

## 최종 Definition of Done

- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npx tsx scripts/verify-schema.ts`
- [ ] 신규 real-DB ingest verifier
- [ ] 0005 migration preflight·apply·cron 확인
- [ ] runtime effective privilege·role membership whitelist 100% 일치
- [ ] network isolation 또는 no-fetch fallback 증거
- [ ] kill-switch/rollback drill
- [ ] 관련 파일만 stage한 conventional commit
