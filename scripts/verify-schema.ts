import { randomUUID } from 'node:crypto';

import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js';

import { createServiceRoleClient } from '@/scripts/lib/service-client';

/**
 * B2 완료 기준 6종을 실제 DB에 대고 자동 검증한다.
 *
 * 실행: `npx tsx scripts/verify-schema.ts` (PowerShell, 저장소 루트에서)
 * 선행: `supabase/migrations/0001_init.sql` 적용 + `.env.local` 에 URL·anon·service role 키.
 *
 * ⚠️ `tsx` 로 실행할 것 — `@/…` 별칭은 tsconfig `paths` 이고 Node 네이티브 TS 실행은
 * tsconfig 를 읽지 않는다(scripts/lib/service-client.ts 주석 참조).
 *
 * 검증은 **임시 행을 넣었다 지우는** 방식이라 시드 전후 아무 때나 돌릴 수 있다.
 * 임시 행은 전부 `__verify_schema__` 마커를 달고, 각 검사가 finally 에서 스스로 지운다.
 */

/** 임시 행 식별자 — 검사가 중간에 죽었을 때 수동 정리용으로 남긴다. */
const MARKER = '__verify_schema__';

/** PRD 하드 제약 — enforce_pin_limit 트리거가 강제하는 상한. */
const PIN_LIMIT = 12;

const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

type Outcome = { ok: boolean; detail: string };
type Check = { id: string; label: string; run: () => Promise<Outcome> };

const pass = (detail: string): Outcome => ({ ok: true, detail });
const fail = (detail: string): Outcome => ({ ok: false, detail });

/** 오류를 한 줄로 — 코드가 있어야 42501(RLS)·23505(unique)·P0001(raise) 을 구분할 수 있다. */
function describe(error: PostgrestError): string {
  return `[${error.code ?? '-'}] ${error.message}`;
}

/**
 * RLS/권한에 의한 거부인지 판정한다.
 *
 * 거부 자체는 어떤 오류로도 날 수 있으므로(형 오류, 컬럼 누락 등) 사유까지 확인해야
 * "엉뚱한 이유로 실패했는데 통과로 읽히는" 사고를 막는다. PostgREST 는 정책 위반을
 * 42501 로 넘기지만, 게이트웨이 단에서 코드 없이 메시지만 오는 경우도 있어 문구도 함께 본다.
 */
function isDenial(error: PostgrestError): boolean {
  return error.code === '42501' || /row-level security|permission denied|not authorized/i.test(error.message);
}

/**
 * 저장소 루트의 `.env.local` 을 `process.env` 로 올린다(Node 내장 파서).
 *
 * scripts/lib/service-client.ts 의 로더와 같은 패턴이다 — 그쪽은 export 되어 있지 않고
 * B1 소유 파일이라 이 스토리에서 건드리지 않는다. 파일이 없어도 조용히 넘어가고,
 * 값이 정말 비었는지는 아래 `resolveEnv` 가 판단한다(CI 는 환경변수를 직접 주입한다).
 */
function loadEnvLocal(): void {
  const envPath = new URL('../.env.local', import.meta.url);

  try {
    process.loadEnvFile(envPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw error;
  }
}

/** 키가 하나라도 없으면 연결을 시도하지 않고 무엇이 빈지 알려 주며 종료한다. */
function resolveEnv(): { url: string; anonKey: string } {
  const missing = REQUIRED_ENV.filter((name) => (process.env[name] ?? '').trim() === '');

  if (missing.length > 0) {
    console.error('환경변수가 비어 있어 스키마 검증을 시작할 수 없습니다:');
    for (const name of missing) console.error(`  - ${name}`);
    console.error('');
    console.error('해결: .env.example 을 .env.local 로 복사한 뒤 Supabase 대시보드');
    console.error('      (Project Settings → API)의 값을 채우고 다시 실행하세요.');
    console.error('      PowerShell: Copy-Item .env.example .env.local');
    process.exit(1);
  }

  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
  };
}

/** ① 익명 키로 categories·bookmarks select 성공 (0행이어도 성공은 성공). */
async function checkAnonRead(anon: SupabaseClient): Promise<Outcome> {
  const categories = await anon.from('categories').select('id').limit(1);
  if (categories.error) return fail(`categories select 가 실패했다: ${describe(categories.error)}`);

  const bookmarks = await anon.from('bookmarks').select('id').limit(1);
  if (bookmarks.error) return fail(`bookmarks select 가 실패했다: ${describe(bookmarks.error)}`);

  return pass(
    `categories·bookmarks 모두 읽힌다 (표본 ${categories.data.length}·${bookmarks.data.length}행 — 0행도 통과)`,
  );
}

