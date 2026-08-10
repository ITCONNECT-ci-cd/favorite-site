/** 공유 계약(계획서 §2.6) 잠금 테스트 — 값 변경은 의존 스토리 전수 확인이 필요하다는 신호. */
import { describe, expect, it } from 'vitest';
import {
  BREAKPOINT_NARROW,
  CLICK_COOLDOWN_MS,
  AI_TOOLS_CATEGORY_NAME,
  CLICK_DAILY_CAP,
  EMPTY_LIST_MESSAGE,
  FAVORITES_TITLE,
  FAVS_KEY,
  NEWS_CATEGORY_NAME,
  OPERATING_CATEGORY_NAME,
  REQUEST_FAILED,
  VISITOR_KEY,
} from '@/lib/constants';

describe('공유 상수', () => {
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

  it('빈 목록 안내 문구가 DESIGN_SPEC 4장 그대로다', () => {
    expect(EMPTY_LIST_MESSAGE).toBe('이 분류에 링크가 없습니다.');
  });

  it('요청 거부 문구가 액션의 RETRY_LATER 와 한 글자도 다르지 않다', () => {
    // `lib/mutations.ts` 는 'use server' 라 상수를 내보낼 수 없어 값을 맞대 볼 수 없다.
    // 그래서 문장을 여기 한 번 더 적어 잠근다 — 한쪽만 고치면 이 테스트가 먼저 걸린다.
    expect(REQUEST_FAILED).toBe('처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  });

  it('화면 이름이 홈 섹션 = 목록 화면 = 탭 그룹 명칭으로 하나다', () => {
    expect(FAVORITES_TITLE).toBe('내 즐겨찾기');
    // 두 번째는 카테고리 판정도 겸하는 위 상수가 그대로 맡는다.
    expect(OPERATING_CATEGORY_NAME).toBe('현재 운영 중인 사이트');
  });

  it('즐겨찾기 묶음 판정이 보는 상위 분류 이름이 실제 분류와 같다', () => {
    // 이 두 값이 실제 분류 이름과 어긋나면 그 분류의 즐겨찾기가 조용히 '업무용 서비스'로
    // 밀린다(lib/fav-groups.ts) — 분류를 개명하면 여기도 함께 고쳐야 한다.
    expect(NEWS_CATEGORY_NAME).toBe('뉴스·인사이트');
    expect(AI_TOOLS_CATEGORY_NAME).toBe('AI 도구 모음');
  });
});
