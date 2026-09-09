# jiro.build 분류 대기 원인 검토

검토일: 2026-09-10 (Asia/Seoul). 범위: 실제 수신 기록, 공개 운영 데이터, 분류·저장·후처리 코드 검토.
이번 변경은 검토 문서만 추가한다. 운영 데이터 수정, 봇 설정 변경, 배포는 수행하지 않았다.

## 결론

이번 건은 저장 실패나 메타데이터 수집 실패가 아니다. 정보가 부족한 URL을 보존하는 fallback은
설계대로 작동했다. 그러나 **수집된 사이트 정보를 이용한 후속 분류가 구현되어 있지 않아**
자동 분류에 필요한 정보가 나중에 생겨도 계속 `분류 대기`에 남는다. 자동 분류 완결성과
사용자 안내를 개선해야 한다. 모델 교체나 서버 재시작이 이 원인을 해결하지는 않는다.

## 실제 확인한 흐름

Hermes Favorite의 로컬 `state.db`를 SQLite `mode=ro`로 조회했다. 원문 전체나 모델 내부
데이터는 이 문서에 보관하지 않는다. 해당 턴의 사용자 입력·도구 입출력·최종 답변만 근거로 삼았다.

| 시각 (KST) | 확인 내용 |
| --- | --- |
| 09-10 07:27:40 | 사용자가 `https://jiro.build/`만 전송했다. 설명은 없었다. |
| 07:27:49 | 봇이 `favorite_list_categories`를 호출했다. 응답에 `바이브코딩`과 `분류 대기`가 있었다. |
| 07:28:05 | `title=jiro.build`, `description=""`, `categoryId=9355bb1f-7fba-40d6-bf8a-9301a0a7f387`로 저장 요청했다. |
| 07:28:06 | API가 `resultCode=success`, `categoryName=분류 대기`를 반환했다. |
| 07:28:11 | 봇이 `저장 완료: jiro.build (분류 대기)`라고 답했다. |
| 07:29:30 이후 | 사용자의 `분류 대기를 한 이유는?`에 봇이 `NO_REPLY`를 반환했다. |

