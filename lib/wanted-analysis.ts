/** The public project snapshot used by the Wanted AI Championship 2026 explorer. */
export type WantedProject = {
  id: number;
  title: string;
  summary: string;
  tags: string[];
  tools: string[];
  participation: 'TEAM' | 'INDIVIDUAL';
  votes: number;
  submittedAt: string;
  detailUrl: string;
  serviceUrl: string | null;
};

export type WantedProjectSnapshot = {
  snapshotAt: string;
  sourceUrl: string;
  projects: WantedProject[];
};

export type WantedFilterOptions = {
  query?: string;
  tag?: string;
  keyword?: string;
  sort?: 'popular' | 'newest' | 'oldest';
};

export type WantedAnalysis = {
  totalProjects: number;
  totalVotes: number;
  zeroVoteProjects: number;
  teamCount: number;
  individualCount: number;
  medianVotes: number;
  /** Percentage of all votes received by the 100 most voted projects. */
  top100VoteShare: number;
  /** A project appears once in each of its tags; percentages can sum above 100. */
  categoryCounts: Array<{
    name: string;
    count: number;
    percent: number;
    totalVotes: number;
    averageVotes: number;
    highVoteCount: number;
  }>;
  voteBuckets: Array<{ label: string; count: number; percent: number }>;
  /** Calendar dates in Asia/Seoul, ascending. */
  dailySubmissions: Array<{ date: string; count: number }>;
  toolCounts: Array<{ name: string; count: number; percent: number }>;
  /** Number of projects mentioning a term in title or summary, not word frequency. */
  keywords: Array<{ keyword: string; count: number; percent: number }>;
};

/**
 * Transparent, fixed dictionary for exploratory text counts. Matching ignores case
 * and finds these literal substrings in title + summary only. This is neither a
 * semantic classification nor a count of how often a word is repeated.
 */
export const WANTED_KEYWORD_RULES: ReadonlyArray<{
  keyword: string;
  terms: readonly string[];
}> = [
  { keyword: '개인화·맞춤', terms: ['개인화', '맞춤', 'personaliz'] },
  { keyword: '추천', terms: ['추천', 'recommend'] },
  { keyword: '관리', terms: ['관리', 'management'] },
  { keyword: '자동화', terms: ['자동화', 'automation', 'automate'] },
  { keyword: '분석', terms: ['분석', 'analytics', 'analysis'] },
  { keyword: '생성', terms: ['생성', 'generation', 'generate'] },
  { keyword: '요약', terms: ['요약', 'summariz', 'summary'] },
  { keyword: '검색', terms: ['검색', 'search'] },
  { keyword: '기록', terms: ['기록', 'logging'] },
  { keyword: '일정', terms: ['일정', '스케줄', 'schedule'] },
  { keyword: '학습·교육', terms: ['학습', '교육', '튜터', 'learning', 'education', 'tutor'] },
  { keyword: '채용·구직', terms: ['채용', '구직', '취업', 'recruit', 'hiring'] },
  { keyword: '면접', terms: ['면접', 'interview'] },
  { keyword: '건강·의료', terms: ['건강', '의료', '진료', 'health', 'medical'] },
  { keyword: '상담', terms: ['상담', 'counseling', 'consultation'] },
  { keyword: '금융', terms: ['금융', '재무', '투자', 'finance', 'financial'] },
  { keyword: '법률·행정', terms: ['법률', '법적', '행정', 'legal'] },
  { keyword: '여행', terms: ['여행', 'travel', 'trip'] },
  { keyword: '안전·보안', terms: ['안전', '보안', 'security', 'safety'] },
  { keyword: '콘텐츠', terms: ['콘텐츠', 'content'] },
  { keyword: '게임', terms: ['게임', 'game'] },
  { keyword: '쇼핑', terms: ['쇼핑', 'shopping'] },
  { keyword: '커뮤니티', terms: ['커뮤니티', 'community'] },
  { keyword: '피드백', terms: ['피드백', 'feedback'] },
];

const voteRanges = [
  { label: '0', test: (votes: number) => votes === 0 },
  { label: '1-4', test: (votes: number) => votes >= 1 && votes <= 4 },
  { label: '5-19', test: (votes: number) => votes >= 5 && votes <= 19 },
  { label: '20-49', test: (votes: number) => votes >= 20 && votes <= 49 },
  { label: '50-99', test: (votes: number) => votes >= 50 && votes <= 99 },
  { label: '100+', test: (votes: number) => votes >= 100 },
] as const;

const seoulDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function percent(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 1000) / 10;
}

function safeVotes(project: WantedProject): number {
  return Number.isFinite(project.votes) && project.votes >= 0 ? project.votes : 0;
}

function searchableText(project: WantedProject): string {
  return `${project.title} ${project.summary}`.normalize('NFC').toLowerCase();
}

function matchesKeyword(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => text.includes(term.toLowerCase()));
}

