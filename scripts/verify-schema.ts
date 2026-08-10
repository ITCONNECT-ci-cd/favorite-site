import { randomUUID } from 'node:crypto';

import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js';

import { ADMIN_EMAIL } from '@/lib/admin-config';
import { createServiceRoleClient } from '@/scripts/lib/service-client';

/**
 * 실제 Supabase 프로젝트에 대고 자동 검증한다 — B2 완료 기준 6종 + 배포 요건 4종(총 10종).
 *
 * 실행: `npx tsx scripts/verify-schema.ts` (PowerShell, 저장소 루트에서)
 * 선행: `supabase/migrations/0001_init.sql` 적용 + `.env.local` 에 URL·anon·service role 키.
 *
 * ⚠️ `tsx` 로 실행할 것 — `@/…` 별칭은 tsconfig `paths` 이고 Node 네이티브 TS 실행은
 * tsconfig 를 읽지 않는다(scripts/lib/service-client.ts 주석 참조).
 *
 * ①~⑥ 은 **임시 행을 넣었다 지우는** 방식이라 시드 전후 아무 때나 돌릴 수 있다.
 * 임시 행은 전부 `__verify_schema__` 마커를 달고, 각 검사가 finally 에서 스스로 지운다.
 *
 * ⑦~⑩ 은 스키마가 아니라 **"사람이 손으로 해야 하는 일들"**을 본다. 저장소만 봐서는 절대
 * 드러나지 않고, 안 했을 때의 증상이 "아무 일도 안 일어남"이라 잊기 쉽다:
 *
 *   ⑦ 대시보드에서 public signup 을 껐는가 — 열려 있으면 누구나 인증 사용자가 되어
 *     쓰기 정책 안으로 들어온다(C-1). 스키마가 아무리 맞아도 소용없다.
 *   ⑧ `0002_admin_write_policy.sql` 을 SQL Editor 에서 실행했는가 — 안 했으면 쓰기 정책이
 *     `using (true)` 인 채로 남는데, ①~⑥ 은 그래도 전부 통과한다(anon·service role 만 쓰므로).
 *   ⑨ `0003_stats.sql` 을 실행했는가 — 통계 집계 함수(admin_stats_kpi 등)가 DB 에 있는가.
 *   ⑩ `0004_cleanup.sql` 을 실행했는가 — 방치 판정 함수(cleanup_abandoned)가 DB 에 있는가.
 *
 * ⑧⑨⑩ 은 같은 방식이다 — 각 파일이 만드는 함수 하나의 **존재**로 그 파일의 적용을 대표 확인한다
 * (같은 파일 안이라 하나가 있으면 전부 적용된 것이다). **아침 절차: 마이그레이션 0002·0003·0004·0005 를
 * SQL Editor 에서 전부 적용한 뒤 이 스크립트로 10종을 통과시킨다.** 하나라도 미적용이면 해당
 * 검사가 시끄럽게 실패한다(fail-loud).
 *
 * 한 검사의 실패가 나머지를 가리지 않도록 전부 돌리고 마지막에 합산한다.
 */

/** 임시 행 식별자 — 검사가 중간에 죽었을 때 수동 정리용으로 남긴다. */
const MARKER = '__verify_schema__';

/**
 * 0001 이 `enforce_pin_limit` 트리거로 강제하던 옛 상한. 0005 가 그 트리거를 지웠으므로
 * 지금은 "여기를 넘길 수 있는가"를 보는 기준점으로만 쓴다(검사 ④).
 */
const PIN_LIMIT = 12;
/** 검사 ④ 가 만들어 보는 고정 개수 — 옛 상한을 한 개 넘긴다. */
const PIN_PROBE = PIN_LIMIT + 1;

