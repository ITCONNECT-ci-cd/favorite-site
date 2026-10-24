-- 0025_add_firebase_operating_sites.sql
-- Add 18 live Firebase web apps to the '현재 운영 중인 사이트' category.

begin;

lock table public.categories in share mode;
lock table public.bookmarks in share row exclusive mode;

do $migration$
declare
  v_category_id constant uuid := '961f597a-31ec-4640-bf08-7b93b122d6e7';
  v_category_count integer;
  v_last_order integer;
begin
  select count(*) into v_category_count
    from public.categories
   where id = v_category_id and parent_id is null and name = '현재 운영 중인 사이트';

  if v_category_count <> 1 then
    raise exception 'Operating-sites category identity not found';
  end if;

  select coalesce(max(sort_order), -1) into v_last_order
    from public.bookmarks;

  -- 1. Claude 개발팀 오피스
  if not exists (select 1 from public.bookmarks where normalized_url = public.normalize_bookmark_url_v1('https://itconnect-claude-devteam.web.app/')) then
    v_last_order := v_last_order + 1;
    insert into public.bookmarks (category_id, title, url, description, tags, favicon_url, is_pinned, sort_order, source)
    values (v_category_id, 'Claude 개발팀 오피스', 'https://itconnect-claude-devteam.web.app/', 'Claude 개발팀 9인 가상 픽셀 오피스 실시간 대시보드', '{}'::text[], null, false, v_last_order, 'manual');
  end if;

  -- 2. Grok Bot 픽셀 오피스
  if not exists (select 1 from public.bookmarks where normalized_url = public.normalize_bookmark_url_v1('https://itconnect-pixel-office.web.app/')) then
    v_last_order := v_last_order + 1;
    insert into public.bookmarks (category_id, title, url, description, tags, favicon_url, is_pinned, sort_order, source)
    values (v_category_id, 'Grok Bot 픽셀 오피스', 'https://itconnect-pixel-office.web.app/', 'Grok Bot 및 에이전트 픽셀 오피스 가상 공간', '{}'::text[], null, false, v_last_order, 'manual');
  end if;

  -- 3. AI 서비스 쇼케이스
  if not exists (select 1 from public.bookmarks where normalized_url = public.normalize_bookmark_url_v1('https://project-show-e981d.web.app/')) then
    v_last_order := v_last_order + 1;
    insert into public.bookmarks (category_id, title, url, description, tags, favicon_url, is_pinned, sort_order, source)
    values (v_category_id, 'AI 서비스 쇼케이스', 'https://project-show-e981d.web.app/', '아이티커넥트 자체 개발 AI 서비스 14종 통합 쇼케이스', '{}'::text[], null, false, v_last_order, 'manual');
  end if;

  -- 4. AX 아틀리에 오피스
  if not exists (select 1 from public.bookmarks where normalized_url = public.normalize_bookmark_url_v1('https://ai-bot-dots.web.app/')) then
    v_last_order := v_last_order + 1;
    insert into public.bookmarks (category_id, title, url, description, tags, favicon_url, is_pinned, sort_order, source)
    values (v_category_id, 'AX 아틀리에 오피스', 'https://ai-bot-dots.web.app/', 'AX & 경영 컨설팅 전문 조직 디지털 오피스', '{}'::text[], null, false, v_last_order, 'manual');
  end if;

  -- 5. 작업 품질검수 PoC WBS
  if not exists (select 1 from public.bookmarks where normalized_url = public.normalize_bookmark_url_v1('https://ax-facti.web.app/')) then
    v_last_order := v_last_order + 1;
    insert into public.bookmarks (category_id, title, url, description, tags, favicon_url, is_pinned, sort_order, source)
    values (v_category_id, '작업 품질검수 PoC WBS', 'https://ax-facti.web.app/', 'AI 기반 작업 품질검수 및 작업지원 기술개발 WBS', '{}'::text[], null, false, v_last_order, 'manual');
  end if;

  -- 6. AX 교육 사전조사 포털
  if not exists (select 1 from public.bookmarks where normalized_url = public.normalize_bookmark_url_v1('https://ud-ax-edu.web.app/')) then
    v_last_order := v_last_order + 1;
    insert into public.bookmarks (category_id, title, url, description, tags, favicon_url, is_pinned, sort_order, source)
    values (v_category_id, 'AX 교육 사전조사 포털', 'https://ud-ax-edu.web.app/', 'AX Consultant 2기 교육 사전조사 및 인터뷰 준비', '{}'::text[], null, false, v_last_order, 'manual');
  end if;

  -- 7. 청년마을 곡물원 발표
  if not exists (select 1 from public.bookmarks where normalized_url = public.normalize_bookmark_url_v1('https://underdogs-localro.web.app/')) then
    v_last_order := v_last_order + 1;
    insert into public.bookmarks (category_id, title, url, description, tags, favicon_url, is_pinned, sort_order, source)
    values (v_category_id, '청년마을 곡물원 발표', 'https://underdogs-localro.web.app/', '청년마을 참여사를 위한 AX 컨설팅 곡물원 사례 발표', '{}'::text[], null, false, v_last_order, 'manual');
  end if;

  -- 8. 바이브코딩 기획·설계 플랫폼
  if not exists (select 1 from public.bookmarks where normalized_url = public.normalize_bookmark_url_v1('https://vibecoding-planning.web.app/')) then
    v_last_order := v_last_order + 1;
    insert into public.bookmarks (category_id, title, url, description, tags, favicon_url, is_pinned, sort_order, source)
    values (v_category_id, '바이브코딩 기획·설계 플랫폼', 'https://vibecoding-planning.web.app/', 'AI 소프트웨어 기획·설계 문서 작성 및 명세 도구', '{}'::text[], null, false, v_last_order, 'manual');
  end if;

  -- 9. 무신사 AX OT 포털
  if not exists (select 1 from public.bookmarks where normalized_url = public.normalize_bookmark_url_v1('https://musinsa-f7938.web.app/')) then
    v_last_order := v_last_order + 1;
    insert into public.bookmarks (category_id, title, url, description, tags, favicon_url, is_pinned, sort_order, source)
    values (v_category_id, '무신사 AX OT 포털', 'https://musinsa-f7938.web.app/', '무신사 AX 컨설팅 킥오프 오리엔테이션 웹', '{}'::text[], null, false, v_last_order, 'manual');
  end if;

  -- 10. 골판지 브랜드 설계도
  if not exists (select 1 from public.bookmarks where normalized_url = public.normalize_bookmark_url_v1('https://box-business.web.app/')) then
    v_last_order := v_last_order + 1;
    insert into public.bookmarks (category_id, title, url, description, tags, favicon_url, is_pinned, sort_order, source)
    values (v_category_id, '골판지 브랜드 설계도', 'https://box-business.web.app/', '골판지·패키징 제조 B2B 밸류체인 및 브랜드 설계도', '{}'::text[], null, false, v_last_order, 'manual');
  end if;

  -- 11. 원주 기독의료기 프로필
  if not exists (select 1 from public.bookmarks where normalized_url = public.normalize_bookmark_url_v1('https://wonju-6e298.web.app/')) then
    v_last_order := v_last_order + 1;
    insert into public.bookmarks (category_id, title, url, description, tags, favicon_url, is_pinned, sort_order, source)
    values (v_category_id, '원주 기독의료기 프로필', 'https://wonju-6e298.web.app/', '정시얼 복지용구 컨설턴트 디지털 프로필', '{}'::text[], null, false, v_last_order, 'manual');
  end if;

  -- 12. AI 에이전틱 개발 시뮬레이터
  if not exists (select 1 from public.bookmarks where normalized_url = public.normalize_bookmark_url_v1('https://ai-agentic-dev.web.app/')) then
    v_last_order := v_last_order + 1;
    insert into public.bookmarks (category_id, title, url, description, tags, favicon_url, is_pinned, sort_order, source)
    values (v_category_id, 'AI 에이전틱 개발 시뮬레이터', 'https://ai-agentic-dev.web.app/', 'AI Agentic Dev 워크플로우 인터랙티브 쇼케이스', '{}'::text[], null, false, v_last_order, 'manual');
  end if;

  -- 13. 글로와이드 개발 범위 검토
  if not exists (select 1 from public.bookmarks where normalized_url = public.normalize_bookmark_url_v1('https://glowide-c6031.web.app/')) then
    v_last_order := v_last_order + 1;
    insert into public.bookmarks (category_id, title, url, description, tags, favicon_url, is_pinned, sort_order, source)
    values (v_category_id, '글로와이드 개발 범위 검토', 'https://glowide-c6031.web.app/', '글로와이드 209개 사용자 스토리 개발 범위 결정 검토', '{}'::text[], null, false, v_last_order, 'manual');
  end if;

  -- 14. 글로와이드 프로젝트 가이드
  if not exists (select 1 from public.bookmarks where normalized_url = public.normalize_bookmark_url_v1('https://glowide-guide.web.app/')) then
    v_last_order := v_last_order + 1;
    insert into public.bookmarks (category_id, title, url, description, tags, favicon_url, is_pinned, sort_order, source)
    values (v_category_id, '글로와이드 프로젝트 가이드', 'https://glowide-guide.web.app/', '글로와이드 프로젝트 운영 시스템 가이드', '{}'::text[], null, false, v_last_order, 'manual');
  end if;

  -- 15. 이스탄불 여행 계획
  if not exists (select 1 from public.bookmarks where normalized_url = public.normalize_bookmark_url_v1('https://istanbul-62490.web.app/')) then
    v_last_order := v_last_order + 1;
    insert into public.bookmarks (category_id, title, url, description, tags, favicon_url, is_pinned, sort_order, source)
    values (v_category_id, '이스탄불 여행 계획', 'https://istanbul-62490.web.app/', '이스탄불 & 카파도키아 인터랙티브 여행 계획 아카이브', '{}'::text[], null, false, v_last_order, 'manual');
  end if;

  -- 16. 곡물원 AX 최종 리포트
  if not exists (select 1 from public.bookmarks where normalized_url = public.normalize_bookmark_url_v1('https://ax-consulting.web.app/gokmulwon-final-report.html')) then
    v_last_order := v_last_order + 1;
    insert into public.bookmarks (category_id, title, url, description, tags, favicon_url, is_pinned, sort_order, source)
    values (v_category_id, '곡물원 AX 최종 리포트', 'https://ax-consulting.web.app/gokmulwon-final-report.html', '곡물원 F&B 커머스 AX 컨설팅 최종 발표 리포트', '{}'::text[], null, false, v_last_order, 'manual');
  end if;

  -- 17. 청년마을 AX 만족도 조사
  if not exists (select 1 from public.bookmarks where normalized_url = public.normalize_bookmark_url_v1('https://survey-a36ec.web.app/')) then
    v_last_order := v_last_order + 1;
    insert into public.bookmarks (category_id, title, url, description, tags, favicon_url, is_pinned, sort_order, source)
    values (v_category_id, '청년마을 AX 만족도 조사', 'https://survey-a36ec.web.app/', '청년마을 참여사 AX 컨설팅 만족도 조사 웹앱', '{}'::text[], null, false, v_last_order, 'manual');
  end if;

  -- 18. ITCONNECT Monograph
  if not exists (select 1 from public.bookmarks where normalized_url = public.normalize_bookmark_url_v1('https://project-list-67e04.web.app/')) then
    v_last_order := v_last_order + 1;
    insert into public.bookmarks (category_id, title, url, description, tags, favicon_url, is_pinned, sort_order, source)
    values (v_category_id, 'ITCONNECT Monograph', 'https://project-list-67e04.web.app/', '전사 66개 프로젝트 및 6대 인프라 클러스터 통합 현황표', '{}'::text[], null, false, v_last_order, 'manual');
  end if;

end;
$migration$;

commit;
