-- 0012_fix_content_site_url.sql
--
-- AI 콘텐츠 자동 생성 서비스의 오래된 복수형 호스트를 현재 운영 호스트로 교정한다.
-- 대상과 새 URL이 예상한 상태가 아니면 수정 없이 전체 migration을 중단한다.

do $migration$
declare
  v_old_count integer;
  v_new_count integer;
  v_affected integer;
begin
  select pg_catalog.count(*)
    into v_old_count
    from public.bookmarks as bookmark
   where bookmark.normalized_url =
     public.normalize_bookmark_url_v1('https://contents.itconnect.dev/');

  select pg_catalog.count(*)
    into v_new_count
    from public.bookmarks as bookmark
   where bookmark.normalized_url =
     public.normalize_bookmark_url_v1('https://content.itconnect.dev/');

  if v_old_count <> 1 then
    raise exception 'contents.itconnect.dev 대상 행은 정확히 1개여야 합니다. 실제: %', v_old_count
      using errcode = '23514';
  end if;

  if v_new_count <> 0 then
    raise exception 'content.itconnect.dev 행이 이미 존재합니다. 실제: %', v_new_count
      using errcode = '23514';
  end if;

  update public.bookmarks
     set url = 'https://content.itconnect.dev/'
   where normalized_url =
     public.normalize_bookmark_url_v1('https://contents.itconnect.dev/');

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception 'contents.itconnect.dev URL 수정 행은 정확히 1개여야 합니다. 실제: %', v_affected
      using errcode = '23514';
  end if;

  select pg_catalog.count(*)
    into v_new_count
    from public.bookmarks as bookmark
   where bookmark.normalized_url =
     public.normalize_bookmark_url_v1('https://content.itconnect.dev/');

  if v_new_count <> 1 then
    raise exception 'content.itconnect.dev 교정 결과는 정확히 1개여야 합니다. 실제: %', v_new_count
      using errcode = '23514';
  end if;
end;
$migration$;
