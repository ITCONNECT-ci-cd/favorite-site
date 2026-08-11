/**
 * 브라우저에 담겨 있던 즐겨찾기를 DB 로 옮긴다 (2026-08-11 서버 이전).
 *
 * 1회성 이관용이지만 **재실행 안전**하므로 지우지 않고 남긴다 — 목록을 통째로 다시 세우고
 * 싶을 때(잘못 담았을 때의 복구 포함) 그대로 쓸 수 있다.
 *
 * ## 쓰는 법
 *
 * 1. 담긴 브라우저로 https://favorite.itconnect.dev 를 열고 개발자도구(F12) 콘솔에서:
 *
 *        copy(localStorage.getItem('linkdash:favs'))
 *
 * 2. 붙여넣은 JSON 배열을 파일로 저장한 뒤 (`tsx` 로 실행해야 `@/` 별칭이 풀린다):
 *
 *        npx tsx scripts/import-favorites.ts <파일경로>
 *
 * ## 무엇을 보장하나
 *
 * - **차례 보존**: 배열의 차례가 곧 `fav_order` 0,1,2… 다. 홈·`/favorites` 가 그 순서로 그린다.
 * - **재실행 안전**: 먼저 전 행을 `is_favorite = false` 로 되돌린 뒤 목록대로 다시 세운다.
 *   두 번 돌려도 결과가 같고, 중간에 죽어도 다시 돌리면 목록과 DB 가 일치한다.
 * - **조용히 삼키지 않는다**: 목록에 있으나 DB 에 없는 id(그 사이 지워진 링크)는 건너뛰되
 *   몇 건인지 보고한다. 안 그러면 개수가 안 맞는 이유를 알 수 없다.
 */
import { readFileSync } from 'node:fs';

import { createServiceRoleClient } from './lib/service-client';

async function main(): Promise<void> {
  const path = process.argv[2];
  if (path === undefined) {
    console.error('사용법: npx tsx scripts/import-favorites.ts <즐겨찾기 JSON 파일>');
    process.exit(1);
  }

  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed)) {
    console.error('JSON 최상위가 배열이 아니다 — localStorage 의 linkdash:favs 값 그대로여야 한다.');
    process.exit(1);
  }

  // 중복은 첫 자리만 남긴다 — 담긴 차례가 곧 순서다.
  const ids = [...new Set(parsed.filter((value): value is string => typeof value === 'string'))];
  console.log(`목록 ${ids.length}건을 읽었다.`);
  if (ids.length === 0) {
    console.error('담긴 id 가 하나도 없다 — 파일을 잘못 짚었을 가능성이 크다. 중단한다.');
    process.exit(1);
  }

  const supabase = createServiceRoleClient();

  const existing = await supabase.from('bookmarks').select('id').in('id', ids);
  if (existing.error !== null) throw new Error(`링크 조회 실패: ${existing.error.message}`);

  const alive = new Set((existing.data ?? []).map((row) => row.id));
  const targets = ids.filter((id) => alive.has(id));
  const missing = ids.length - targets.length;
  if (missing > 0) console.warn(`⚠ DB 에 없는 id ${missing}건은 건너뛴다(그 사이 지워진 링크).`);
  if (targets.length === 0) {
    console.error('DB 에서 하나도 찾지 못했다 — 다른 프로젝트의 목록일 수 있다. 중단한다.');
    process.exit(1);
  }

  // 1) 전부 되돌린다 — 재실행해도 결과가 같게 하고, 목록에서 빠진 링크가 담긴 채 남지 않게 한다.
  const cleared = await supabase
    .from('bookmarks')
    .update({ is_favorite: false, fav_order: 0 })
    .eq('is_favorite', true)
    .select('id');
  if (cleared.error !== null) throw new Error(`초기화 실패: ${cleared.error.message}`);
  console.log(`기존 담김 ${(cleared.data ?? []).length}건을 비웠다.`);

  // 2) 목록의 차례 그대로 다시 세운다. 한 문장으로 못 하는 이유는 lib/mutations 의 writeOrder 와 같다
  //    (PostgREST 에는 행마다 다른 값을 넣는 대량 update 가 없다).
  let written = 0;
  for (const [index, id] of targets.entries()) {
    const result = await supabase
      .from('bookmarks')
      .update({ is_favorite: true, fav_order: index })
      .eq('id', id)
      .select('id');

    if (result.error !== null) throw new Error(`${id} 저장 실패: ${result.error.message}`);
    written += 1;
  }

  console.log(`✓ 즐겨찾기 ${written}건을 담긴 차례 그대로 DB 에 넣었다.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
