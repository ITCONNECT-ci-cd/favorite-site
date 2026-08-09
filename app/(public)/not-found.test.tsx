import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import PublicNotFound from '@/app/(public)/not-found';

/**
 * 공개 그룹의 404 — `notFound()` 를 부른 화면(지금은 없는 분류 id 하나)이 여기로 떨어진다.
 *
 * 셸(사이드바·헤더)에 감싸이는지는 여기서 볼 수 없다. 그건 파일이 `app/(public)/` 안에
 * 있다는 사실이 정하고, 실제 확인은 프로덕션 빌드 실측이 했다 — 그 절차와 결과는
 * `docs/superpowers/plans/2026-08-09-link-dashboard-full-plan.md` 의 **H2 항목**에 있다
 * (`GET /category/<없는 id>` 선행 실측 → 셸 안 한국어 404 신설).
 * 이 테스트가 지키는 것은 **화면이 한국어로 무엇을 말하고 어디로 보내는가**다.
 */
describe('공개 404 화면', () => {
  it('무엇이 없는지 한국어로 알린다', () => {
    render(<PublicNotFound />);

    expect(screen.getByRole('heading', { name: '찾을 수 없는 분류입니다' })).toBeInTheDocument();
    expect(screen.getByText('주소가 바뀌었거나 지워진 분류입니다.')).toBeInTheDocument();
  });

  it('막다른 길로 두지 않는다 — 홈으로 가는 링크가 있다', () => {
    render(<PublicNotFound />);

    expect(screen.getByRole('link', { name: '홈으로 돌아가기' })).toHaveAttribute('href', '/');
  });

  it('빈 상태와 같은 점선 박스를 쓴다 (EmptyBox)', () => {
    const { container } = render(<PublicNotFound />);

    expect(container.querySelector('.border-dashed')).not.toBeNull();
  });

  /**
   * 셸의 계약 — 콘텐츠 영역은 `flex flex-col` 이고, 화면 루트가 `flex-1` 을 들어야 안내가
   * 세로 가운데에 선다(app/(public)/layout.tsx 의 "화면과의 계약").
   */
  it('셸의 세로 채움 계약을 따른다', () => {
    const { container } = render(<PublicNotFound />);

    expect(container.querySelector('main')).toHaveClass('flex-1');
  });

  /** 셸이 이미 데이터를 읽었다 — 404 화면이 조회를 한 번 더 만들면 안 된다. */
  it('스스로 데이터를 조회하지 않는다', () => {
    const source = readFileSync(join(process.cwd(), 'app/(public)/not-found.tsx'), 'utf8');

    expect(source).not.toContain('@/lib/queries');
  });
});
