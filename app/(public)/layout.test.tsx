/**
 * 공개 셸의 **동작** 계약 — 헤더가 관리자 상태를 어떻게 알리는가 (J1).
 *
 * 셸의 뼈대 수치(사이드바 240px·헤더 60px·본문 패딩 등)는 `test/shell-structure.test.ts` 가
 * 소스 문자열로 잠근다. 여기서는 그 방식으로는 볼 수 없는 것 — 서버가 읽은 세션이 실제로
 * 헤더까지 흘러 칩이 나타나고 사라지는지 — 만 본다.
 *
 * 라우트 그룹 분리(H2) 이후 이 레이아웃은 `<html>` 을 렌더하지 않으므로 RTL 로 그릴 수 있다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PublicLayout from '@/app/(public)/layout';
import { getAdminSession } from '@/lib/supabase/server';
import type { SiteData } from '@/lib/types';
import { adminSession } from '@/test/admin-session';
import { siteData } from '@/test/fixtures/seed';

const getAllData = vi.hoisted(() => vi.fn());

vi.mock('@/lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queries')>()),
  getAllData,
}));

// 인증 관문(H1)의 결과에 따라 셸이 무엇을 그리는지만 본다 — 판정은 그 파일의 테스트 몫이다.
vi.mock('@/lib/supabase/server', () => ({ getAdminSession: vi.fn() }));

/**
 * GA 컴포넌트는 `next/script` 로 스크립트를 얹기만 하고 마크업을 남기지 않아 jsdom 에서는
 * 렌더 결과로 확인할 수 없다. 받은 측정 ID 를 속성으로 드러내는 스텁으로 바꿔 배선만 본다.
 */
vi.mock('@next/third-parties/google', () => ({
  GoogleAnalytics: ({ gaId }: { gaId: string }) => (
    <div data-testid="google-analytics" data-ga-id={gaId} />
  ),
}));

const CHILD = '화면 본문';

/** async 서버 컴포넌트라 먼저 실행해 element 를 받는다 (admin 레이아웃 테스트와 같은 방식). */
async function renderShell() {
  const element = (await PublicLayout({
    children: <p>{CHILD}</p>,
    params: Promise.resolve({}),
  })) as ReactElement;

  return render(element);
}

const chip = () => screen.queryByText('관리자 편집 모드');

beforeEach(() => {
  localStorage.clear();
  getAllData.mockReset();
  getAllData.mockResolvedValue(siteData() satisfies SiteData);
  vi.mocked(getAdminSession).mockReset();
  vi.mocked(getAdminSession).mockResolvedValue(null);
});

describe('공개 셸 — 관리자 편집 모드 칩 (J1)', () => {
  it('비로그인 렌더에는 칩이 없다 — 문구 자체가 응답에 실리지 않는다', async () => {
    const { container } = await renderShell();

    expect(chip()).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain('관리자 편집 모드');
  });

  it('관리자 세션이면 헤더에 칩을 하나 그린다', async () => {
    vi.mocked(getAdminSession).mockResolvedValue(adminSession);

    await renderShell();

    expect(chip()).toBeInTheDocument();
    expect(screen.getAllByText('관리자 편집 모드')).toHaveLength(1);
  });

  it('칩은 헤더 자리 안에 있다 — 본문이 아니라 셸이 든다', async () => {
    vi.mocked(getAdminSession).mockResolvedValue(adminSession);

    const { container } = await renderShell();

    expect(container.querySelector('header')).toContainElement(chip());
  });

  it('세션 판정은 getAdminSession 하나로만 한다 — 요청당 한 번', async () => {
    await renderShell();

    expect(getAdminSession).toHaveBeenCalledTimes(1);
  });

  it('children 은 세션과 무관하게 그대로 그린다', async () => {
    await renderShell();

    expect(screen.getByText(CHILD)).toBeInTheDocument();
  });
});

/**
 * 두 왕복(DB · Auth)은 나란히 떠나고, 실패는 서로 다른 결말을 갖는다.
 *
 * 셸을 그릴 데이터가 없으면 화면이 아예 서지 않으므로 오류 화면으로 갈아탄다. 반면 인증
 * 왕복이 실패한 것은 "관리자임을 확인하지 못했다"일 뿐이라 셸은 그대로 서고 비관리자로
 * 그린다 — 게이트의 fail-closed 와 같은 방향이다(lib/supabase/server.ts).
 */
