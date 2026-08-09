import { randomInt } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

import { ADMIN_EMAIL } from '@/lib/admin-config';
import { createServiceRoleClient } from '@/scripts/lib/service-client';

/**
 * 관리자 계정을 만들고, 자격을 로컬 파일에 남기고, 실제로 로그인되는지까지 확인한다.
 *
 * 실행: `npx tsx scripts/create-admin.ts` (PowerShell, 저장소 루트에서)
 * 선행: `.env.local` 에 URL·anon·service role 키.
 *
 * ⚠️ `tsx` 로 실행할 것 — `@/…` 는 tsconfig `paths` 별칭이고 Node 네이티브 TS 실행은
 * tsconfig 를 읽지 않는다(scripts/lib/service-client.ts 주석 참조).
 *
 * ## 재실행해도 안전하다
 *
 * 계정이 이미 있으면 **아무것도 건드리지 않고** 알려만 준다. 비밀번호를 다시 만들어
 * 덮어쓰지 않는 이유는, 사용자가 이미 로그인해 비밀번호를 바꿨을 수 있어서다. 그 경우
 * 재설정은 사용자가 아는 비밀번호를 조용히 무효화하고 자격 파일도 거짓이 된다.
 *
 * ## 비밀번호는 화면에 찍지 않는다
 *
 * 콘솔 출력은 터미널 스크롤백·CI 로그·에이전트 기록에 남는다. 비밀번호는 오직
 * `.admin-credentials.local` 파일에만 들어가고, 이 스크립트는 파일 경로까지만 말한다.
 */

/** 자격 파일 — 저장소 루트. `.gitignore` 에 등재돼 있다(커밋되면 안 된다). */
const CREDENTIALS_PATH = fileURLToPath(new URL('../.admin-credentials.local', import.meta.url));

const PASSWORD_LENGTH = 32;

/**
 * 비밀번호 알파벳 — 헷갈리는 글자(`0O` `1lI`)를 뺐다.
 *
 * 사용자가 파일에서 눈으로 읽어 옮겨 칠 수 있어야 해서다. 4종을 나눠 둔 건 각 종류가
 * 최소 1자씩 들어가도록 강제하기 위함이다(Supabase 프로젝트가 문자 종류 요건을 켜 두면
 * 무작위 문자열이 운 나쁘게 거부될 수 있다).
 */
const ALPHABET = {
  lower: 'abcdefghijkmnopqrstuvwxyz',
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  digit: '23456789',
  symbol: '!@#$%^&*-_=+',
} as const;

/** 한 글자를 균등하게 고른다. `randomInt` 는 나머지 편향이 없는 CSPRNG 다(`% len` 은 편향이 생긴다). */
function pick(chars: string): string {
  return chars[randomInt(chars.length)];
}

/**
 * 암호학적으로 안전한 무작위 비밀번호를 만든다.
 *
 * 4종 각 1자를 먼저 심어 종류 요건을 보장한 뒤 나머지를 전체 알파벳에서 채우고,
 * 마지막에 Fisher–Yates 로 섞는다. 안 섞으면 앞 4자리의 종류가 항상 같은 순서라
 * 그만큼 추측 공간이 줄어든다.
 *
 * export 되어 있는 것은 `create-admin.test.ts` 가 성질(길이·4종 포함·모호 글리프 부재)을
 * 반복 실행으로 확인하기 위해서다. 무작위 출력은 한 번 돌려서는 회귀가 드러나지 않는다.
 */
export function generatePassword(): string {
  const all = ALPHABET.lower + ALPHABET.upper + ALPHABET.digit + ALPHABET.symbol;

  const chars = [pick(ALPHABET.lower), pick(ALPHABET.upper), pick(ALPHABET.digit), pick(ALPHABET.symbol)];
  while (chars.length < PASSWORD_LENGTH) chars.push(pick(all));

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

/**
 * 저장소 루트의 `.env.local` 을 `process.env` 로 올린다(Node 내장 파서).
 *
 * `createServiceRoleClient()` 도 안에서 같은 일을 하지만 그 로더는 export 돼 있지 않고,
 * 이 스크립트는 service role 클라이언트를 만들기 전에 anon 키까지 확인해야 한다.
 * verify-schema.ts 와 같은 패턴이다. 파일이 없어도 조용히 넘어간다(CI 는 직접 주입).
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
  const required = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
  const missing = required.filter((name) => (process.env[name] ?? '').trim() === '');

  if (missing.length > 0) {
    console.error('환경변수가 비어 있어 관리자 계정을 만들 수 없습니다:');
    for (const name of missing) console.error(`  - ${name}`);
    console.error('');
    console.error('해결: .env.example 을 .env.local 로 복사한 뒤 Supabase 대시보드');
    console.error('      (Project Settings → API)의 값을 채우고 다시 실행하세요.');
    process.exit(1);
  }

  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
  };
}

/**
 * 이메일로 기존 사용자를 찾는다. 없으면 `null`.
 *
 * admin API 에 이메일 조회가 없어서 목록을 훑는다. 관리자 계정은 한 자릿수라 한 페이지면
 * 끝나지만, 페이지를 다 돌지 않으면 "없다"고 잘못 판단해 중복 생성으로 이어지므로 끝까지 본다.
 * 이메일 비교는 소문자로 맞춘다 — Supabase 는 이메일을 소문자로 저장한다.
 */
async function findUserByEmail(service: SupabaseClient, email: string): Promise<User | null> {
  const target = email.toLowerCase();
  const perPage = 200;

  for (let page = 1; ; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`사용자 목록을 읽지 못했습니다: ${error.message}`);

    const found = data.users.find((user) => user.email?.toLowerCase() === target);
    if (found) return found;

    if (data.users.length < perPage) return null;
  }
}

