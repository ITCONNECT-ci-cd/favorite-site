-- Migration: 0026_update_operating_sites_and_favicons.sql
-- Description:
--   1. Rename '바이브코딩 기획·설계 플랫폼' -> 'AI 코딩 기획, 설계 플랫폼'
--   2. Rename 'AI 에이전틱 개발 시뮬레이터' -> 'AI 에이전틱 개발 시연'
--   3. Delete '글로와이드 프로젝트 가이드' (https://glowide-guide.web.app/)
--   4. Update URL 'https://project-list-67e04.web.app/' -> 'https://hub.itconnect.dev/'
--   5. Fill topic-tailored, high-resolution 128x128 favicons for all 17 operating sites

-- 1. Delete '글로와이드 프로젝트 가이드'
DELETE FROM bookmarks
WHERE url = 'https://glowide-guide.web.app/'
   OR id = '098c1272-918f-48cd-a209-9f9431d361c4';

-- 2. Rename 'AI 코딩 기획, 설계 플랫폼'
UPDATE bookmarks
SET title = 'AI 코딩 기획, 설계 플랫폼'
WHERE id = 'c7828c41-d20d-47fc-bdef-887e032e3840'
   OR url = 'https://vibecoding-planning.web.app/';

-- 3. Rename 'AI 에이전틱 개발 시연'
UPDATE bookmarks
SET title = 'AI 에이전틱 개발 시연'
WHERE id = '19fa638f-d1cf-41b6-9b04-49a7b6a49ede'
   OR url = 'https://ai-agentic-dev.web.app/';

-- 4. Change Monograph URL to hub.itconnect.dev
UPDATE bookmarks
SET url = 'https://hub.itconnect.dev/'
WHERE id = 'd4b86bfc-67c1-4cf4-ae71-d1619e7e8662'
   OR url = 'https://project-list-67e04.web.app/';

-- 5. Fill topic-tailored favicons for all 17 sites
UPDATE bookmarks
SET favicon_url = 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-24/ai-agentic-dev-3af441889996.png'
WHERE id = '19fa638f-d1cf-41b6-9b04-49a7b6a49ede' OR url = 'https://ai-agentic-dev.web.app/';

UPDATE bookmarks
SET favicon_url = 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-24/vibecoding-planning-75ea6aeb0f58.png'
WHERE id = 'c7828c41-d20d-47fc-bdef-887e032e3840' OR url = 'https://vibecoding-planning.web.app/';

UPDATE bookmarks
SET favicon_url = 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-24/claude-dev-team-45f067eb841f.png'
WHERE id = '5a7e135b-e7b4-4b8e-b99f-3d8e716bcb89' OR url = 'https://itconnect-claude-devteam.web.app/';

UPDATE bookmarks
SET favicon_url = 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-24/itconnect-pixel-office-ff2ef6fdca63.png'
WHERE id = '6cca3da7-b5c3-4a63-b946-036a127bb4e2' OR url = 'https://itconnect-pixel-office.web.app/';

UPDATE bookmarks
SET favicon_url = 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-24/ai-service-showcase-351262e00374.png'
WHERE id = '0f9ebb7b-f0d6-488d-bdf6-7d4899c672a9' OR url = 'https://project-show-e981d.web.app/';

UPDATE bookmarks
SET favicon_url = 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-24/ax-atelier-9e20b440cc71.png'
WHERE id = '0e7d3391-2480-4a82-b95d-74762f63f9f5' OR url = 'https://ai-bot-dots.web.app/';

UPDATE bookmarks
SET favicon_url = 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-24/qc-poc-wbs-918591d7af73.png'
WHERE id = '1b9bd647-aa85-4251-a5f6-f28bd9d76fd3' OR url = 'https://ax-facti.web.app/';

UPDATE bookmarks
SET favicon_url = 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-24/ud-ax-edu-42c021bb395a.png'
WHERE id = 'fa7d592c-63ed-4c41-9b1b-8f5edae674ad' OR url = 'https://ud-ax-edu.web.app/';

UPDATE bookmarks
SET favicon_url = 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-24/underdogs-localro-361286b1e326.png'
WHERE id = 'f2fa56a9-9a1b-4458-859a-a02614366c3a' OR url = 'https://underdogs-localro.web.app/';

UPDATE bookmarks
SET favicon_url = 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-24/musinsa-ot-1c3e429c3661.png'
WHERE id = '1d5e3b75-46f7-41ab-9db5-130f6f71c76b' OR url = 'https://musinsa-f7938.web.app/';

UPDATE bookmarks
SET favicon_url = 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-24/box-business-fde669ea7c56.png'
WHERE id = 'b7175303-7cdb-42ba-b21f-8f631e0e8271' OR url = 'https://box-business.web.app/';

UPDATE bookmarks
SET favicon_url = 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-24/wonju-profile-b800edd55c84.png'
WHERE id = '88039a94-2bb8-4cf3-b16a-d6ee8c432be2' OR url = 'https://wonju-6e298.web.app/';

UPDATE bookmarks
SET favicon_url = 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-24/glowide-scope-045509f232f5.png'
WHERE id = '3c69f3fc-8fb1-466e-af7c-e02565909f0f' OR url = 'https://glowide-c6031.web.app/';

UPDATE bookmarks
SET favicon_url = 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-24/istanbul-travel-c6e69458220c.png'
WHERE id = '452248a8-797b-406a-95f3-48f36673f42d' OR url = 'https://istanbul-62490.web.app/';

UPDATE bookmarks
SET favicon_url = 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-24/gokmulwon-final-report-058ac3bc8ff0.png'
WHERE id = '01652c6c-33e1-42df-8421-d2e437b027c8' OR url = 'https://ax-consulting.web.app/gokmulwon-final-report.html';

UPDATE bookmarks
SET favicon_url = 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-24/youth-village-survey-926b8e67c34c.png'
WHERE id = 'c1dbab28-4820-4fed-9481-2d14ebbe89ea' OR url = 'https://survey-a36ec.web.app/';

UPDATE bookmarks
SET favicon_url = 'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/operating/2026-10-24/itconnect-monograph-e1561ad43d3b.png'
WHERE id = 'd4b86bfc-67c1-4cf4-ae71-d1619e7e8662' OR url = 'https://hub.itconnect.dev/';
