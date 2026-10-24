-- Migration: 0027_delete_requested_sites.sql
-- Description: Delete the 9 requested test/PoC sites from bookmarks:
--   - https://ax-facti.web.app/
--   - https://ud-ax-edu.web.app/
--   - https://musinsa-f7938.web.app/
--   - https://box-business.web.app/
--   - https://wonju-6e298.web.app/
--   - https://glowide-c6031.web.app/
--   - https://glowide-guide.web.app/
--   - https://istanbul-62490.web.app/
--   - https://survey-a36ec.web.app/

DELETE FROM bookmarks
WHERE url LIKE '%ax-facti.web.app%'
   OR url LIKE '%ud-ax-edu.web.app%'
   OR url LIKE '%musinsa-f7938.web.app%'
   OR url LIKE '%box-business.web.app%'
   OR url LIKE '%wonju-6e298.web.app%'
   OR url LIKE '%glowide-c6031.web.app%'
   OR url LIKE '%glowide-guide.web.app%'
   OR url LIKE '%istanbul-62490.web.app%'
   OR url LIKE '%survey-a36ec.web.app%';
