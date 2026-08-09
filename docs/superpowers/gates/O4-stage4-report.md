# O4 게이트 — 4단계(통계·정리) 검수 보고서

**대상**: `feat/stage-1-public` @ `1f10296` · 감사 방식(야간 무정지 완주 승인 — 기록 감사) · 2026-08-10 새벽
**종합**: **코드 게이트 통과** (6/6). SQL 계층은 라이브 DDL 미적용이라 부분 DEFER — 아침 마이그레이션 후 확정.

## 체크리스트 6항목

| # | 항목 | 판정 | 근거 |
|---|---|---|---|
| ① | 순위 unique 기준 + 안내문 | ✅ 통과 | admin_stats_top_links가 `order by unique_visitors desc`, StatsView 막대 폭=unique(총클릭 아님), 안내문 "순위는 고유 방문자 수 기준" 노출. 테스트 잠금 |
| ② | 기간 탭·막대 gap 규칙 | ✅ 통과 | 14/30/90/180/365, gap ≤30:5·≤90:2·else:1, 라벨 ≤30만. daily(365).slice(-N)=daily(N) 등식(order by day 오름차순) 검증 |
| ③ | rate limit + bulk 유실 없음(V5) | ✅ 통과 | 31번째 rate-limit·DB 미접촉, bulk 118건 insert 118회(창당 1유닛). 라이브 한계(인스턴스별 근사·XFF Vercel 신뢰) 문서화 |
| ④ | 방치 판정 경계(신규 제외) | ✅ 코드·SQL 리뷰 / **DEFER 라이브** | WHERE 3절(is_pinned false·created_at≤now-N·최근 N일 클릭 0, bulk 포함). 0004 미적용이라 경계 rpc 실측은 아침. 현 SQL 계약 테스트는 텍스트 정규식만 |
| ⑤ | 고정 링크 방치 제외 | ✅ 코드·SQL / DEFER 라이브 | `is_pinned=false`, 테스트 강제. 리뷰-M1 "고정 11행 유출 0"은 개발 중 실측 |
| ⑥ | 통계·정리 <820px 1단 | ✅ 통과 | KPI grid-cols-1→3, 하단 1.4fr/1fr, cleanup grid-cols-1→2. 테스트 잠금 |

전체 스위트 1559 통과, tsc·eslint(4단계 소스) 청정.

## 미인증 누출 0 · SQL 삼중 방어
- 미인증 /admin/stats·/admin/cleanup: 디렉터리 스캔 테스트가 Page() null 반환·textContent 공백 실측. StatsView 타입만 import(server-only 값 미유출), CleanupView 서버 컴포넌트. 공개 화면엔 통계·정리 접점 0(공개는 bookmark_click_counts 합계 뷰만).
- SQL 삼중 방어: grant(authenticated만·anon revoke) + definer 이메일 가드(coalesce로 null→42501) + 앱 getAdminSession. visitor_hash 원본 미반환. 하드닝: search_path=public,pg_temp / CYCLE 절 / days·retention SQL 이중화.
- 수용(비차단): 미인증 title 노출(탭 이름 수준·본문 게이트·robots noindex).

## 아침 사용자 필수 (라이브 DDL 미적용 — 코드로 확인된 적용 전 FAIL/적용 후 PASS 경로)
1. **마이그레이션 3종 SQL Editor 전체 실행**: 0002_admin_write_policy · 0003_stats · 0004_cleanup (전부 create or replace 멱등)
2. **signup 차단**: 대시보드 Authentication → "Allow new users to sign up" 끄기 + 익명 로그인 끄기 (verify-schema ⑦)
3. **verify-schema 10종 PASS**: `npx tsx scripts/verify-schema.ts` — ⑧⑨⑩(0002·0003·0004 적용 감지)이 지금은 의도된 FAIL, 적용 후 PASS. 스키마 캐시 미갱신 시 `notify pgrst,'reload schema';`
4. **rpc 스팟체크(적용 후·관리자 세션)**: KST 경계(오늘 클릭)·익명 42501 거부·방치 경계(등록 직후 제외/N일 경과 포함)·고정 제외

미적용 상태 우아한 실패 확인: 통계는 안내 카드, 정리는 ①②(공개 순수 함수) 렌더+③만 안내.

## O4 백로그 (전부 비차단)
- K2: 추이 막대 sr-only/aria, 0003 적용 후 catch를 error.code로 좁히기, cssUrl 4번째 사본→lib/favicon 승격, 순위행 고유 방문자 tooltip
- L1: TOCTOU 정공법(시간버킷+on conflict 또는 단일 RPC — naive 유니크 무효), 정밀 전역 상한 Redis
- M1: cleanup_abandoned 통합 테스트(경계행 시드 — 현 SQL 계약은 텍스트 정규식만)
- M2: 0004 미적용 시 bookmarks 2회 read(열화 경로 한정)

## 종합 판정
**코드 게이트 통과.** 시스템 보안 전제(아침 마이그레이션 3종+signup+verify 10종+rpc 스팟체크) 미충족 상태 — 그 전까지 SQL 부분(④⑤·①③)은 "코드·정밀 리뷰 통과, 라이브 실측 대기(DEFER)". O3의 아침 필수 2건이 O4에서 마이그레이션 3종으로 확장됨.