[운영 홈페이지](https://favorite.itconnect.dev)의 서버 응답에 포함된 카테고리·북마크 데이터를
직접 읽었다. 조회 당시 카테고리는 60개, 북마크는 488개였고 `분류 대기`는 Jiro 1건이었다.
이는 현재 누적 현황이며 분류 정확도나 과거 대기 발생률을 뜻하지 않는다.

- 북마크 ID: `556fd17c-8427-4529-96f0-8b3d9203dcd1`
- 저장 시각: `2026-09-09T22:28:05.951773+00:00` = 09-10 07:28:05 KST
- source: `discord`, URL: `https://jiro.build/`, 분류: `분류 대기`
- 현재 제목: `Jiro — The Design Prompt Library to Vibe Code Better Websites`
- 현재 설명: 디자인을 보고 프롬프트를 복사해 바이브코딩 도구로 제작하는 서비스라는 영문 설명
- favicon: 해당 bookmark ID 아래 Supabase Storage URL이 저장되어 있음

초기 도구 입력과 현재 공개 데이터의 차이는 제목·설명·favicon 보정이 수행되었음을 보여준다.
favicon 이미지의 실제 다운로드·렌더링과 Vercel 후처리 로그는 별도로 검사하지 않았다.

[운영 버전](https://favorite.itconnect.dev/api/version)은
`4d2540404d040ec732f1043faad6411a5d2fa9d3`이었다. 로컬 HEAD `92b907f`와 다르지만,
아래 검토 대상 분류 프롬프트·MCP·API·메타데이터 worker·0009 SQL 파일은 두 커밋 간 차이가 없었다.
운영 DB 함수 본문·ACL을 직접 조회한 검증은 아니다.

## 발견 사항

### 1. 높은 우선순위: 메타데이터 수집과 분류 판단이 연결되어 있지 않다

- `integrations/hermes/favorite-channel-prompt.md` 2·4·6단계는 URL 직접 열기를 금지하고,
  메시지와 hostname만으로 leaf를 고르게 한다. 근거가 부족하면 `분류 대기`를 선택한다.
- `scripts/discord-favorite-mcp.ts`의 카테고리 도구 설명에도 같은 규칙이 있다.
- `app/api/discord-ingest/route.ts`는 전달받은 `categoryId`로 먼저 저장한 뒤 성공 건에만
  `after()`로 후처리를 실행한다.
- `lib/discord-ingest-enrichment.ts`는 제목·설명과 favicon을 보정하지만 분류를 판단하지 않는다.
- `supabase/migrations/0009_automate_discord_enrichment.sql`의 metadata RPC는
  `title`, `description`만 갱신한다. `category_id` 갱신은 없다.

따라서 `분류 대기`는 실제 실행 중인 분류 작업 상태가 아니라 카테고리 이름이다.
현재 경로에는 대기 건을 자동으로 재분류하는 소비자가 없다. 이번처럼 사이트의 의미가
제목·설명에 분명하게 드러나도 최초 판단을 보완하지 못한다.

### 2. 중간 우선순위: 사용자가 대기 이유와 다음 행동을 알 수 없다

현재 답변은 저장 성공과 분류 완료를 충분히 구분하지 않는다. 실제 후속 질문도 URL 없는
메시지를 무조건 `NO_REPLY`로 처리하는 프롬프트와 일치하는 결과였다.

우선 대기 건의 성공 답변에 `사이트 종류를 판단할 정보가 부족해 분류를 보류했습니다`와
관리자 분류 변경 경로를 안내해야 한다. 자동 재분류를 구현하기 전에는 `곧 자동 분류됩니다`라고
안내해서는 안 된다. 이후 필요하면 마지막 저장 건의 상태·이유를 조회하는 제한된 질문만
지원한다. 일반 대화 기능 전체를 여는 것은 이 문제 해결에 필요하지 않다.

### 3. 중간 우선순위: URL 재전송은 분류 수정 수단이 아니다

`supabase/migrations/0006_discord_link_auto_ingest.sql`은 이미 존재하는 `normalized_url`이면
`duplicate_url`과 기존 제목·분류를 반환한다. 새 설명이나 categoryId로 기존 행을 변경하지 않는다.
API도 `success`에만 후처리를 등록한다. 따라서 설명을 붙여 URL을 다시 보내거나 기다리는 것만으로
이 건을 바로잡을 수 없다. 중복 방지 계약은 유지하고 별도 재분류 경로를 제공해야 한다.

## Jiro에 적합한 분류

[Jiro 공식 홈페이지](https://jiro.build/)는 디자인과 구현용 프롬프트를 골라 바이브코딩 도구에
붙여 넣는 사용 흐름을 설명한다. 사이트 내용과 현재 카테고리를 대조한 **권장 분류는 `바이브코딩`**이다.
조회 당시 이 카테고리는 최상위 leaf이며 ID는 `9a5325d2-f82f-4687-b4c3-887fb4feb7fa`다.

기존 `.kiro/specs/vibe-coding-github-repositories/plan.md`는 GitHub 저장소 등록을 중심으로
작성되어 있다. 서비스형 디자인 프롬프트도 `바이브코딩`에 포함한다는 기준을 명시하면
`디자인 레퍼런스`나 `프롬프트·디렉터리`와의 중복 판단을 줄일 수 있다. 분류 기준은 도메인
이름이나 호스팅 장소보다 사용 목적을 우선한다. 이번 검토에서는 실제 분류를 변경하지 않았다.

## 권장 개선 순서

1. **즉시 안내 개선**: 대기 이유와 수동 처리 방법을 저장 응답에 명시한다.
2. **서버에서 후속 분류**: 안전한 메타데이터 수집 결과와 최신 leaf 목록을 분류기에 전달한다.
   충분한 근거가 있을 때만 분류를 적용하고, 모호하거나 수집에 실패하면 검토 대상으로 남긴다.
   Discord 에이전트에 범용 브라우저·셸 권한을 추가할 필요는 없다.
3. **분류 상태와 재처리**: 작업 상태, 보류/실패 이유, 시도 횟수, 마지막 처리 시각, 판단 근거와
   분류기 버전을 기록한다. 실제 작업 중과 사람의 확인이 필요한 상태를 구분한다.
   제한된 재시도와 수동 재분류를 지원한다. 현재의 best-effort `after()`만으로 재시도를 보장하지 말고
   저장과 함께 작업을 영속화하고 누락 작업을 다시 처리할 수 있게 한다.
4. **분류 기준과 관측**: 인접 카테고리의 포함·제외 기준 및 대표 예시를 분류 입력에 제공한다.
   URL만 있는 입력의 완료율, 보류율, 메타데이터 실패율, 사람의 분류 수정률, 처리 시간을 측정한다.

후속 구현 시에는 producer(API/worker/DB)와 consumer(MCP 응답/Discord 안내/관리 UI)를 함께 변경한다.
분류 적용은 exact bookmark ID·URL·기대 category·수정 버전을 확인하고, 사람이 수정한 행은 건너뛴다.
대상 leaf가 삭제되거나 상위 카테고리로 바뀌면 적용을 거부한다. ID·source·즐겨찾기·클릭·favicon은
보존하고 필요한 category 및 순서만 변경한다. 페이지 문자열은 판단용 데이터로만 취급한다.

수용 검증에는 Jiro처럼 URL만 있는 입력, 충분한 설명이 있는 입력, 수집 실패, 모호한 분류,
삭제된 leaf, 중복 URL, 재시도 중복 실행, 사람의 동시 수정을 포함한다. fixture 검증과 신규 Discord
메시지를 통한 운영 검증은 구분해 보고한다.

## 검증

- Ran: `npm test -- lib/discord-ingest-enrichment.test.ts lib/discord-link-metadata.test.ts app/api/discord-ingest/route.test.ts scripts/discord-favorite-mcp-client.test.ts`
- Passed: Node `v26.7.0`, 4개 파일·35개 테스트 통과. 해당 파일들은 node 테스트 환경이다.
  현재 저장·메타데이터·API 계약 검증이며, 미구현된 자동 재분류의 정확도를 입증하지 않는다.
- Ran: `git diff 4d2540404d040ec732f1043faad6411a5d2fa9d3 HEAD -- app/api/discord-ingest/route.ts lib/discord-ingest-enrichment.ts lib/discord-link-metadata.ts scripts/discord-favorite-mcp.ts integrations/hermes/favorite-channel-prompt.md supabase/migrations/0009_automate_discord_enrichment.sql`
- Passed: 검토한 운영 버전과 로컬 구현에 차이 없음.
- Ran: 공개 홈페이지/API GET, Jiro 공식 홈페이지 열람, Hermes 해당 메시지 SQLite 읽기 전용 조회.
- Passed: 해당 URL의 수신·카테고리 조회·저장 성공·현재 보정 데이터·후속 무응답을 대조함.
- Failed: 최초 `.env.local` 기반 Supabase 조회는 공개 URL 값 누락으로 `supabaseUrl is required` 발생.
  공개 운영 홈페이지의 서버 데이터 조회로 필요한 북마크·카테고리를 확인했다. 운영 장애 증거가 아니다.
- Not Run: 운영 DB 직접 SQL/마이그레이션/변경, 실제 신규 Discord 전송, Vercel 후처리 로그,
  관리자 브라우저 조작, 구현·배포, 전체 lint/typecheck/build. 이번 산출물은 검토 문서다.
