-- Replace the access-login metadata with the user-provided service copy.
begin;
do $migration$
declare
  v_bookmark public.bookmarks%rowtype;
begin
  select * into v_bookmark from public.bookmarks
   where id = '604b4b69-2635-4cc7-a75b-68ffe926076c'
     and url = 'https://gov.itconnect.dev'
   for update;
  if not found then
    raise exception 'Government notice bookmark identity changed; review before updating';
  end if;
  if v_bookmark.title = '정부지원사업 자동수집기'
     and v_bookmark.description = '우리회사에 맞는 정부지원사업 자동 수집 서비스' then
    return;
  end if;
  if v_bookmark.title is distinct from 'Sign in ・ Cloudflare Access'
     or v_bookmark.description is distinct from '사이트 설명을 확인하지 못했습니다. 링크를 열어 내용을 확인해 주세요.' then
    raise exception 'Government notice copy was edited; refusing to overwrite it';
  end if;
  update public.bookmarks
     set title = '정부지원사업 자동수집기',
         description = '우리회사에 맞는 정부지원사업 자동 수집 서비스'
   where id = v_bookmark.id;
end;
$migration$;
commit;
