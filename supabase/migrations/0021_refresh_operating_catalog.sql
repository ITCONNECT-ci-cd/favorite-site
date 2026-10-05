-- Refresh the 22 operating sites requested on 2026-10-05.
-- Icons are generated only for the 13 explicitly marked replacements.
-- Existing bookmark IDs, click history, tags, sources and unmarked icons are retained.
begin;

lock table public.categories in share mode;
lock table public.bookmarks in share row exclusive mode;

create temporary table desired_operating_sites (
  id uuid primary key,
  previous_title text,
  title text not null,
  url text not null,
  description text,
  favicon_url text,
  sort_order integer not null unique,
  generated_icon boolean not null
) on commit drop;

insert into desired_operating_sites values
  ('ff6ac013-c385-4439-a1dd-1cdc550cd5c2'::uuid, '아이티커넥트', 'ITCONNECT', 'https://itconnect.dev', '아이티커넥트 대표 사이트', 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/itconnect.dev.png', 0, false),
  ('45a19b48-1579-4e4a-9546-20bc0a62c17d'::uuid, '최원재 프로필', 'Profile', 'https://profile.itconnect.dev/', '아이티커넥트 대표 프로필', 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-05/profile-3c21b1e846d9.png', 1, true),
  ('440aa09a-764a-4575-81eb-1927e7c86e72'::uuid, '비크리에이터', 'B-CREATOR', 'https://b-creator.com/', 'AI/AX 교육 및 실습 자료 플랫폼', 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/440aa09a-764a-4575-81eb-1927e7c86e72.png', 2, false),
  ('524d9104-46a9-4d9d-a880-c547ec220844'::uuid, 'Axio', 'AX 컨설팅 코파일럿', 'https://consulting.itconnect.dev/', '병목 업무를 찾아 시스템 구축 설계까지 한번에', 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-05/ax-consulting-d705ca044faf.png', 3, true),
  ('3a3db3a9-d209-4e35-bf60-67c73d170beb'::uuid, 'HOMEPAGE.WORKS', 'AX 외주개발 서비스', 'https://homepage.works/', '3분 만에 AX 외주개발 서비스 견적 산출', 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-05/ax-development-5e911498cdd4.png', 4, true),
  ('2db0fe1f-0576-4a78-94fa-282948aae999'::uuid, 'Startora', 'Startora', 'https://startora.net/', 'AI Agent 기반 경영관리 플랫폼', 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/2db0fe1f-0576-4a78-94fa-282948aae999.png', 5, false),
  ('02796fbf-0e3a-4fbf-97f3-039d1b20fb3e'::uuid, 'AI 콘텐츠 자동 생성', 'AI 콘텐츠 제작', 'https://content.itconnect.dev/', 'AI로 콘텐츠 기획 및 제작 자동화 서비스', 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-05/ai-content-0864ee173124.png', 6, true),
  ('05435aab-5a59-456d-ad86-c0e15cf98e38'::uuid, 'LandingMaker', 'AI 상세페이지 제작', 'https://landingmaker.biz/', 'AI 대화 기반 상세페이지 기획 및 디자인 서비스', 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-05/ai-detail-page-2412e06e7f1a.png', 7, true),
  ('aae0fe4a-f5b8-4f1a-9aee-186e99a544a4'::uuid, 'AI 사업계획서 작성', 'AI 사업계획서 제작', 'https://itconnect.co.kr/', 'AI와 프로세스 기반의 사업계획서 작성 및 관리 서비스', 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/aae0fe4a-f5b8-4f1a-9aee-186e99a544a4.png', 8, false),
  ('d3a8148d-fc21-4d77-b75b-bd608edcefd5'::uuid, 'GrowthLab', '유튜브 기획 및 분석', 'https://keypaper.biz/', '유튜브 데이터를 수집하고 AI가 분석, 기획, 개선점 도출', 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/d3a8148d-fc21-4d77-b75b-bd608edcefd5.jpg', 9, false),
  ('604b4b69-2635-4cc7-a75b-68ffe926076c'::uuid, '정부지원사업 자동수집기', '정부지원사업 정보 수집', 'https://gov.itconnect.dev', '우리 회사 맞춤형 정부지원사업 정보 수집 서비스', 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/discord/604b4b69-2635-4cc7-a75b-68ffe926076c/eb950d60-3787-476c-8706-2a29289aa8ba.png', 10, false),
  ('5322abbb-b323-4c3c-82c7-a1a55abb4880'::uuid, null, 'AI 클립 영상 제작', 'https://clip.itconnect.dev', '콘텐츠 입력시 AI가 숏츠 및 릴스 영상 자동 생성', 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-05/ai-clips-2992cb62a0a7.png', 11, true),
  ('08e11be7-90af-4630-8259-6d870f9b0465'::uuid, null, '광고 데이터 수집 플랫폼', 'https://ads.itconnect.dev', '여러 플랫폼의 광고 수집', 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-05/ads-data-973caf1bfaf7.png', 12, true),
  ('30c2380d-9104-4484-806c-e40389b80d37'::uuid, 'AutoVideo Studio', '부동산 소개 영상 제작', 'https://video.itconnect.dev/', '사진을 업로드하면 AI가 분석하고 부동산 소개 영상 제작', 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-05/real-estate-video-f028a7b9b1cd.png', 13, true),
  ('1bf29424-c969-4d4e-9c0d-b425b0eae823'::uuid, 'THE BEIGE', '더베이지', 'https://thebeige.kr/', '24시간 무인 의류 편집 공간, 더베이지 소개 페이지', 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-05/the-beige-15a4e10272bc.png', 14, true),
  ('31f7efe6-f9c6-4cfd-a6fd-dc73441670b9'::uuid, 'AI 정보 매거진', 'AI 정보 매거진', 'https://info.itconnect.dev/', 'AI 소식, 논문 정보 수집 후 블로그 글 자동 생성', 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-05/ai-magazine-60c51721d315.png', 15, true),
  ('b40735a2-4ad2-4d10-8e04-35a91fc86d76'::uuid, null, '마케팅 프롬프트 모음', 'https://ai-mkt-fu.web.app/', '마케팅 업무 AI 활용을 위한 프롬프트 모음집', 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-05/marketing-prompts-d061aac7c66b.png', 16, true),
  ('f27803e5-5d96-434d-8458-27ce85291908'::uuid, '청년마을 PMS', '청년마을 PMS', 'https://localro-pms.kr/', '청년마을 사업의 실적 보고와 증빙을 관리하는 시스템', 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/f27803e5-5d96-434d-8458-27ce85291908.png', 17, false),
  ('25fca79f-a2bc-4bf1-a0e4-2365f867150e'::uuid, '공통 AX 키트 생성기', '공통 AX 키트 생성기', 'https://musinsa-contents.itconnect.dev/login', '상품별 마케팅 이미지와 문구를 자동 생성하는 사내 도구', 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-05/ax-kit-fee9cd6b1cf1.png', 18, true),
  ('3671c59f-d56d-449b-b997-18bdb20eaa9d'::uuid, '무신사 주문·송장 변환', '송장 자동 변환기', 'https://musinsa-invoice.itconnect.dev/login', '무신사 3PL 주문서와 송장을 자동 변환하는 사내 작업공간', 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-05/invoice-converter-a5a0b8a71a76.png', 19, true),
  ('503ad87c-cd46-4fc7-99a6-c3bede74e689'::uuid, 'MacroLens', 'MacroLens', 'https://moneynlifehacker.com/', '거시 지표와 자산 상관관계를 보는 개인용 주식 분석 도구', 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2264%22%20height%3D%2264%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2215%22%20fill%3D%22%236D28D9%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2234%22%20text-anchor%3D%22middle%22%20dominant-baseline%3D%22middle%22%20fill%3D%22%23fff%22%20font-family%3D%22-apple-system%2CBlinkMacSystemFont%2CArial%2Csans-serif%22%20font-size%3D%2230%22%20font-weight%3D%22700%22%3EM%3C%2Ftext%3E%3C%2Fsvg%3E', 20, false),
  ('12953c78-12b0-447c-8a36-e2318f32eb3c'::uuid, '루티카', 'Rutiqa', 'https://rutiqa.com/', '운동·식단·영양제를 채팅과 사진으로 기록하는 AI 관리 앱', 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/12953c78-12b0-447c-8a36-e2318f32eb3c.png', 21, false);

do $migration$
declare
  v_category_id constant uuid := '961f597a-31ec-4640-bf08-7b93b122d6e7';
  v_count integer;
begin
  select count(*) into v_count
    from public.categories
   where parent_id is null and name = '현재 운영 중인 사이트';
  if v_count <> 1 or not exists (
    select 1 from public.categories
     where id = v_category_id and parent_id is null and name = '현재 운영 중인 사이트'
  ) then
    raise exception 'Operating-sites category identity changed';
  end if;

  select count(*) into v_count
    from desired_operating_sites d
    join public.bookmarks b on b.id = d.id
   where d.previous_title is not null
     and b.category_id = v_category_id
     and b.normalized_url = public.normalize_bookmark_url_v1(d.url)
     and b.title in (d.previous_title, d.title);
  if v_count <> 19 then
    raise exception 'Expected the 19 existing operating sites; matched %', v_count;
  end if;

  if exists (
    select 1 from public.bookmarks b
     where b.category_id = v_category_id
       and not exists (select 1 from desired_operating_sites d where d.id = b.id)
  ) then
    raise exception 'Unexpected operating site; review before reordering';
  end if;

  if exists (
    select 1 from desired_operating_sites d
    join public.bookmarks b on b.normalized_url = public.normalize_bookmark_url_v1(d.url)
     where b.id <> d.id or b.category_id <> v_category_id
  ) or exists (
    select 1 from desired_operating_sites d
    join public.bookmarks b on b.id = d.id
     where d.previous_title is null
       and (b.category_id <> v_category_id
         or b.normalized_url <> public.normalize_bookmark_url_v1(d.url)
         or b.title <> d.title)
  ) then
    raise exception 'A requested new site conflicts with an existing bookmark';
  end if;

  select count(*) into v_count
    from desired_operating_sites d
    join storage.objects o
      on o.bucket_id = 'favicons'
     and d.favicon_url =
       'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/' || o.name
   where d.generated_icon;
  if v_count <> 13 then
    raise exception 'Upload and verify all 13 generated icons first; found %', v_count;
  end if;

  update public.bookmarks b
     set title = d.title,
         description = d.description,
         sort_order = d.sort_order,
         favicon_url = case when d.generated_icon then d.favicon_url else b.favicon_url end
    from desired_operating_sites d
   where b.id = d.id
     and (b.title is distinct from d.title
       or b.description is distinct from d.description
       or b.sort_order is distinct from d.sort_order
       or (d.generated_icon and b.favicon_url is distinct from d.favicon_url));

  insert into public.bookmarks (
    id, category_id, title, url, description, tags, favicon_url,
    is_pinned, sort_order, source, is_favorite, fav_order
  )
  select d.id, v_category_id, d.title, d.url, d.description, '{}'::text[], d.favicon_url,
         false, d.sort_order, 'manual', false, 0
    from desired_operating_sites d
   where d.previous_title is null
     and not exists (select 1 from public.bookmarks b where b.id = d.id);

  select count(*) into v_count
    from public.bookmarks b
    join desired_operating_sites d on b.id = d.id
   where b.category_id = v_category_id
     and b.title = d.title
     and b.description is not distinct from d.description
     and b.sort_order = d.sort_order
     and (not d.generated_icon or b.favicon_url = d.favicon_url);
  if v_count <> 22 then
    raise exception 'Operating-sites verification failed; matched % of 22', v_count;
  end if;
end;
$migration$;

commit;
