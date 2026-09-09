# 바이브코딩 분류 정리와 저장 전 사이트 확인

상태: **운영 DB·API·봇 반영 완료**. 2026-09-10 사용자 요청에 따른 현재 분류 기준이다.
앞선 classification-review-2026-09-10.md의 Jiro 최상위 분류 제안은 이 문서로 대체한다.

## 정보 구조와 이동

`바이브코딩`은 첫 번째 최상위 항목으로 유지하고 아래 세 하위 분류를 둔다.

| 하위 분류 | 용도 | 이동 후 링크 수 |
| --- | --- | --- |
| 도구모음 | GitHub 저장소·저장소 모음 | 12 |
| 디자인 | UI 디자인 도구, 컴포넌트, 템플릿, 디자인 프롬프트 | 13 |
| 코딩/에이전트 | 코딩 에디터, 앱 빌더, 코딩 에이전트 | 19 |

- 기존 `AI 도구 모음 > 오픈소스·자료 모음`을 같은 ID로 `바이브코딩 > 도구모음`으로 이동·이름 변경한다.
  기존 3개와 바이브코딩 최상위에 직접 있던 GitHub 저장소 9개를 합친다.
- 기존 `AI 도구 모음 > 디자인`, `코딩·에이전트`도 같은 ID로 새 부모 아래 이동한다.
  후자는 사용자 요청대로 `코딩/에이전트`로 표시한다.
- Jiro, 21st.dev, v0 템플릿 갤러리는 `바이브코딩 > 디자인`에 둔다.
- GitHub 저장소인 디자인 자료는 도구모음, 서비스형 디자인 자료는 디자인으로 구분한다.
  일반 영감·쇼케이스 사이트는 기존 디자인 레퍼런스에 둔다.

0016 마이그레이션은 원본 ID·URL·개수·부모 분류를 확인한 뒤 한 트랜잭션에서 적용한다.
예상 밖 데이터이면 전부 거부하며 완료 형태 재실행은 쓰기를 하지 않는다. 북마크·카테고리 ID,
제목·설명·URL·source·즐겨찾기·favicon·클릭 기록을 보존한다. 수정된 북마크의 updated_at은 기존 트리거가 갱신한다.

## 분류 문제 해결 방식

기존 흐름은 도메인 이름만으로 저장한 뒤 사이트 정보를 읽어서, 분류에 그 정보를 사용할 수 없었다.
새 흐름은 **카테고리 조회 → 사이트 정보 확인 → 분류 선택 → 저장**이다.

- `favorite_inspect_url`이 HMAC 인증된 `inspect_url` API를 호출한다. 쓰기 없이 제목·설명만 반환한다.
- 기존 서버 수집기의 SSRF 검사, DNS/IP pinning, redirect 검증, 200 KB 제한, 6초 제한을 재사용한다.
  범용 브라우저 권한을 열지 않고 HTML 본문·스크립트·쿠키를 모델에 전달하지 않는다.
- 봇은 새로운 도메인도 메타데이터와 전체 분류 경로를 보고 판단한다. 카테고리는 DB에서 leaf 여부를 최종 검증한다.
- 사이트를 읽지 못해도 명시적 사용자 설명으로 판단할 수 있으면 저장한다. 근거가 없으면
  `분류 대기`에 보존하고 관리자 확인이 필요하다고 안내한다. 대기는 자동 작업 중이라는 뜻이 아니다.
- `분류 대기` 이유 질문에는 고정된 설명을 제공한다. 저장된 행을 조회하지 않고 개별 실패 원인을 꾸며내지 않는다.
- URL 재전송은 기존 중복 방지 계약을 유지한다. 후처리는 기존처럼 누락 메타데이터·favicon만 보완한다.

앞선 검토의 비동기 재분류 큐 대신 저장 전에 필요한 정보를 확보해 이번 원인을 해결한다.
비동기 분류 상태·재시도 큐는 추가하지 않는다. 접근 차단·불명확한 사이트까지 무조건 자동 분류한다고 보장하지 않는다.

## 검증 및 운영 절차

- `npm test`: Node 24에서 86파일·1,970개 테스트 통과.
- `npm run typecheck`, `npm run lint`: 통과.
- `node scripts/test-vibe-coding-migration.mjs <snapshot.json>`: 로컬 Supabase PostgreSQL 17의
  일회용 DB에 운영 공개 데이터 스냅샷을 복원한다. 최초 적용·재실행·필드 보존과 잘못된 원본 8종의
  전체 rollback을 검증하고 테스트 DB를 제거한다. 원격 DB 접속 인자를 받지 않는다.
- 운영 전 백업: `/Users/itconnect/.local/share/favorite-backups/classification-2026-09-10/before.json`.
  저장소 밖 제한된 권한의 파일이며 categories/bookmarks와 클릭 합계만 포함한다.
- 운영 마이그레이션은 `supabase db push --linked --yes`, 이력은 `supabase migration list --linked`로 확인한다.
- 배포는 검증된 커밋만 포함하는 별도 작업 디렉터리에서 수행하고 `npm run verify:deploy -- <sha>`로 확인한다.
- 배포 후 `scripts/verify-discord-classification.ts <현재 모델>`로 서명된 조회·Jiro 실제 메타데이터와
  실제 모델의 디자인 선택, GitHub 우선순위, 정보 부족 보류를 확인한다. 이 검증은 저장이나 Discord 전송을 하지 않는다.