/** ⑦ 의 raw fetch 상한. supabase-js 를 거치지 않는 유일한 호출이라 직접 건다. */
const SETTINGS_FETCH_TIMEOUT_MS = 10_000;

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
 * ④ 고정 상한이 **걷혔는지** 확인한다 (0005 적용 여부).
 *
 * 0001 은 `enforce_pin_limit` 트리거로 12개 상한을 강제했고, 0005 가 그 트리거를 지운다.
 * 그래서 이 검사는 방향이 뒤집혀 있다 — 예전에는 "13번째가 거부되는가"를 봤지만 지금은
 * **"13번째가 통과하는가"** 를 본다. 거부되면 0005 가 아직 적용되지 않은 것이다.
 *
 * 기존 고정이 몇 개든 상관없이 `PIN_PROBE`(= 옛 상한 + 1)개가 되도록 채운다. 트리거는 행
 * 단위로 세므로 한 건씩 따로 넣는다 — 다중 VALUES 한 문장은 같은 명령 안의 앞선 행이
 * count 에 안 잡혀, 트리거가 남아 있어도 통과해 버려 검사가 거짓 통과한다.
 *
 * 넣은 행은 `finally` 에서 전부 지운다(중간에 실패해도 시드가 늘어난 채로 남지 않는다).
 */