/** 자격 파일을 쓴다. 평문 비밀번호가 들어가므로 파일 권한을 소유자 전용으로 좁힌다. */
function writeCredentials(email: string, password: string, createdAt: Date): void {
  const seoul = createdAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  const body = [
    '# 관리자 계정 자격 — favorite_site',
    '#',
    '# 이 파일은 .gitignore 에 등재돼 있어 커밋되지 않습니다.',
    '# 비밀번호가 평문으로 들어 있으니 다른 곳에 복사하거나 공유하지 마세요.',
    '',
    `이메일       : ${email}`,
    `비밀번호     : ${password}`,
    `생성 시각    : ${seoul} (KST) / ${createdAt.toISOString()}`,
    `생성 스크립트: npx tsx scripts/create-admin.ts`,
    '',
    '로그인 경로  : /admin',
    '',
    '⚠️ 로그인 후 비밀번호를 바꾸시길 권장합니다.',
    '   비밀번호를 바꾼 뒤에는 이 파일을 삭제하세요 (내용이 더는 맞지 않습니다).',
    '',
  ].join('\n');

  // 0o600 = 소유자만 읽고 쓰기. Windows 에서는 ACL 로 정확히 반영되지 않지만,
  // 이 저장소가 WSL·CI 등 POSIX 환경에서 돌 때를 위해 그대로 둔다(해가 없다).
  writeFileSync(CREDENTIALS_PATH, body, { encoding: 'utf8', mode: 0o600 });
}

/**
 * 만든 계정으로 실제 로그인이 되는지 확인하고 곧바로 로그아웃한다.
 *
 * service role 로 만들었다는 사실만으로는 "로그인된다"가 증명되지 않는다 —
 * 이메일 미확인 상태면 생성은 성공해도 로그인은 `email_not_confirmed` 로 막힌다.
 * 그래서 사용자가 실제로 지나갈 경로(anon 키 + 비밀번호)를 그대로 밟아 본다.
 *
 * 토큰은 반환하지도 찍지도 않는다 — 성공 여부와 사용자 id 만 본다.
 *
 * ⚠️ **재사용 주의**: 아래 `signOut()` 은 기본 scope 가 global 이라 그 사용자의 **모든**
 * 리프레시 토큰을 폐기한다. 계정을 방금 만든 직후에는 폐기할 세션이 이 검증용 하나뿐이라
 * 무해하지만, 이 함수를 비밀번호 리셋 흐름 같은 데서 다시 쓰면 **브라우저에 로그인해 둔
 * 관리자가 그 자리에서 쫓겨난다.** 그런 곳에 쓸 거라면 `signOut({ scope: 'local' })` 로
 * 바꿔라 — 여기서 굳이 global 을 쓰는 이유는 생성 직후엔 흔적을 남기지 않는 쪽이 낫기 때문이다.
 */
async function verifySignIn(url: string, anonKey: string, email: string, password: string, expectedUserId: string) {
  const anon = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`생성은 됐으나 로그인에 실패했습니다: [${error.code ?? '-'}] ${error.message}`);
  if (data.session === null) throw new Error('로그인은 통과했으나 세션이 발급되지 않았습니다.');
  if (data.user.id !== expectedUserId) {
    throw new Error('로그인된 사용자가 방금 만든 계정과 다릅니다 — 동명 계정이 있는지 확인하세요.');
  }

  // 검증용 세션을 남겨 두지 않는다. 기본 scope 는 global 이라 발급된 리프레시 토큰을 회수한다.
  const { error: signOutError } = await anon.auth.signOut();
  if (signOutError) throw new Error(`로그아웃에 실패했습니다: ${signOutError.message}`);
}