function seoulCalendarDate(timestamp: string): string | null {
  // Timestamps without an offset represent the source's Korean local date.
  if (/^\d{4}-\d{2}-\d{2}(?:$|[ T])(?!.*(?:Z|[+-]\d{2}:?\d{2})$)/i.test(timestamp)) {
    return timestamp.slice(0, 10);
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;

  const parts = seoulDateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function submissionTime(timestamp: string): number {
  // The source uses offset-aware ISO timestamps. Parse them so sorting also
  // remains correct if a later snapshot mixes UTC and Korean offsets.
  const time = Date.parse(timestamp);
  return Number.isNaN(time) ? 0 : time;
}

export function analyzeWantedProjects(projects: WantedProject[]): WantedAnalysis {
  const totalProjects = projects.length;
  const categoryMap = new Map<string, { count: number; totalVotes: number; highVoteCount: number }>();
  const toolMap = new Map<string, number>();
  const dayMap = new Map<string, number>();
  const keywordMap = new Map<string, number>();
  const bucketCounts = new Map<string, number>(voteRanges.map(({ label }) => [label, 0]));
  const votes = projects.map(safeVotes).sort((a, b) => a - b);
  const totalVotes = votes.reduce((sum, value) => sum + value, 0);
  const zeroVoteProjects = votes.filter((value) => value === 0).length;

  for (const project of projects) {
    const projectVotes = safeVotes(project);
    for (const tag of new Set(project.tags)) {
      const entry = categoryMap.get(tag) ?? { count: 0, totalVotes: 0, highVoteCount: 0 };
      entry.count += 1;
      entry.totalVotes += projectVotes;
      if (projectVotes >= 20) entry.highVoteCount += 1;
      categoryMap.set(tag, entry);
    }

    for (const tool of new Set(project.tools)) {
      toolMap.set(tool, (toolMap.get(tool) ?? 0) + 1);
    }

    const day = seoulCalendarDate(project.submittedAt);
    if (day) dayMap.set(day, (dayMap.get(day) ?? 0) + 1);

    const text = searchableText(project);
    for (const rule of WANTED_KEYWORD_RULES) {
      if (matchesKeyword(text, rule.terms)) {
        keywordMap.set(rule.keyword, (keywordMap.get(rule.keyword) ?? 0) + 1);
      }
    }

    const bucket = voteRanges.find(({ test }) => test(projectVotes));
    if (bucket) bucketCounts.set(bucket.label, (bucketCounts.get(bucket.label) ?? 0) + 1);
  }

  const middle = Math.floor(totalProjects / 2);
  const medianVotes = totalProjects === 0
    ? 0
    : totalProjects % 2 === 1
      ? votes[middle]
      : (votes[middle - 1] + votes[middle]) / 2;
  const top100Votes = votes.slice(-100).reduce((sum, value) => sum + value, 0);

  return {
    totalProjects,
    totalVotes,
    zeroVoteProjects,
    teamCount: projects.filter((project) => project.participation === 'TEAM').length,
    individualCount: projects.filter((project) => project.participation === 'INDIVIDUAL').length,
    medianVotes,
    top100VoteShare: percent(top100Votes, totalVotes),
    categoryCounts: [...categoryMap].map(([name, values]) => ({
      name,
      count: values.count,
      percent: percent(values.count, totalProjects),
      totalVotes: values.totalVotes,
      averageVotes: values.count === 0 ? 0 : Math.round((values.totalVotes / values.count) * 10) / 10,
      highVoteCount: values.highVoteCount,
    })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko')),
    voteBuckets: voteRanges.map(({ label }) => ({
      label,
      count: bucketCounts.get(label) ?? 0,
      percent: percent(bucketCounts.get(label) ?? 0, totalProjects),
    })),
    dailySubmissions: [...dayMap].map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    toolCounts: [...toolMap].map(([name, count]) => ({
      name,
      count,
      percent: percent(count, totalProjects),
    })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko')),
    keywords: [...keywordMap].map(([keyword, count]) => ({
      keyword,
      count,
      percent: percent(count, totalProjects),
    })).sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword, 'ko')),
  };
}

export function filterWantedProjects(
  projects: WantedProject[],
  { query = '', tag = '', keyword = '', sort = 'popular' }: WantedFilterOptions = {},
): WantedProject[] {
  const normalizedQuery = query.trim().normalize('NFC').toLowerCase();
  const normalizedKeyword = keyword.trim().normalize('NFC').toLowerCase();
  const keywordRule = WANTED_KEYWORD_RULES.find((rule) => rule.keyword.toLowerCase() === normalizedKeyword);
  const filtered = projects.filter((project) => {
    if (tag && !project.tags.includes(tag)) return false;
    const text = searchableText(project);
    if (normalizedQuery && !text.includes(normalizedQuery)) return false;
    if (normalizedKeyword && !(keywordRule
      ? matchesKeyword(text, keywordRule.terms)
      : text.includes(normalizedKeyword))) return false;
    return true;
  });

  // Sorting a copy keeps the shared snapshot in its original order.
  return filtered.sort((a, b) => {
    const newestFirst = submissionTime(b.submittedAt) - submissionTime(a.submittedAt);
    if (sort === 'newest') return newestFirst || b.id - a.id;
    if (sort === 'oldest') return -newestFirst || a.id - b.id;
    return safeVotes(b) - safeVotes(a) || newestFirst || b.id - a.id;
  });
}
