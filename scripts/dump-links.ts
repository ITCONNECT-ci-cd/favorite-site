/**
 * 라이브 DB의 분류·링크를 통째로 JSON 으로 뽑는다 (읽기 전용 진단 도구).
 *
 * 실행: `npx tsx scripts/dump-links.ts > dump.json`
 */
import { createServiceRoleClient } from './lib/service-client';

async function main(): Promise<void> {
  const supabase = createServiceRoleClient();

  const categories = await supabase
    .from('categories')
    .select('id, name, parent_id, sort_order')
    .order('sort_order');
  if (categories.error !== null) throw categories.error;

  const bookmarks = await supabase
    .from('bookmarks')
    .select('id, category_id, title, url, description, tags, favicon_url, is_pinned, sort_order')
    .order('sort_order');
  if (bookmarks.error !== null) throw bookmarks.error;

  process.stdout.write(
    JSON.stringify({ categories: categories.data, bookmarks: bookmarks.data }, null, 2),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