describe('공개 셸 — 두 조회의 실패 경로', () => {
  /** 원문은 서버 로그로만 나가는 것이 계약이라 삼키고 호출만 본다. */
  function silenceError() {
    return vi.spyOn(console, 'error').mockImplementation(() => {});
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('세션 조회가 실패해도 셸은 선다 — 칩만 없다', async () => {
    const error = silenceError();
    vi.mocked(getAdminSession).mockRejectedValue(new Error('auth 왕복 실패'));

    const { container } = await renderShell();

    expect(container.querySelector('header')).toBeInTheDocument();
    expect(screen.getByText(CHILD)).toBeInTheDocument();
    expect(chip()).not.toBeInTheDocument();
    expect(error).toHaveBeenCalled();
  });

  it('데이터 조회가 실패하면 오류 화면으로 갈아탄다', async () => {
    silenceError();
    getAllData.mockRejectedValue(new Error('DB 왕복 실패'));

    await renderShell();

    expect(screen.getByRole('heading', { name: '일시적인 오류가 발생했습니다' })).toBeInTheDocument();
    expect(screen.queryByText(CHILD)).not.toBeInTheDocument();
  });

  /**
   * 오류 경로는 이미 떠난 세션 프라미스를 await 하지 않고 반환한다. 거기에 핸들러가 없으면
   * unhandled rejection 이 되어 런타임에 따라 프로세스가 죽는다 — 그래서 `.catch` 는 프라미스를
   * **만드는 즉시** 붙어 있어야 한다. 이 테스트는 그 catch 가 떨어져 나가는 회귀를 잡는다.
   */
  it('둘 다 실패해도 터지지 않는다 — 버려지는 세션 왕복에도 핸들러가 붙어 있다', async () => {
    silenceError();
    getAllData.mockRejectedValue(new Error('DB 왕복 실패'));
    vi.mocked(getAdminSession).mockRejectedValue(new Error('auth 왕복 실패'));

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
      await renderShell();
      // 마이크로태스크가 다 돌 때까지 기다린다 — 핸들러 없는 거부는 이 시점에 보고된다.
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }

    expect(unhandled).toEqual([]);
    expect(screen.getByRole('heading', { name: '일시적인 오류가 발생했습니다' })).toBeInTheDocument();
  });
});

/**
 * Google Analytics (2026-08-11) — 방문자 분석은 **공개 화면만** 센다.
 *
 * 배선을 이 셸에 두는 것 자체가 그 경계다. `(public)` 그룹만 이 레이아웃을 상속하므로
 * 관리 라우트(`app/admin/*`)는 자동으로 빠진다 — 별도 제외 처리가 없다.
 */
describe('공개 셸 — Google Analytics', () => {
  it('측정 ID 를 실어 보낸다', async () => {
    await renderShell();

    // 진짜 컴포넌트는 `next/script` 로 스크립트를 얹으므로 jsdom 에는 아무 마크업도 남기지
    // 않는다(Next 런타임 밖이라 그 부수효과가 돌지 않는다). 그래서 스텁으로 바꿔 **셸이 어떤
    // 측정 ID 로 그 컴포넌트를 세우는지**를 본다 — 여기서 볼 수 있는 것은 그 배선뿐이고,
    // 실제로 gtag 가 붙는지는 배포 뒤 GA 실시간 보고서로 확인한다.
    expect(screen.getByTestId('google-analytics')).toHaveAttribute('data-ga-id', 'G-6F5JFJX448');
  });

  /**
   * 루트 레이아웃(app/layout.tsx)으로 옮기면 `/admin` 까지 집계에 들어와 방문자 수치가 관리
   * 작업으로 부푼다. "공개 화면만"이라는 결정이 파일 위치 하나에 걸려 있어 눈에 안 띄게
   * 깨질 수 있으므로 소스에서 잠근다(app/not-found.test.tsx 와 같은 방식).
   */
  it('루트 레이아웃에는 두지 않는다 — 관리 화면이 집계에 섞이지 않게', () => {
    const source = readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(source).not.toContain('GoogleAnalytics');
    expect(source).not.toContain('G-');
  });
});