async function checkPinLimitLifted(service: SupabaseClient): Promise<Outcome> {
  const created: string[] = [];

  try {
    const existing = await service
      .from('bookmarks')
      .select('id', { count: 'exact', head: true })
      .eq('is_pinned', true);
    if (existing.error) return fail(`고정 개수를 세지 못했다: ${describe(existing.error)}`);

    const pinned = existing.count ?? 0;

    if (pinned >= PIN_PROBE) {
      // 이미 옛 상한을 넘겨 고정돼 있다 = 트리거가 없다는 뜻이다(있었다면 그 상태가 될 수 없다).
      return pass(`고정이 이미 ${pinned}건 — 옛 상한(${PIN_LIMIT})을 넘겼으므로 트리거가 없다`);
    }

    for (let i = pinned; i < PIN_PROBE; i += 1) {
      const id = randomUUID();
      const { error } = await service.from('bookmarks').insert({
        id,
        title: `${MARKER} pin ${i + 1}`,
        url: `https://example.com/verify-pin-${i + 1}`,
        is_pinned: true,
      });

      if (error) {
        if (/PIN_LIMIT/.test(error.message)) {
          return fail(
            `${i + 1}번째 고정이 PIN_LIMIT 으로 거부됐다 — 0005_lift_pin_limit.sql 이 아직 적용되지 않았다`,
          );
        }

        return fail(`${i + 1}번째 고정 삽입이 상한과 무관한 이유로 실패했다: ${describe(error)}`);
      }

      created.push(id);
    }

    return pass(
      `기존 ${pinned}건 + 임시 ${created.length}건 = ${PIN_PROBE}건까지 고정됨 — 옛 상한(${PIN_LIMIT})을 넘겼다`,
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

/**
 * ⑦ Auth 설정 — public signup 과 익명 로그인이 모두 꺼져 있는지.
 *
 * ## 왜 스키마 검증 스크립트가 프로젝트 설정을 보는가
 *
 * RLS 의 쓰기 정책은 "인증 사용자"에게 열려 있다(0002 는 거기에 관리자 이메일 조건을
 * 더한다). 그런데 anon 키는 브라우저에 실려 나가는 공개 값이라, signup 이 열려 있으면
 * 누구나 `POST /auth/v1/signup` 한 번으로 스스로 인증 사용자가 된다. 그 순간 "인증된
 * 사용자만"이라는 전제가 "아무나"와 같아진다. 스키마만 봐서는 절대 드러나지 않는 구멍이라
 * 여기서 함께 본다.
 *
 * ## 무엇을 어떻게 읽는가
 *
 * GoTrue 의 `/auth/v1/settings` 는 anon 키로 읽을 수 있는 **공개** 엔드포인트다(로그인
 * 화면이 어떤 로그인 수단을 그릴지 정하려고 읽는 자리다). 그래서 service role 없이 확인된다.
 * `disable_signup: true` = 가입 차단, `external.anonymous_users: false` = 익명 로그인 차단.
 *
 * 이 검사는 켜 두는 것 자체가 목적이다 — 설정이 되돌아가면 **시끄럽게 실패해야 한다.**
 */
async function checkSignupDisabled(url: string, anonKey: string): Promise<Outcome> {
  const endpoint = `${url.replace(/\/+$/, '')}/auth/v1/settings`;

  // 이 한 곳만 supabase-js 를 거치지 않는 raw fetch 라 기본 타임아웃이 없다. 엔드포인트가
  // 응답하지 않으면(프로젝트 일시정지·네트워크 블랙홀) 스크립트가 출력 없이 매달린다 —
  // 실패보다 나쁘다. 어느 쪽이든 결론이 나게 상한을 건다.
  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: { apikey: anonKey },
      signal: AbortSignal.timeout(SETTINGS_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return fail(
      `Auth 설정을 읽지 못했다 (${endpoint}): ${reason}` +
        (error instanceof Error && error.name === 'TimeoutError'
          ? `\n        → ${SETTINGS_FETCH_TIMEOUT_MS / 1000}초 안에 응답이 없었다. 프로젝트가 일시정지 상태인지, URL 이 맞는지 확인하세요.`
          : ''),
    );
  }

  if (!response.ok) {
    return fail(`Auth 설정을 읽지 못했다: HTTP ${response.status} ${response.statusText} (${endpoint})`);
  }

  const settings = (await response.json()) as {
    disable_signup?: unknown;
    external?: { anonymous_users?: unknown } | null;
  };

  const signupDisabled = settings.disable_signup === true;
  const anonymousDisabled = settings.external?.anonymous_users === false;

  if (signupDisabled && anonymousDisabled) {
    return pass('disable_signup=true · external.anonymous_users=false — 스스로 인증 사용자가 될 길이 없다');
  }

  const problems: string[] = [];
  if (!signupDisabled) problems.push(`disable_signup=${JSON.stringify(settings.disable_signup)} (true 여야 한다)`);
  if (!anonymousDisabled) {
    problems.push(`external.anonymous_users=${JSON.stringify(settings.external?.anonymous_users)} (false 여야 한다)`);
  }

  return fail(
    [
      problems.join(' · '),
      '        → 누구나 anon 키로 계정을 만들어 "인증 사용자"가 될 수 있다. 쓰기 RLS 가 그 문 뒤에 있다.',
      '        해결: Supabase 대시보드 → Authentication → Sign In / Up →',
      '              "Allow new users to sign up" 끄기 (익명 로그인도 같은 화면에서 끈다).',
      '        (0002 마이그레이션은 별개다 — 그쪽은 아래 검사 ⑧ 이 따로 본다.)',
    ].join('\n'),
  );
}

/**
 * 0002 가 관리자 신원으로 좁힌 정책 셋.
 *
 * `clk_read` 는 select 정책이라 `with check` 가 아예 없다(select 에는 새로 들어올 행이 없다).
 * 나머지 둘은 `for all` 이라 읽는 쪽(`using`)과 쓰는 쪽(`with check`)을 **둘 다** 봐야 한다 —
 * `with check` 만 느슨하면 남의 행으로 위장한 insert·update 가 통과한다.
 */
const ADMIN_POLICIES = [
  { name: 'bm_write', needsWithCheck: true },
  { name: 'cat_write', needsWithCheck: true },
  { name: 'clk_read', needsWithCheck: false },
] as const;

type PolicySummaryRow = { policyname: string; qual: string | null; with_check: string | null };

/**
 * 술어를 한 줄로 — `pg_get_expr` 출력에는 줄바꿈이 섞여 있어 그대로 찍으면 표가 무너진다.
 *
 * 인자는 rpc 응답에서 온 값이라 타입 선언은 약속일 뿐이다. `typeof` 로 보는 이유가 그것이다
 * (문자열이 아닌 게 오면 여기서 조용히 `(없음)` 이 되지, `.replace` 로 죽지 않는다).
 */
function flatten(predicate: string | null): string {
  return typeof predicate === 'string' ? predicate.replace(/\s+/g, ' ').trim() : '(없음)';
}

/**
 * 술어가 "그 관리자임"을 실제로 요구하는지.
 *
 * 존재 여부만 보면 0001 의 `true` 도 정책이므로 통과해 버린다 — 이 검사의 목적이 정확히
 * 그 상태를 잡는 것이다. 그래서 JWT 참조와 관리자 이메일 리터럴이 **둘 다** 있어야 한다.
 * 문자열 일치로 보는 이유: `pg_get_expr` 이 돌려주는 것은 정규화된 텍스트라 우리가 적은
 * 형태(`lower((select auth.jwt() ->> 'email')) = '…'`)와 자구가 다를 수 있고, 앞으로 술어를
 * 다듬어도(예: 조건 추가) 이 두 조각만 남아 있으면 의도는 지켜진 것이기 때문이다.
 */
function isAdminPredicate(predicate: string | null): boolean {
  if (typeof predicate !== 'string') return false;

  const flat = predicate.toLowerCase();
  return flat.includes('auth.jwt()') && flat.includes(`'${ADMIN_EMAIL.toLowerCase()}'`);
}

/** 함수 자체가 없다 = 0002 를 실행하지 않았다. PostgREST 는 스키마 캐시 조회 실패로 알린다. */
function isMissingFunction(error: PostgrestError): boolean {
  return error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message);
}

/**
 * ⑧ 0002_admin_write_policy.sql 이 실제로 적용됐는지.
 *
 * ## 왜 별도 검사가 필요한가
 *
 * ①~⑥ 은 anon 과 service role 만 쓴다. anon 은 쓰기 정책 밖이고 service role 은 RLS 를
 * 통째로 우회하므로, 쓰기 정책의 술어가 `using (true)`(0001)든 관리자 이메일(0002)이든
 * **여섯 검사의 결과는 완전히 같다.** 즉 0002 를 잊고 배포해도 여기서는 아무 신호가 없었다.
 *
 * 술어를 흉내로 확인할 수도 없다 — 관리자로 로그인해 쓰기를 시도하면 성공하는데, 그건
 * 0001 상태에서도 성공한다. 정말 좁혀졌는지 보려면 **정책 정의 자체**를 읽어야 한다.
 *
 * ## 어떻게 읽는가
 *
 * `pg_policies` 는 pg_catalog 에 있어 PostgREST 로는 닿지 않는다. 0002 가 함께 만드는
 * security definer 함수 `admin_policy_summary()` 가 그 셋만 골라 돌려주고, 실행 권한은
 * service role 에게만 있다(술어에 관리자 이메일이 들어 있다).
 *
 * 그래서 **함수가 없다는 것 자체가 "0002 미적용"의 증거**다 — 같은 파일에 들어 있으므로.
 */
async function checkAdminPolicies(service: SupabaseClient): Promise<Outcome> {
  const { data, error } = await service.rpc('admin_policy_summary');

  if (error) {
    if (isMissingFunction(error)) {
      return fail(
        [
          `0002 미적용 — admin_policy_summary() 가 없습니다 ${describe(error)}`,
          '        → 쓰기 정책이 0001 의 `using (true)` 인 채로 남아 있을 수 있습니다. 그 상태면',
          '          아무 인증 사용자나 REST 로 전체 데이터를 지울 수 있습니다(①~⑥ 은 그래도 통과합니다).',
          '        해결: Supabase 대시보드 → SQL Editor 에서',
          '              supabase/migrations/0002_admin_write_policy.sql 을 **파일 전체** 실행하세요',
          '              (정책 셋과 이 함수가 한 파일에 들어 있습니다).',
          "        방금 실행했는데도 이 메시지가 나온다면 스키마 캐시 문제입니다: notify pgrst, 'reload schema';",
        ].join('\n'),
      );
    }

    return fail(`정책 술어를 읽지 못했다: ${describe(error)}`);
  }

  const rows: unknown = data;
  if (!Array.isArray(rows)) return fail(`admin_policy_summary() 가 행 집합이 아닌 값을 돌려줬다: ${typeof data}`);

  const summary = rows as PolicySummaryRow[];
  const problems: string[] = [];

  for (const policy of ADMIN_POLICIES) {
    const row = summary.find((candidate) => candidate.policyname === policy.name);

    if (row === undefined) {
      problems.push(`${policy.name} 정책이 없다 — 0002 를 일부만 실행했거나 정책이 지워졌다`);
      continue;
    }

    if (!isAdminPredicate(row.qual)) {
      problems.push(`${policy.name} using 이 관리자 이메일을 요구하지 않는다: ${flatten(row.qual)}`);
    }
    if (policy.needsWithCheck && !isAdminPredicate(row.with_check)) {
      problems.push(`${policy.name} with check 가 관리자 이메일을 요구하지 않는다: ${flatten(row.with_check)}`);
    }
  }

  if (problems.length > 0) {
    return fail(
      [
        problems.join('\n        '),
        '        → 쓰기 권한이 관리자 한 명으로 좁혀지지 않았습니다.',
        '        해결: supabase/migrations/0002_admin_write_policy.sql 을 다시 파일 전체 실행하세요',
        '              (재실행해도 안전합니다).',
      ].join('\n'),
    );
  }

  return pass(
    `${ADMIN_POLICIES.map((policy) => policy.name).join('·')} 모두 관리자 이메일을 요구한다 — 0002 적용됨`,
  );
}

/**
 * ⑨·⑩ 공통 — "그 마이그레이션이 만드는 대표 함수가 DB 에 있는가"로 적용 여부를 본다.
 *
 * ⑧ 이 admin_policy_summary() 하나로 0002 전체를 확인하는 것과 같은 발상이다: 각 파일은
 * `create or replace` 함수 묶음이라, 그중 하나가 있으면 파일 전체가 적용된 것으로 본다.
 *
 * ⑧ 과 다른 점은 이 함수들이 service_role 에 execute 를 주지 않는다는 것이다(authenticated
 * 전용 — 0003·0004 는 관리자 쿠키 클라이언트가 부른다). 그래서 service 로 호출하면 **함수가
 * 있어도** 42501(permission denied)로 거부된다. 그건 "미적용"이 아니라 "적용됨"의 신호다 —
 * 함수를 찾아 권한 검사까지 갔다는 뜻이다. 반대로 함수 자체가 없으면 PostgREST 가 스키마
 * 캐시에서 못 찾아 PGRST202/42883 로 알린다. 관리자 세션이 아니어도 이 둘을 코드로 가른다:
 *
 *   함수 부재(PGRST202·42883·"could not find") → FAIL(미적용)
 *   그 밖(권한 거부 42501 포함, 심지어 성공)      → PASS(적용됨)
 *
 * 그래서 지금(0003·0004 미적용)은 의도된 FAIL 이고, 세 마이그레이션을 모두 적용하면 PASS 가 된다.
 */
async function checkMigrationApplied(
  service: SupabaseClient,
  spec: { migration: string; file: string; fn: string; params?: Record<string, unknown>; note: string },
): Promise<Outcome> {
  const { error } = await service.rpc(spec.fn, spec.params);

  if (!error) return pass(`${spec.fn} 가 호출됐다 — ${spec.migration} 적용됨`);

  if (isMissingFunction(error)) {
    return fail(
      [
        `${spec.migration} 미적용 — ${spec.fn} 가 없습니다 ${describe(error)}`,
        `        → ${spec.note}`,
        '        해결: Supabase 대시보드 → SQL Editor 에서',
        `              supabase/migrations/${spec.file} 을 **파일 전체** 실행하세요`,
        '              (create or replace 라 재실행해도 안전합니다).',
        "        방금 실행했는데도 이 메시지가 나온다면 스키마 캐시 문제입니다: notify pgrst, 'reload schema';",
      ].join('\n'),
    );
  }

  // 함수는 존재한다(부재가 아니다) — 거부·기타 사유는 곧 "적용됨"이다.
  const why = isDenial(error) ? '함수는 있으나 관리자 세션이 아니라 거부됨' : '함수는 있으나 다른 사유로 거부됨';
  return pass(`${spec.fn} 존재 — ${spec.migration} 적용됨 (${why}: ${describe(error)})`);
}

/** ⑨ 0003_stats.sql 적용 — 통계 집계 함수 admin_stats_kpi() 가 있는가. */
function checkStatsApplied(service: SupabaseClient): Promise<Outcome> {
  return checkMigrationApplied(service, {
    migration: '0003',
    file: '0003_stats.sql',
    fn: 'admin_stats_kpi',
    note: '통계 화면(K2)이 소비하는 집계 함수 다섯 + 게이트가 아직 DB 에 없습니다(①~⑧ 은 그래도 통과합니다).',
  });
}

/** ⑩ 0004_cleanup.sql 적용 — 방치 판정 함수 cleanup_abandoned(int) 가 있는가. */
function checkCleanupApplied(service: SupabaseClient): Promise<Outcome> {
  return checkMigrationApplied(service, {
    migration: '0004',
    file: '0004_cleanup.sql',
    fn: 'cleanup_abandoned',
    // 유효한 기준일 하나를 실어 PostgREST 가 (int) 오버로드를 찾게 한다. 함수는 본문 전에
    // 신원/권한에서 막히므로 값 자체는 결과에 영향을 주지 않는다(적용됐다면 42501, 없으면 PGRST202).
    params: { retention_days: 90 },
    note: '정리 화면(M2)의 방치 판정 rpc 가 아직 DB 에 없습니다(①~⑨ 는 그래도 통과합니다).',
  });
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
    {
      id: '④',
      label: `service: 고정 ${PIN_PROBE}번째 통과 (0005 상한 해제)`,
      run: () => checkPinLimitLifted(service),
    },
    { id: '⑤', label: 'anon: bookmark_click_counts select 성공', run: () => checkAnonViewRead(anon) },
    { id: '⑥', label: 'service: 동명 상위 카테고리 중복 거부', run: () => checkCategoryUnique(service) },
    { id: '⑦', label: 'auth: public signup·익명 로그인 비활성', run: () => checkSignupDisabled(url, anonKey) },
    { id: '⑧', label: 'rls: 쓰기 정책이 관리자 이메일로 좁혀짐 (0002 적용)', run: () => checkAdminPolicies(service) },
    { id: '⑨', label: 'rpc: 통계 집계 함수 admin_stats_kpi 존재 (0003 적용)', run: () => checkStatsApplied(service) },
    { id: '⑩', label: 'rpc: 방치 판정 함수 cleanup_abandoned 존재 (0004 적용)', run: () => checkCleanupApplied(service) },
  ];

  console.log('스키마·설정 검증 — 0001 결과(①~⑥, ④는 0005 로 상한 해제), Auth 설정(⑦), 마이그레이션 0002·0003·0004 적용(⑧⑨⑩)을 확인합니다.');
  console.log('적용 절차: SQL Editor 에서 0002·0003·0004·0005 를 전부 적용한 뒤 이 스크립트로 10종을 통과시킵니다.');
  console.log(`대상: ${url}`);
  console.log('');

  let failed = 0;

  for (const check of checks) {
    let outcome: Outcome;
    try {
      outcome = await check.run();
    } catch (error) {
      // 한 검사의 예외가 나머지를 건너뛰게 두지 않는다 — 전부의 상태를 봐야 원인이 좁혀진다.
      outcome = fail(`예외로 중단됨: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!outcome.ok) failed += 1;
    console.log(`${outcome.ok ? 'PASS' : 'FAIL'}  ${check.id} ${check.label}\n        ${outcome.detail}`);
  }

  console.log('');

  if (failed > 0) {
    console.error(`${checks.length}종 중 ${failed}종 실패.`);
    console.error('  ①~⑥ 이 실패했다면: 0001_init.sql 이 그대로 적용됐는지 확인하세요 (단 ④ 는 0005_lift_pin_limit.sql 을 봅니다).');
    console.error('  ⑦ 이 실패했다면: 위 안내대로 대시보드에서 signup 을 끄세요 (코드로는 못 고칩니다).');
    console.error('  ⑧⑨⑩ 이 실패했다면: 각각 0002·0003·0004 마이그레이션을 SQL Editor 에서 파일 전체 실행하세요.');
    console.error('  ⑦~⑩ 은 저장소에서 고칠 수 없는 항목입니다 — 대시보드·SQL Editor 에서 사람이 해야 합니다.');
    console.error(`임시 행이 남았을 수 있습니다. 남았다면 title/name 이 '${MARKER}' 로 시작하는 행을 지우세요.`);
    process.exit(1);
  }

  console.log(
    `${checks.length}종 전부 통과 — B2 완료 기준과 배포 전 설정 요건(signup·0002·0003·0004·0005)을 만족합니다.`,
  );
}

main().catch((error: unknown) => {
  console.error(`검증을 끝내지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