/** ② 익명 키로 bookmarks insert 거부. */
async function checkAnonBookmarkInsertDenied(
  anon: SupabaseClient,
  service: SupabaseClient,
): Promise<Outcome> {
  const id = randomUUID();
  const { error } = await anon
    .from('bookmarks')
    .insert({ id, title: `${MARKER} anon insert`, url: 'https://example.com/verify-anon-insert' });

  if (!error) {
    // 뚫렸다 — 남기면 시드·통계가 오염되므로 service 로 즉시 회수한다.
    await service.from('bookmarks').delete().eq('id', id);
    return fail('익명 insert 가 성공했다 — bookmarks 에 익명 쓰기 정책이 열려 있다');
  }

  if (!isDenial(error)) return fail(`거부되긴 했으나 RLS 사유가 아니다: ${describe(error)}`);

  return pass(`거부됨 ${describe(error)}`);
}

/**
 * ③ 익명 키로 clicks select·insert 모두 거부.
 *
 * select 거부는 오류가 아니라 **0행**으로 나타난다(RLS 는 행을 필터할 뿐이다). 빈 테이블과
 * 구분하려면 표본이 있어야 하므로 service 로 한 행 넣고 익명이 그걸 못 보는지 확인한다.
 * clicks.bookmark_id 는 nullable 이라 북마크 없이도 표본을 만들 수 있다.
 */
async function checkAnonClicksDenied(anon: SupabaseClient, service: SupabaseClient): Promise<Outcome> {
  const marker = `${MARKER}-${randomUUID()}`;
  const seeded = await service.from('clicks').insert({ visitor_hash: marker }).select('id').single();
  if (seeded.error) return fail(`service 로 clicks 표본을 넣지 못했다: ${describe(seeded.error)}`);

  const seededId: number = seeded.data.id;

  try {
    const read = await anon.from('clicks').select('id').limit(1);
    const readDenied = read.error !== null || read.data.length === 0;

    const insertId = randomUUID();
    const written = await anon.from('clicks').insert({ visitor_hash: `${marker}-anon-${insertId}` });
    if (!written.error) {
      await service.from('clicks').delete().eq('visitor_hash', `${marker}-anon-${insertId}`);
    }

    const insertDenied = written.error !== null && isDenial(written.error);

    if (!readDenied) {
      return fail(`익명이 clicks 원본을 읽었다 (${read.data.length}행) — clk_read 가 authenticated 전용이 아니다`);
    }
    if (!written.error) return fail('익명 clicks insert 가 성공했다 — V1(서버 라우트 전용 기록)이 깨졌다');
    if (!insertDenied) return fail(`insert 가 거부되긴 했으나 RLS 사유가 아니다: ${describe(written.error)}`);

    const readDetail = read.error ? `select ${describe(read.error)}` : 'select 0행(표본 1행이 있는데도 안 보임)';
    return pass(`${readDetail} / insert 거부됨 ${describe(written.error)}`);
  } finally {
    await service.from('clicks').delete().eq('id', seededId);
  }
}

/**
 * ④ is_pinned 12개 초과 시도 → PIN_LIMIT 예외.
 *
 * 이미 고정된 행이 있으면 그만큼만 채워 정확히 12를 만든 뒤 한 번 더 시도한다(시드 전후 무관).
 * 트리거는 행 단위로 세므로 한 건씩 따로 넣는다 — 다중 VALUES 한 문장은 같은 명령 안의
 * 앞선 행이 count 에 안 잡혀 상한을 넘길 수 있다.
 */
async function checkPinLimit(service: SupabaseClient): Promise<Outcome> {
  const created: string[] = [];

  try {
    const existing = await service
      .from('bookmarks')
      .select('id', { count: 'exact', head: true })
      .eq('is_pinned', true);
    if (existing.error) return fail(`고정 개수를 세지 못했다: ${describe(existing.error)}`);

    const pinned = existing.count ?? 0;

    for (let i = pinned; i < PIN_LIMIT; i += 1) {
      const id = randomUUID();
      const { error } = await service.from('bookmarks').insert({
        id,
        title: `${MARKER} pin ${i + 1}`,
        url: `https://example.com/verify-pin-${i + 1}`,
        is_pinned: true,
      });
      if (error) return fail(`${i + 1}번째 고정 삽입이 상한 전에 실패했다: ${describe(error)}`);
      created.push(id);
    }

    const overflowId = randomUUID();
    const overflow = await service.from('bookmarks').insert({
      id: overflowId,
      title: `${MARKER} pin overflow`,
      url: 'https://example.com/verify-pin-overflow',
      is_pinned: true,
    });

    if (!overflow.error) {
      created.push(overflowId);
      return fail(`${PIN_LIMIT + 1}번째 고정이 통과했다 — bookmarks_pin_limit 트리거가 없다`);
    }
    if (!/PIN_LIMIT/.test(overflow.error.message)) {
      return fail(`거부되긴 했으나 PIN_LIMIT 예외가 아니다: ${describe(overflow.error)}`);
    }

    return pass(
      `기존 ${pinned}건 + 임시 ${created.length}건 = ${PIN_LIMIT}건에서 다음 고정이 거부됨 ${describe(overflow.error)}`,
    );
  } finally {
    if (created.length > 0) await service.from('bookmarks').delete().in('id', created);
  }
}