async function main(): Promise<void> {
  loadEnvLocal();
  const { url, anonKey } = resolveEnv();
  const service = createServiceRoleClient();

  console.log('H1 관리자 계정 생성');
  console.log(`대상: ${url}`);
  console.log(`계정: ${ADMIN_EMAIL}`);
  console.log('');

  const existing = await findUserByEmail(service, ADMIN_EMAIL);
  if (existing !== null) {
    console.log('이미 존재 — 아무것도 바꾸지 않았습니다.');
    console.log(`  사용자 id   : ${existing.id}`);
    console.log(`  생성 시각   : ${existing.created_at}`);
    console.log(`  이메일 확인 : ${existing.email_confirmed_at ? '완료' : '미완료'}`);
    console.log('');
    console.log('비밀번호는 재설정하지 않습니다(이미 바꿔 두셨을 수 있습니다).');
    console.log(`기존 자격 파일이 있다면 그대로 둡니다: ${CREDENTIALS_PATH}`);
    console.log('비밀번호를 잊으셨다면 Supabase 대시보드(Authentication → Users)에서 재설정하세요.');
    return;
  }

  const password = generatePassword();

  // email_confirm: true — 확인 메일을 보내지 않고 확인된 상태로 만든다.
  // 사내 수동 생성이라 받을 메일함도, 눌러 줄 사람도 없다(계획서 H1).
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password,
    email_confirm: true,
  });

  if (createError) {
    // 방금 목록에는 없었는데 생성이 중복으로 막혔다 = 다른 실행과 겹쳤다. 덮어쓰지 않고 물러난다.
    if (createError.code === 'email_exists' || createError.code === 'user_already_exists') {
      console.log('이미 존재 — 아무것도 바꾸지 않았습니다(다른 실행과 겹친 것으로 보입니다).');
      return;
    }
    throw new Error(`계정 생성에 실패했습니다: [${createError.code ?? '-'}] ${createError.message}`);
  }

  // ⚠️ 여기서부터 계정은 이미 존재한다. **이 줄과 파일 쓰기 사이에는 아무것도 넣지 마라.**
  // 그 사이에서 죽으면 "계정은 생겼는데 비밀번호는 아무도 모른다"가 되고, 이 스크립트는
  // 재실행해도 기존 계정을 건드리지 않으므로(위 분기) 대시보드에서 손으로 재설정해야만
  // 빠져나올 수 있다. 검증은 검증일 뿐이고, 산출물을 유실시킬 자격은 없다.
  writeCredentials(ADMIN_EMAIL, password, new Date());

  // 파일이 안전해진 뒤에야 확인한다. 아래 셋 중 무엇이 던져도 비밀번호는 이미 디스크에 있다.
  // 반환값만 믿지 않고 service 로 다시 조회한다 — 정말 저장됐는지, 확인 상태로 들어갔는지 본다.
  const stored = await findUserByEmail(service, ADMIN_EMAIL);
  if (stored === null) throw new Error('생성 응답은 성공이었으나 조회에서 계정을 찾지 못했습니다.');
  if (stored.id !== created.user.id) throw new Error('조회된 계정 id 가 생성 응답과 다릅니다.');
  if (!stored.email_confirmed_at) {
    throw new Error('계정은 만들어졌으나 이메일 확인 상태가 아닙니다 — email_confirm 옵션을 확인하세요.');
  }

  await verifySignIn(url, anonKey, ADMIN_EMAIL, password, stored.id);

  console.log('생성 완료.');
  console.log(`  사용자 id   : ${stored.id}`);
  console.log(`  이메일 확인 : 완료 (${stored.email_confirmed_at})`);
  console.log('  로그인 검증 : 통과 (세션 발급 확인 후 로그아웃)');
  console.log('');
  console.log(`비밀번호는 화면에 찍지 않습니다. 아래 파일에서 확인하세요:`);
  console.log(`  ${CREDENTIALS_PATH}`);
  console.log('');
  console.log('이 파일은 .gitignore 에 등재돼 있어 커밋되지 않습니다.');
  console.log('로그인 후 비밀번호를 바꾸고, 바꾼 뒤에는 파일을 삭제하세요.');
}

/**
 * `npx tsx scripts/create-admin.ts` 로 **직접 실행됐을 때만** 참.
 *
 * 이 파일은 `generatePassword` 를 export 하고 테스트가 그것을 import 한다. 가드가 없으면
 * import 만으로 `main()` 이 돌아 테스트가 실제 Supabase 프로젝트에 계정을 만들려 든다.
 *
 * 경로 비교는 정규화해서 한다 — Windows 에서는 구분자(`\` 대 `/`)와 드라이브 문자
 * 대소문자(`E:` 대 `e:`)가 실행 방법에 따라 다르게 들어온다. 그 차이로 가드가 어긋나면
 * 증상은 "스크립트가 아무 일도 안 하고 조용히 끝난다"라 원인을 찾기 어렵다.
 */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;

  const normalize = (path: string): string => resolve(path).replaceAll('\\', '/').toLowerCase();

  return normalize(fileURLToPath(import.meta.url)) === normalize(entry);
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    console.error(`관리자 계정 준비를 끝내지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
    console.error('');
    console.error('계정이 만들어진 뒤에 실패했다면 비밀번호는 이미 아래 파일에 기록돼 있습니다:');
    console.error(`  ${CREDENTIALS_PATH}`);
    console.error('(파일이 없다면 계정도 만들어지지 않은 것입니다 — 그대로 다시 실행하세요.)');
    process.exit(1);
  });
}