- 운영 Hermes는 채널 프롬프트만 갱신하며 다른 설정은 보존한다. 재시작 후 3개 MCP 도구 등록과
  Discord 연결을 확인한다. 별도 작업 중인 FIFO 플러그인 변경은 이번 커밋에 포함하지 않는다.

직접 Discord에 새 메시지를 전송하는 검증은 별도이며 이 작업에서 대신 전송하지 않는다.

## 운영 검증 결과 (2026-09-10 07:58 KST)

- 운영 마이그레이션 `0001`–`0016`이 로컬과 일치한다. 전후 모두 카테고리 60개, 북마크 488개,
  클릭 129건이다. 전체 북마크의 ID·제목·설명·URL·source·즐겨찾기·favicon 등 보존 필드를 비교해 일치했다.
- 도구모음 12개, 디자인 13개, 코딩/에이전트 19개를 운영 DB에서 확인했다. Jiro의 실제 category_id는
  디자인의 기존 ID `357c9ec8-1f7e-4072-a578-28e7007e523e`다.
- 배포 코드: `c8c372418ec42aa4789fa9b971884e3b99ad61e8`.
  운영 배포: `dpl_CfFYMq7QVYeuc9fwmz7zmNtkPrQv`.
- `npm run verify:deploy -- c8c372418ec42aa4789fa9b971884e3b99ad61e8` 통과.
  첫 CLI 배포에는 Git SHA 환경값이 없어 버전 검사가 실패했다. 격리된 커밋의 동일 소스를
  정확한 SHA 환경값·배포 메타데이터와 함께 재배포해 수정했다. 원격 빌드의 `npm run build`도 통과했다.
- `node --env-file=/Users/itconnect/.hermes/profiles/favorite/.env --import tsx scripts/verify-discord-classification.ts gemini-3.8-flash` 통과.
  운영 API의 Jiro 메타데이터와 현재 운영 모델을 사용해 디자인 선택을 확인했다. GitHub fixture의
  도구모음 선택과 정보 없는 fixture의 보류도 통과했다. 실제 gateway 도구 호출 전체를 재현한 검증은 아니다.
- `favorite mcp test favorite-ingest`: 도구 3개 연결·발견 성공.
- `favorite gateway restart`, `favorite gateway status`: 재시작 후 PID 62458 및 watchdog/MCP 자식 확인.
  07:55:42에 `favorite_list_categories`, `favorite_inspect_url`, `favorite_ingest` 등록,
  07:55:46에 Discord 연결 성공을 현재 프로세스 로그에서 확인했다. 다른 프로필은 재시작하지 않았다.
  CLI의 기존 service definition stale 경고는 남아 있으나 이번 프로세스 시작·연결은 확인됐다.
- 설정 변경은 해당 채널의 prompt scalar 하나이며, 그 외 파싱된 설정이 같음을 검사했다.
  운영 프롬프트가 커밋된 파일과 정확히 일치한다.
- 무서명 `inspect_url` 요청은 HTTP 401, 서명된 loopback URL은 `unavailable`이었다.
- 운영 바이브코딩 페이지 GET은 HTTP 200이고 하위 분류 3개와 Jiro를 응답에서 확인했다.
- 브라우저 검증: CUA에 연결된 browser provider가 없고 Chrome native 접근도 타임아웃이어서
  실제 화면·모바일·관리자 조작 검증은 완료하지 못했다. 서버 HTML 조회와 구분한다.

새 Discord 메시지 전송, 접근 차단 사이트의 자동 재분류, 별도 FIFO 작업의 검증·배포는 수행하지 않았다.
Gemini 검증 스크립트의 API 형식은 [공식 함수 호출 문서](https://ai.google.dev/gemini-api/docs/generate-content/function-calling)와 기존 Gemini 요청 코드를 참고했다.

## 후속 수정: 한국어 설명 (2026-09-10 08:13 KST)

기존 Jiro 행을 이동할 때 영문 설명을 보존한 누락을 수정했다. `0017_localize_jiro_description.sql`은
정확한 ID·URL·source·기존 설명을 확인한 뒤 설명만 한국어로 바꾼다. 다른 북마크 필드는 보존했다.
봇의 6단계 규칙도 한국어 요약을 허용하는 수준에서 **비어 있지 않은 한국어 설명 필수**로 변경했다.
자료를 읽지 못하면 한국어 확인 필요 문구를 사용한다. 이는 봇 출력 규칙이며 DB 언어 제약은 아니다.

- Ran: `npm run typecheck`, `npx eslint scripts/verify-discord-classification.ts`, `supabase db push --linked --dry-run`, `supabase db push --linked --yes`.
- Ran: `node --env-file=/Users/itconnect/.hermes/profiles/favorite/.env --import tsx scripts/verify-discord-classification.ts gemini-3.8-flash`, `favorite gateway restart`, `favorite gateway status`.
- Passed: Jiro 실제 메타데이터·GitHub fixture·정보 없는 fixture 모두 올바른 분류 및 한국어 설명 생성.
  운영 DB에서 설명 외 필드 보존, 운영 페이지 응답에서 한국어 문구 확인. 운영 프롬프트 일치 및
  PID 97713의 3개 도구 등록·08:12:40 Discord 연결 확인.
- Failed: 미해결 검증 실패 없음. 기존 launchd service definition stale 경고는 이번 변경 범위 밖이다.
- Not Run: 새 Discord 메시지 전송, 전체 테스트·웹앱 재배포(서버·화면 코드 변경 없음).
