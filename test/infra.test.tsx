import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

/** 테스트 인프라(jsdom + React 렌더링 + jest-dom 매처) 동작 확인용 스모크 테스트. */
describe('테스트 인프라', () => {
  it('React 컴포넌트를 jsdom에 렌더링하고 jest-dom 매처를 쓸 수 있다', () => {
    render(<h1>링크 대시보드</h1>);

    expect(screen.getByRole('heading', { name: '링크 대시보드' })).toBeInTheDocument();
  });
});
