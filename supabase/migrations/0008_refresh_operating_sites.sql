-- 0008_refresh_operating_sites.sql
--
-- 운영 사이트 목록을 2026-08-22 기준으로 바로잡는다.
-- - jiinsi.com은 자사 운영 서비스가 아니므로 뉴스·인사이트 > AI 뉴스로 이동한다.
-- - 개발 중인 자사 서비스 3건은 주소·제목·설명만 등록한다(favicon_url은 수집하지 않는다).
--
-- 재실행 시 URL의 normalized unique key를 기준으로 같은 행을 갱신하므로 중복을 만들지 않는다.

do $migration$
declare
  v_operating_category_id uuid;
  v_ai_news_category_id uuid;
  v_operating_max_order integer;
  v_affected integer;
begin
  select category.id
    into v_operating_category_id
    from public.categories as category
   where category.parent_id is null
     and category.name = '현재 운영 중인 사이트';

  if v_operating_category_id is null then
    raise exception '현재 운영 중인 사이트 카테고리를 찾지 못했습니다.' using errcode = '23514';
  end if;

  select child.id
    into v_ai_news_category_id
    from public.categories as child
    join public.categories as parent on parent.id = child.parent_id
   where parent.parent_id is null
     and parent.name = '뉴스·인사이트'
     and child.name = 'AI 뉴스';

  if v_ai_news_category_id is null then
    raise exception '뉴스·인사이트 > AI 뉴스 카테고리를 찾지 못했습니다.' using errcode = '23514';
  end if;

  update public.bookmarks
     set category_id = v_ai_news_category_id,
         title = '지인시',
         description = 'AI 기술·경제·논문 소식을 매일 큐레이션하는 뉴스레터'
   where normalized_url = public.normalize_bookmark_url_v1('https://jiinsi.com/');

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception 'jiinsi.com 대상 행은 정확히 1개여야 합니다. 실제: %', v_affected
      using errcode = '23514';
  end if;

  select coalesce(pg_catalog.max(bookmark.sort_order), -1)
    into v_operating_max_order
    from public.bookmarks as bookmark
   where bookmark.category_id = v_operating_category_id;

  insert into public.bookmarks (
    category_id,
    title,
    url,
    description,
    tags,
    favicon_url,
    is_pinned,
    sort_order,
    source
  )
  select
    v_operating_category_id,
    site.title,
    site.url,
    site.description,
    '{}'::text[],
    null,
    false,
    v_operating_max_order + site.position,
    'manual'
  from (
    values
      (
        1,
        'AI 콘텐츠 자동 생성',
        'https://contents.itconnect.dev/',
        'AI로 콘텐츠 기획과 제작을 자동화하는 서비스 · 개발 중'
      ),
      (
        2,
        'LandingMaker',
        'https://landingmaker.biz/',
        'AI로 페이지를 기획하고 제작 프로세스를 관리하는 서비스 · 개발 중'
      ),
      (
        3,
        'AI 사업계획서 작성',
        'https://itconnect.co.kr/',
        'AI와 함께 사업계획서를 단계별로 완성하는 서비스 · 개발 중'
      )
  ) as site(position, title, url, description)
  on conflict (normalized_url) do update
     set category_id = excluded.category_id,
         title = excluded.title,
         url = excluded.url,
         description = excluded.description,
         tags = excluded.tags,
         is_pinned = false;

  select pg_catalog.count(*)
    into v_affected
    from public.bookmarks as bookmark
   where bookmark.normalized_url in (
     public.normalize_bookmark_url_v1('https://contents.itconnect.dev/'),
     public.normalize_bookmark_url_v1('https://landingmaker.biz/'),
     public.normalize_bookmark_url_v1('https://itconnect.co.kr/')
   )
     and bookmark.category_id = v_operating_category_id;

  if v_affected <> 3 then
    raise exception '개발 중 운영 사이트 3건이 모두 등록되지 않았습니다. 실제: %', v_affected
      using errcode = '23514';
  end if;
end;
$migration$;
