// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  analyzeWantedProjects,
  filterWantedProjects,
  WANTED_KEYWORD_RULES,
  type WantedProject,
} from '@/lib/wanted-analysis';

function project(id: number, values: Partial<WantedProject> = {}): WantedProject {
  return {
    id,
    title: `과제 ${id}`,
    summary: '',
    tags: [],
    tools: [],
    participation: 'INDIVIDUAL',
    votes: 0,
    submittedAt: '2026-09-20T00:00:00+09:00',
    detailUrl: `https://example.com/${id}`,
    serviceUrl: null,
    ...values,
  };
}

describe('analyzeWantedProjects', () => {
  it('다중 태그는 각 태그에 한 번씩 세고 투표 구간의 경계를 정확히 나눈다', () => {
    const projects = [
      project(1, { votes: 0, tags: ['교육', '게임', '교육'], tools: ['React', 'React'] }),
      project(2, { votes: 4, tags: ['교육'], tools: ['React'] }),
      project(3, { votes: 19, tags: ['게임'] }),
      project(4, { votes: 20, tags: ['교육'], participation: 'TEAM' }),
      project(5, { votes: 50, tags: ['게임'], participation: 'TEAM' }),
      project(6, { votes: 100, tags: ['교육'], participation: 'TEAM' }),
    ];

    const result = analyzeWantedProjects(projects);
    expect(result.totalProjects).toBe(6);
    expect(result.totalVotes).toBe(193);
    expect(result.zeroVoteProjects).toBe(1);
    expect(result.medianVotes).toBe(19.5);
    expect(result.teamCount).toBe(3);
    expect(result.individualCount).toBe(3);
    expect(result.voteBuckets.map(({ label, count }) => [label, count])).toEqual([
      ['0', 1], ['1-4', 1], ['5-19', 1], ['20-49', 1], ['50-99', 1], ['100+', 1],
    ]);
    expect(result.categoryCounts).toEqual([
      { name: '교육', count: 4, percent: 66.7, totalVotes: 124, averageVotes: 31, highVoteCount: 2 },
      { name: '게임', count: 3, percent: 50, totalVotes: 69, averageVotes: 23, highVoteCount: 1 },
    ]);
    expect(result.toolCounts).toEqual([{ name: 'React', count: 2, percent: 33.3 }]);
    expect(result.categoryCounts.reduce((sum, item) => sum + item.count, 0)).toBe(7);
  });

  it('키워드는 제목·요약에서 과제별 언급만 세며 도구·태그에서는 찾지 않는다', () => {
    const result = analyzeWantedProjects([
      project(1, { title: '맞춤 추천 추천', summary: '추천 기능', tags: ['분석'], tools: ['추천'] }),
      project(2, { title: '기록 도구', summary: '개인화 분석 추천', tags: ['교육'] }),
      project(3, { title: '다른 서비스', summary: '', tags: ['추천', '분석'] }),
    ]);

    expect(result.keywords.find(({ keyword }) => keyword === '추천')).toEqual({ keyword: '추천', count: 2, percent: 66.7 });
    expect(result.keywords.find(({ keyword }) => keyword === '개인화·맞춤')?.count).toBe(2);
    expect(result.keywords.find(({ keyword }) => keyword === '분석')?.count).toBe(1);
    expect(WANTED_KEYWORD_RULES.find(({ keyword }) => keyword === '추천')?.terms).toContain('추천');
  });

  it('제출 시각은 한국 달력 날짜로 묶고 상위 100개 투표 점유율을 계산한다', () => {
    const projects = Array.from({ length: 100 }, (_, index) => project(index + 1, { votes: 1 }));
    projects.push(project(101, { votes: 10, submittedAt: '2026-09-19T15:30:00Z' }));

    const result = analyzeWantedProjects(projects);
    expect(result.totalVotes).toBe(110);
    expect(result.top100VoteShare).toBe(99.1);
    expect(result.dailySubmissions).toEqual([{ date: '2026-09-20', count: 101 }]);
  });

  it('빈 자료에서는 비율이 NaN이 되지 않는다', () => {
    const result = analyzeWantedProjects([]);
    expect(result.totalProjects).toBe(0);
    expect(result.medianVotes).toBe(0);
    expect(result.top100VoteShare).toBe(0);
    expect(result.voteBuckets.every(({ count, percent }) => count === 0 && percent === 0)).toBe(true);
  });
});

describe('filterWantedProjects', () => {
  const projects = [
    project(1, { title: '맞춤 식단', summary: '건강 추천 추천', tags: ['푸드'], votes: 20, submittedAt: '2026-09-19T10:00:00+09:00' }),
    project(2, { title: '금융 안내', summary: '추천 정보', tags: ['금융'], votes: 30, submittedAt: '2026-09-20T10:00:00+09:00' }),
    project(3, { title: '식단 기록', summary: '맞춤 추천', tags: ['푸드'], votes: 20, submittedAt: '2026-09-20T11:00:00+09:00' }),
  ];

  it('검색·태그·키워드를 함께 적용하고 원본 배열을 바꾸지 않는다', () => {
    const originalOrder = projects.map(({ id }) => id);
    expect(filterWantedProjects(projects, { query: '식단', tag: '푸드', keyword: '추천' }).map(({ id }) => id))
      .toEqual([3, 1]);
    expect(filterWantedProjects(projects, { query: '금융', tag: '푸드' })).toEqual([]);
    expect(projects.map(({ id }) => id)).toEqual(originalOrder);
  });

  it('인기순은 득표와 최신 제출 시각으로 정렬하고 날짜순 양방향을 지원한다', () => {
    expect(filterWantedProjects(projects).map(({ id }) => id)).toEqual([2, 3, 1]);
    expect(filterWantedProjects(projects, { sort: 'newest' }).map(({ id }) => id)).toEqual([3, 2, 1]);
    expect(filterWantedProjects(projects, { sort: 'oldest' }).map(({ id }) => id)).toEqual([1, 2, 3]);
  });

  it('서로 다른 시각대의 제출 시각도 실제 시간 순서로 정렬한다', () => {
    const offsets = [
      project(1, { submittedAt: '2026-09-20T10:00:00+09:00' }),
      project(2, { submittedAt: '2026-09-20T02:00:00Z' }),
    ];
    expect(filterWantedProjects(offsets, { sort: 'newest' }).map(({ id }) => id)).toEqual([2, 1]);
  });
});
