import { describe, expect, it } from 'vitest';

import { ENRICHMENTS } from './enrich-data';

const EXPECTED = [
  {
    url: 'https://jiinsi.com/',
    title: '지인시',
    description: 'AI 기술·경제·논문 소식을 매일 큐레이션하는 뉴스레터',
    category: '뉴스·인사이트 > AI 뉴스',
  },
  {
    url: 'https://content.itconnect.dev/',
    title: 'AI 콘텐츠 자동 생성',
    description: 'AI로 콘텐츠 기획과 제작을 자동화하는 서비스 · 개발 중',
    category: '현재 운영 중인 사이트',
  },
  {
    url: 'https://landingmaker.biz/',
    title: 'LandingMaker',
    description: 'AI로 페이지를 기획하고 제작 프로세스를 관리하는 서비스 · 개발 중',
    category: '현재 운영 중인 사이트',
  },
  {
    url: 'https://itconnect.co.kr/',
    title: 'AI 사업계획서 작성',
    description: 'AI와 함께 사업계획서를 단계별로 완성하는 서비스 · 개발 중',
    category: '현재 운영 중인 사이트',
  },
] as const;

describe('운영 사이트 교정표', () => {
  it.each(EXPECTED)('$url의 제목·소개·분류를 고정한다', (expected) => {
    expect(ENRICHMENTS.filter((entry) => entry.url === expected.url)).toEqual([expected]);
  });

  it('추가·수정한 소개는 카드의 42자 예산을 지킨다', () => {
    for (const expected of EXPECTED) {
      expect([...expected.description].length).toBeGreaterThan(0);
      expect([...expected.description].length).toBeLessThanOrEqual(42);
    }
  });
});
