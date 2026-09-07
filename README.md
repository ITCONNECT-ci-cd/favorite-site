# 내 링크

사내 구성원이 자주 쓰는 링크를 한곳에서 찾는 대시보드.

## 스택

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS v4 · Vitest · Supabase · Vercel

## 개발

```bash
npm run dev        # 개발 서버 (http://localhost:3000)
npm test           # 단위 테스트 (Vitest)
npm run typecheck  # 타입 검사 (tsc --noEmit)
npm run lint       # ESLint
npm run build      # 프로덕션 빌드
```

## Docker의 favorite 시작 오류 복구

Docker Desktop의 `favorite` 그룹은 Supabase CLI가 만든 **로컬 개발용 Supabase**다.
[공개 Favorite 웹사이트](https://favorite.itconnect.dev)는 Vercel 배포이며, 이 그룹에는
Next.js 웹 서버가 없다. Supabase CLI의 Docker 구성은
[공식 로컬 개발 문서](https://supabase.com/docs/guides/local-development/cli/getting-started)를 참고한다.

2026-09-07 확인: Desktop의 그룹 시작 버튼은 `docker compose --project-name favorite start`를
실행했다. 컨테이너에는 Supabase 프로젝트 라벨과 Compose 프로젝트 라벨만 있고 Compose 서비스
메타데이터가 없어 `no container found for project "favorite": not found`로 실패했다.
기존 컨테이너는 `docker start`로 정상 시작할 수 있었다.

이 저장소에서 기존 8개 컨테이너를 다시 실행하려면 다음 명령을 사용한다.

```bash
npm run docker:start
```

각 컨테이너가 `favorite` 소속인지 먼저 확인하고, DB의 건강 상태가 정상일 때 나머지 서비스를
시작한다. 기존 이미지·볼륨을 재사용하고 이미 실행 중인 컨테이너도 그대로 유지한다.
컨테이너 누락, 소속 불일치, 시작 실패, 준비 시간 초과는 실패 코드로 끝난다.
Docker Desktop에서는 그룹을 펼쳐 개별 컨테이너 상태를 확인할 수 있다.
이 명령은 DB 초기화·시드·스키마 마이그레이션·권한 변경을 실행하지 않는다.

```bash
docker ps -a --filter label=com.supabase.cli.project=favorite
docker exec supabase_db_favorite pg_isready -U postgres -d postgres
curl --fail --silent --show-error http://127.0.0.1:54321/auth/v1/health
```

REST 컨테이너에는 Docker healthcheck가 없으므로 `running`으로 확인하고, 나머지 7개는
`healthy`를 확인한다. 위 시작 검사는 DB/API 기동 검사다. 애플리케이션의 조회 권한, 최신
스키마, 관리자 로그인까지 보장하지는 않는다.

같은 날 로컬 Data API에서 `42501: permission denied for table`도 확인했다.
`0001_init.sql`의 공개 읽기 정책과 `lib/queries.ts`의 익명 조회 계약을 대조해,
**로컬 컨테이너 DB에만** `categories`·`bookmarks`의 `SELECT`를 `anon`, `authenticated`에
복구했다. RLS, 익명 쓰기 거부, 클릭 원본 비공개, 저장된 데이터는 보존했다.
공개 사이트의 클라우드 DB에는 이 복구 SQL을 적용하지 않았다.

복구 당시 로컬 DB는 마이그레이션 `0001`–`0007`, 북마크·분류 각각 0건인 개발용 상태였다.
현재 웹 앱을 로컬로 연결하려면 별도로 스키마와 개발 데이터를 준비해야 한다.
컨테이너 시작 오류를 고치려고 `db reset`, `stop --no-backup`, 볼륨 삭제를 실행하지 않는다.

## 문서

- 구현 계획: `docs/superpowers/plans/2026-08-09-link-dashboard-full-plan.md`
- `docs/`는 디자인 핸드오프 번들(읽기 전용)입니다 — PRD, DESIGN_SPEC, 프로토타입, 스크린샷, 시드 데이터가 들어 있습니다. 코드에서 참조만 하고 수정하지 않습니다.

디자인 토큰·타이포그래피의 원본은 `docs/DESIGN_SPEC.md` 1장이며, 코드에서는 `app/globals.css`의 `@theme`이 이를 그대로 옮긴 것입니다. 제품은 **라이트 모드 전용**입니다.
