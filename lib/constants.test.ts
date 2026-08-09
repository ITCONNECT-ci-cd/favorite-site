/** 공유 계약(계획서 §2.6) 잠금 테스트 — 값 변경은 의존 스토리 전수 확인이 필요하다는 신호. */
import { describe, expect, it } from 'vitest';
import {
  BREAKPOINT_NARROW,
  CLICK_COOLDOWN_MS,
  CLICK_DAILY_CAP,
  DAILY_PIN_MAX,
  FAVS_KEY,
  OPERATING_CATEGORY_NAME,
  VISITOR_KEY,
} from '@/lib/constants';

describe('공유 상수', () => {
  it('오늘의 고정 링크 최대 개수는 12개다', () => {
    expect(DAILY_PIN_MAX).toBe(12);
  });

  it('클릭 집계 쿨다운은 30초, 방문자별 일일 상한은 10회다', () => {
    expect(CLICK_COOLDOWN_MS).toBe(30_000);
    expect(CLICK_DAILY_CAP).toBe(10);
  });

  it('운영 중 카테고리 이름과 localStorage 키가 계약대로다', () => {
    expect(OPERATING_CATEGORY_NAME).toBe('현재 운영 중인 사이트');
    expect(FAVS_KEY).toBe('linkdash:favs');
    expect(VISITOR_KEY).toBe('linkdash:visitor');
  });

  it('좁은 화면 분기점은 820px이다', () => {
    expect(BREAKPOINT_NARROW).toBe(820);
  });
});