/** ⑤ 익명 키로 bookmark_click_counts select 성공 (definer 뷰 + grant 확인). */
async function checkAnonViewRead(anon: SupabaseClient): Promise<Outcome> {
  const { data, error } = await anon.from('bookmark_click_counts').select('bookmark_id, click_count').limit(1);
  if (error) return fail(`뷰를 읽지 못했다 — grant 또는 security_invoker 설정 확인: ${describe(error)}`);

  return pass(`익명이 합계 뷰를 읽는다 (표본 ${data.length}행 — 0행도 통과)`);
}

/** ⑥ 동명 상위 카테고리 2회 insert → 2번째 거부 (unique nulls not distinct, V2). */
async function checkCategoryUnique(service: SupabaseClient): Promise<Outcome> {
  const name = `${MARKER} 중복 상위 ${randomUUID().slice(0, 8)}`;
  const created: string[] = [];

  try {
    const firstId = randomUUID();
    const first = await service.from('categories').insert({ id: firstId, name, parent_id: null });
    if (first.error) return fail(`첫 번째 상위 카테고리 삽입이 실패했다: ${describe(first.error)}`);
    created.push(firstId);

    const secondId = randomUUID();
    const second = await service.from('categories').insert({ id: secondId, name, parent_id: null });

    if (!second.error) {
      created.push(secondId);
      return fail('동명 상위 카테고리가 두 번 들어갔다 — unique 가 nulls not distinct 가 아니다');
    }
    if (second.error.code !== '23505') {
      return fail(`거부되긴 했으나 unique 위반(23505)이 아니다: ${describe(second.error)}`);
    }

    return pass(`두 번째 동명 상위가 거부됨 ${describe(second.error)}`);
  } finally {
    if (created.length > 0) await service.from('categories').delete().in('id', created);
  }
}

async function main(): Promise<void> {
  loadEnvLocal();
  const { url, anonKey } = resolveEnv();

  const anon = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const service = createServiceRoleClient();

  const checks: Check[] = [
    { id: '①', label: 'anon: categories·bookmarks select 성공', run: () => checkAnonRead(anon) },
    { id: '②', label: 'anon: bookmarks insert 거부', run: () => checkAnonBookmarkInsertDenied(anon, service) },
    { id: '③', label: 'anon: clicks select·insert 거부', run: () => checkAnonClicksDenied(anon, service) },
    { id: '④', label: `service: is_pinned ${PIN_LIMIT + 1}번째 → PIN_LIMIT`, run: () => checkPinLimit(service) },
    { id: '⑤', label: 'anon: bookmark_click_counts select 성공', run: () => checkAnonViewRead(anon) },
    { id: '⑥', label: 'service: 동명 상위 카테고리 중복 거부', run: () => checkCategoryUnique(service) },
  ];

  console.log('B2 스키마 검증 — supabase/migrations/0001_init.sql 적용 결과를 확인합니다.');
  console.log(`대상: ${url}`);
  console.log('');

  let failed = 0;

  for (const check of checks) {
    let outcome: Outcome;
    try {
      outcome = await check.run();
    } catch (error) {
      // 한 검사의 예외가 나머지를 건너뛰게 두지 않는다 — 6종 전부의 상태를 봐야 원인이 좁혀진다.
      outcome = fail(`예외로 중단됨: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!outcome.ok) failed += 1;
    console.log(`${outcome.ok ? 'PASS' : 'FAIL'}  ${check.id} ${check.label}\n        ${outcome.detail}`);
  }

  console.log('');

  if (failed > 0) {
    console.error(`${checks.length}종 중 ${failed}종 실패 — 0001_init.sql 이 그대로 적용됐는지 확인하세요.`);
    console.error(`임시 행이 남았을 수 있습니다. 남았다면 title/name 이 '${MARKER}' 로 시작하는 행을 지우세요.`);
    process.exit(1);
  }

  console.log(`${checks.length}종 전부 통과 — B2 완료 기준을 만족합니다.`);
}

main().catch((error: unknown) => {
  console.error(`검증을 끝내지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
