-- Keep all 22 operating-site descriptions to two deliberate lines.
-- Replace only the government-support service favicon; preserve favorites and order.
begin;
lock table public.bookmarks in share row exclusive mode;
create temporary table operating_copy (
  id uuid primary key,
  title text not null,
  url text not null,
  previous_description text,
  description text not null
) on commit drop;
insert into operating_copy values
  ('ff6ac013-c385-4439-a1dd-1cdc550cd5c2'::uuid, 'ITCONNECT', 'https://itconnect.dev', '아이티커넥트 대표 사이트', '아이티커넥트의
대표 사이트'),
  ('45a19b48-1579-4e4a-9546-20bc0a62c17d'::uuid, 'Profile', 'https://profile.itconnect.dev/', '아이티커넥트 대표 프로필', '아이티커넥트
대표 프로필'),
  ('440aa09a-764a-4575-81eb-1927e7c86e72'::uuid, 'B-CREATOR', 'https://b-creator.com/', 'AI/AX 교육 및 실습 자료 플랫폼', 'AI·AX 교육과 실습
자료를 모은 플랫폼'),
  ('524d9104-46a9-4d9d-a880-c547ec220844'::uuid, 'AX 컨설팅 코파일럿', 'https://consulting.itconnect.dev/', '병목 업무를 찾아 시스템 구축 설계까지 한번에', '병목 업무 진단부터
시스템 구축 설계까지'),
  ('3a3db3a9-d209-4e35-bf60-67c73d170beb'::uuid, 'AX 외주개발 서비스', 'https://homepage.works/', '3분 만에 AX 외주개발 서비스 견적 산출', 'AX 외주개발 견적을
3분 만에 산출'),
  ('2db0fe1f-0576-4a78-94fa-282948aae999'::uuid, 'Startora', 'https://startora.net/', 'AI Agent 기반 경영관리 플랫폼', 'AI Agent 기반
경영관리 플랫폼'),
  ('02796fbf-0e3a-4fbf-97f3-039d1b20fb3e'::uuid, 'AI 콘텐츠 제작', 'https://content.itconnect.dev/', 'AI로 콘텐츠 기획 및 제작 자동화 서비스', 'AI로 콘텐츠 기획과
제작을 자동화'),
  ('05435aab-5a59-456d-ad86-c0e15cf98e38'::uuid, 'AI 상세페이지 제작', 'https://landingmaker.biz/', 'AI 대화 기반 상세페이지 기획 및 디자인 서비스', 'AI 대화로 기획하는
상세페이지 디자인'),
  ('aae0fe4a-f5b8-4f1a-9aee-186e99a544a4'::uuid, 'AI 사업계획서 제작', 'https://itconnect.co.kr/', 'AI와 프로세스 기반의 사업계획서 작성 및 관리 서비스', 'AI와 프로세스 기반
사업계획서 작성·관리'),
  ('d3a8148d-fc21-4d77-b75b-bd608edcefd5'::uuid, '유튜브 기획 및 분석', 'https://keypaper.biz/', '유튜브 데이터를 수집하고 AI가 분석, 기획, 개선점 도출', '유튜브 데이터 분석
콘텐츠 기획·개선'),
  ('604b4b69-2635-4cc7-a75b-68ffe926076c'::uuid, '정부지원사업 정보 수집', 'https://gov.itconnect.dev', '우리 회사 맞춤형 정부지원사업 정보 수집 서비스', '우리 회사에 맞는
정부지원사업 수집'),
  ('5322abbb-b323-4c3c-82c7-a1a55abb4880'::uuid, 'AI 클립 영상 제작', 'https://clip.itconnect.dev', '콘텐츠 입력시 AI가 숏츠 및 릴스 영상 자동 생성', '콘텐츠를 입력하면
AI가 숏츠·릴스 제작'),
  ('08e11be7-90af-4630-8259-6d870f9b0465'::uuid, '광고 데이터 수집 플랫폼', 'https://ads.itconnect.dev', '여러 플랫폼의 광고 수집', '여러 플랫폼의 광고를
한곳에 모으는 서비스'),
  ('30c2380d-9104-4484-806c-e40389b80d37'::uuid, '부동산 소개 영상 제작', 'https://video.itconnect.dev/', '사진을 업로드하면 AI가 분석하고 부동산 소개 영상 제작', '사진을 AI로 분석해
부동산 소개 영상 제작'),
  ('1bf29424-c969-4d4e-9c0d-b425b0eae823'::uuid, '더베이지', 'https://thebeige.kr/', '24시간 무인 의류 편집 공간, 더베이지 소개 페이지', '24시간 무인 의류
편집 공간 더베이지'),
  ('31f7efe6-f9c6-4cfd-a6fd-dc73441670b9'::uuid, 'AI 정보 매거진', 'https://info.itconnect.dev/', 'AI 소식, 논문 정보 수집 후 블로그 글 자동 생성', 'AI 소식과 논문을 모아
블로그 글을 자동 생성'),
  ('b40735a2-4ad2-4d10-8e04-35a91fc86d76'::uuid, '마케팅 프롬프트 모음', 'https://ai-mkt-fu.web.app/', '마케팅 업무 AI 활용을 위한 프롬프트 모음집', '마케팅 업무에 활용할
AI 프롬프트 모음집'),
  ('f27803e5-5d96-434d-8458-27ce85291908'::uuid, '청년마을 PMS', 'https://localro-pms.kr/', '청년마을 사업의 실적 보고와 증빙을 관리하는 시스템', '청년마을 사업을 위한
실적·증빙 관리 시스템'),
  ('25fca79f-a2bc-4bf1-a0e4-2365f867150e'::uuid, '공통 AX 키트 생성기', 'https://musinsa-contents.itconnect.dev/login', '상품별 마케팅 이미지와 문구를 자동 생성하는 사내 도구', '상품별 마케팅 이미지와
문구를 자동 생성'),
  ('3671c59f-d56d-449b-b997-18bdb20eaa9d'::uuid, '송장 자동 변환기', 'https://musinsa-invoice.itconnect.dev/login', '무신사 3PL 주문서와 송장을 자동 변환하는 사내 작업공간', '무신사 3PL 주문서와
송장을 자동 변환'),
  ('503ad87c-cd46-4fc7-99a6-c3bede74e689'::uuid, 'MacroLens', 'https://moneynlifehacker.com/', '거시 지표와 자산 상관관계를 보는 개인용 주식 분석 도구', '거시 지표와 자산의
상관관계를 보는 도구'),
  ('12953c78-12b0-447c-8a36-e2318f32eb3c'::uuid, 'Rutiqa', 'https://rutiqa.com/', '운동·식단·영양제를 채팅과 사진으로 기록하는 AI 관리 앱', '운동·식단·영양제를
채팅과 사진으로 기록');

do $migration$
declare
  v_category_id constant uuid := '961f597a-31ec-4640-bf08-7b93b122d6e7';
  v_count integer;
begin
  select count(*) into v_count
    from operating_copy d join public.bookmarks b on b.id = d.id
   where b.category_id = v_category_id and b.title = d.title
     and b.normalized_url = public.normalize_bookmark_url_v1(d.url)
     and b.description in (d.previous_description, d.description);
  if v_count <> 22 or (select count(*) from public.bookmarks where category_id = v_category_id) <> 22 then
    raise exception 'Operating-site identities or copy changed; matched % of 22', v_count;
  end if;
  if not exists (
    select 1 from storage.objects
     where bucket_id = 'favicons' and name = 'operating/2026-10-05/gov-notices-dfecaa0546a2.png'
  ) then
    raise exception 'Upload and verify the generated government-support favicon first';
  end if;
  if not exists (
    select 1 from public.bookmarks
     where id = '604b4b69-2635-4cc7-a75b-68ffe926076c'
       and favicon_url in ('https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/discord/604b4b69-2635-4cc7-a75b-68ffe926076c/eb950d60-3787-476c-8706-2a29289aa8ba.png', 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-05/gov-notices-dfecaa0546a2.png')
  ) then
    raise exception 'Government-support favicon changed; review before replacing';
  end if;
  update public.bookmarks b set description = d.description
    from operating_copy d where b.id = d.id and b.description is distinct from d.description;
  update public.bookmarks set favicon_url = 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-05/gov-notices-dfecaa0546a2.png'
   where id = '604b4b69-2635-4cc7-a75b-68ffe926076c'
     and favicon_url is distinct from 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-05/gov-notices-dfecaa0546a2.png';
  select count(*) into v_count from operating_copy d join public.bookmarks b on b.id = d.id
   where b.description = d.description and cardinality(string_to_array(b.description, chr(10))) = 2;
  if v_count <> 22 then
    raise exception 'Expected 22 two-line descriptions; got %', v_count;
  end if;
end;
$migration$;
commit;
