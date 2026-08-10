/**
 * **지금 프로덕션이 이 커밋을 실행하고 있는가.**
 *
 * ```
 * npm run verify:deploy                       # HEAD 가 붙을 때까지 기다린다
 * npm run verify:deploy -- <sha>              # 특정 커밋으로
 * npm run verify:deploy -- --url https://…    # 다른 도메인으로
 * ```
 *
 * ## 왜 있는가
 *
 * 2026-08-10, `main` push → Vercel 빌드 `success` 인데 도메인은 두 배포 전 코드를 계속 실행했다.
 * 그때 "배포됐다"의 근거로 **링크 개수**를 봤던 것이 문제였다 — 데이터는 어느 빌드든 같은 라이브
 * DB 를 읽으므로 **옛 코드에서도 최신 숫자가 나온다.** 간접 신호로는 이 사고를 영영 못 잡는다.
 *
 * 그래서 코드 자신에게 묻는다(`app/api/version/route.ts`). 붙을 때까지 기다리다가 시간이 다 되면
 * **실패로 끝내고**(exit 1) 무엇을 확인해야 하는지 알려 준다 — 조용히 성공하지 않는 것이 요점이다.
 *
 * ## 판정
 *
 * 응답의 `sha` 가 대상 커밋과 같으면 성공. `sha` 가 null 이면 Vercel 밖(로컬 `next start` 등)이라
 * 판정할 수 없으므로 **성공이라고 하지 않는다** — 모르는 것을 안다고 말하지 않는다.
 */
import { execFileSync } from 'node:child_process';

/** 기본 대상. `--url` 로 덮을 수 있다. */
const DEFAULT_ORIGIN = 'https://favorite.itconnect.dev';

/** 한 번 물어보고 다음까지 기다리는 시간. Vercel 빌드가 대개 1~2분이라 이 간격이면 넉넉하다. */
const INTERVAL_MS = 15_000;

/** 여기까지 기다려도 안 붙으면 사람 손이 필요한 상태로 본다. */
const TIMEOUT_MS = 5 * 60_000;

type Version = { sha: string | null; ref: string | null; deploymentId: string | null };

function argOf(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);

  return index === -1 ? undefined : process.argv[index + 1];
}

/** `--url` 도 `--`로 시작하는 값도 아닌 첫 인자 = 확인할 커밋. */
function positional(): string | undefined {
  const args = process.argv.slice(2);

  return args.find((arg, index) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--'));
}

function headSha(): string {
  // `execFile` 형태다 — 셸을 거치지 않으므로 인자에 무엇이 들어와도 명령이 되지 않는다.
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

async function askVersion(origin: string): Promise<Version | { error: string }> {
  try {
    const res = await fetch(`${origin}/api/version`, {
      cache: 'no-store',
      headers: { 'cache-control': 'no-cache' },
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };

    return (await res.json()) as Version;
  } catch (error) {
    return { error: String((error as { cause?: { code?: string } })?.cause?.code ?? error) };
  }
}

const short = (sha: string) => sha.slice(0, 7);

async function main(): Promise<void> {
  const origin = (argOf('url') ?? DEFAULT_ORIGIN).replace(/\/$/, '');
  const target = positional() ?? headSha();

  console.log(`대상 커밋 ${short(target)} · 도메인 ${origin}`);

  const deadline = Date.now() + TIMEOUT_MS;
  let attempt = 0;
  let last: Version | { error: string } | null = null;

  while (Date.now() < deadline) {
    attempt += 1;
    last = await askVersion(origin);

    if ('error' in last) {
      console.log(`  ${attempt}회 · 응답 없음 (${last.error})`);
    } else if (last.sha === null) {
      // Vercel 밖에서 돌고 있다 — 여기서는 "맞다/아니다"를 말할 수 없다.
      console.error(
        `\n❌ ${origin} 이 Vercel 배포가 아니다(sha 가 비어 있다). 로컬 서버를 보고 있지 않은지 확인해라.`,
      );
      process.exitCode = 1;

      return;
    } else if (last.sha === target) {
      console.log(`  ${attempt}회 · ${short(last.sha)} ✅`);
      console.log(`\n✅ 프로덕션이 ${short(target)} 를 실행 중이다 (배포 ${last.deploymentId ?? '?'}).`);

      return;
    } else {
      console.log(`  ${attempt}회 · 아직 ${short(last.sha)} (기다리는 중)`);
    }

    if (Date.now() + INTERVAL_MS >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }

  const serving = last !== null && !('error' in last) && last.sha !== null ? short(last.sha) : '알 수 없음';
  console.error(`\n❌ ${Math.round(TIMEOUT_MS / 60_000)}분을 기다려도 ${short(target)} 가 붙지 않았다.`);
  console.error(`   지금 서빙 중인 커밋: ${serving}`);
  console.error('\n   빌드가 성공했는데 이 상태라면 도메인이 최신 배포를 안 가리키는 것이다. 확인할 곳:');
  console.error('   1. Vercel → Deployments — 최신 배포에 Current 가 붙어 있는가 (승격 대기 중인가)');
  console.error('   2. Vercel → Settings → Domains — 도메인이 특정 배포에 고정돼 있는가');
  console.error('   3. 빌드 자체는 `gh api repos/<owner>/<repo>/deployments` + `/statuses` 로 볼 수 있다');
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
