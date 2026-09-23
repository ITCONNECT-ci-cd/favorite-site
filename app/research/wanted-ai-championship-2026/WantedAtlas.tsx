'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import {
  filterWantedProjects,
  type WantedProject,
  type analyzeWantedProjects,
} from '@/lib/wanted-analysis';

import styles from './page.module.css';

type WantedAtlasProps = {
  projects: WantedProject[];
  analysis: ReturnType<typeof analyzeWantedProjects>;
  snapshotAt: string;
  sourceUrl: string;
};

const formatNumber = (value: number) => new Intl.NumberFormat('ko-KR').format(value);
const formatPercent = (value: number) => `${value.toFixed(1)}%`;

function formatSnapshot(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatMonthDay(value: string | undefined) {
  if (!value) return '제출일 없음';
  return `${Number(value.slice(5, 7))}월 ${Number(value.slice(8, 10))}일`;
}

function ArrowIcon() {
  return <span aria-hidden="true">↗</span>;
}

export function WantedAtlas({ projects, analysis, snapshotAt, sourceUrl }: WantedAtlasProps) {
  const [activeTag, setActiveTag] = useState('');
  const [secondTag, setSecondTag] = useState('');
  const [activeKeyword, setActiveKeyword] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'popular' | 'newest' | 'oldest'>('popular');
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [visibleCount, setVisibleCount] = useState(18);

  const visibleCategories = showAllCategories
    ? analysis.categoryCounts
    : analysis.categoryCounts.slice(0, 11);
  const maxCategoryCount = analysis.categoryCounts[0]?.count ?? 1;
  const maxBucketCount = Math.max(...analysis.voteBuckets.map((bucket) => bucket.count), 1);
  const topProjects = useMemo(
    () => [...projects].sort((a, b) => b.votes - a.votes || a.id - b.id).slice(0, 5),
    [projects],
  );
  const tagPairs = useMemo(() => {
    const counts = new Map<string, { first: string; second: string; count: number }>();
    for (const project of projects) {
      const tags = [...new Set(project.tags)].sort((a, b) => a.localeCompare(b, 'ko'));
      for (let i = 0; i < tags.length; i += 1) {
        for (let j = i + 1; j < tags.length; j += 1) {
          const key = `${tags[i]}\u0000${tags[j]}`;
          const pair = counts.get(key) ?? { first: tags[i], second: tags[j], count: 0 };
          pair.count += 1;
          counts.set(key, pair);
        }
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.first.localeCompare(b.first, 'ko')).slice(0, 6);
  }, [projects]);
  const filteredProjects = useMemo(() => {
    const primary = filterWantedProjects(projects, {
      query,
      tag: activeTag,
      keyword: activeKeyword,
      sort,
    });
    return secondTag ? primary.filter((project) => project.tags.includes(secondTag)) : primary;
  }, [projects, query, activeTag, secondTag, activeKeyword, sort]);
  const visibleProjects = filteredProjects.slice(0, visibleCount);
  const lastSubmissionDay = analysis.dailySubmissions.at(-1);
  const teamPercent = (analysis.teamCount / analysis.totalProjects) * 100;
  const zeroPercent = (analysis.zeroVoteProjects / analysis.totalProjects) * 100;
  const hasFilters = Boolean(activeTag || secondTag || activeKeyword || query);

  function chooseTag(tag: string) {
    setActiveTag((current) => (current === tag ? '' : tag));
    setSecondTag('');
    setVisibleCount(18);
    document.getElementById('explore')?.scrollIntoView();
  }

  function chooseKeyword(keyword: string) {
    setActiveKeyword((current) => (current === keyword ? '' : keyword));
    setVisibleCount(18);
    document.getElementById('explore')?.scrollIntoView();
  }

  function clearFilters() {
    setActiveTag('');
    setSecondTag('');
    setActiveKeyword('');
    setQuery('');
    setVisibleCount(18);
  }

  function choosePair(first: string, second: string) {
    setActiveTag(first);
    setSecondTag(second);
    setActiveKeyword('');
    setQuery('');
    setVisibleCount(18);
    document.getElementById('explore')?.scrollIntoView();
  }

  return (
    <div className={styles.atlas}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.wordmark} aria-label="내 링크 홈으로 이동">
          <span className={styles.wordmarkGlyph} aria-hidden="true">F.</span>
          <span>내 링크</span>
        </Link>
        <span className={styles.topbarLabel}>RESEARCH NOTE&nbsp; / &nbsp;2026.09</span>
        <a className={styles.topbarLink} href="#explore">
          전체 과제 탐색 <span aria-hidden="true">↓</span>
        </a>
      </header>

      <main>
        <section className={styles.hero} aria-labelledby="atlas-title">
          <div className={styles.heroGrid} aria-hidden="true" />
          <div className={styles.heroInner}>
            <div className={styles.heroCopy}>
              <p className={styles.heroEyebrow}>
                <span className={styles.signalDot} />
                원티드 AI Championship 2026 · 공개 과제 분석
              </p>
              <h1 id="atlas-title" className={styles.heroTitle}>
                사람들은 지금<br />
                <em>무엇을 만들고 있을까?</em>
              </h1>
              <p className={styles.heroLead}>
                1,391개의 공개 과제를 주제와 키워드로 읽고,
                어떤 문제가 많이 등장했는지, 어떤 과제가 주목받았는지 살펴봅니다.
              </p>
              <div className={styles.heroActions}>
                <a className={styles.heroPrimary} href="#landscape">
                  데이터 살펴보기 <span aria-hidden="true">↘</span>
                </a>
                <a className={styles.heroSecondary} href="#ideas">
                  아이디어 인사이트 보기 <span aria-hidden="true">→</span>
                </a>
              </div>
            </div>
            <div className={styles.heroFigure} aria-label={`분석 과제 ${formatNumber(analysis.totalProjects)}건`}>
              <span className={styles.figureTop}>PUBLIC PROJECTS / 2026</span>
              <strong>{formatNumber(analysis.totalProjects)}</strong>
              <span className={styles.figureBottom}>
                <span>개의 공개 과제</span>
                <span>{analysis.categoryCounts.length} TOPICS · 1 SNAPSHOT</span>
              </span>
            </div>
          </div>
          <div className={styles.heroFooter}>
            <span>자료 수집 시점 · {formatSnapshot(snapshotAt)}</span>
            <span>제출자가 작성한 공개 정보 기반</span>
          </div>
        </section>

        <div className={styles.content}>
          <section className={styles.metricStrip} aria-label="한눈에 보는 데이터">
            <div className={styles.metric}>
              <span className={styles.metricLabel}>공개 과제</span>
              <strong>{formatNumber(analysis.totalProjects)}</strong>
              <span>고유 과제 ID 기준</span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>주제 태그</span>
              <strong>{analysis.categoryCounts.length}</strong>
              <span>과제당 1~3개 선택</span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>공개 투표</span>
              <strong>{formatNumber(analysis.totalVotes)}</strong>
              <span>수집 시점 합계</span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>0표 과제</span>
              <strong>{formatPercent(zeroPercent)}</strong>
              <span>{formatNumber(analysis.zeroVoteProjects)}건</span>
            </div>
          </section>

          <section id="landscape" className={styles.section} aria-labelledby="landscape-title">
            <div className={styles.sectionHead}>
              <div>
                <p className={styles.sectionIndex}>01 / THE LANDSCAPE</p>
                <h2 id="landscape-title">어떤 주제가 많았을까</h2>
              </div>
              <p className={styles.sectionHeadNote}>
                태그는 여러 개 선택할 수 있습니다. 비율의 분모는 과제 1,391건입니다.
              </p>
            </div>
            <div className={styles.landscapeGrid}>
              <div className={styles.chartPanel}>
                <div className={styles.panelHead}>
                  <div>
                    <span className={styles.panelKicker}>CATEGORY SIGNAL</span>
                    <h3>주제별 제출 규모</h3>
                  </div>
                  <span className={styles.panelSub}>막대를 누르면 해당 과제를 볼 수 있습니다</span>
                </div>
                <ol className={styles.categoryChart}>
                  {visibleCategories.map((category, index) => (
                    <li key={category.name}>
                      <button
                        type="button"
                        className={`${styles.categoryRow} ${activeTag === category.name ? styles.categoryRowActive : ''}`}
                        onClick={() => chooseTag(category.name)}
                        aria-pressed={activeTag === category.name}
                        aria-label={`${category.name} ${category.count}건, 전체의 ${formatPercent(category.percent)}. 과제 보기`}
                      >
                        <span className={styles.categoryRank}>{String(index + 1).padStart(2, '0')}</span>
                        <span className={styles.categoryName}>{category.name}</span>
                        <span className={styles.categoryTrack} aria-hidden="true">
                          <span style={{ width: `${(category.count / maxCategoryCount) * 100}%` }} />
                        </span>
                        <strong>{category.count}</strong>
                        <span className={styles.categoryPercent}>{formatPercent(category.percent)}</span>
                      </button>
                    </li>
                  ))}
                </ol>
                <button
                  type="button"
                  className={styles.panelTextButton}
                  onClick={() => setShowAllCategories((value) => !value)}
                  aria-expanded={showAllCategories}
                >
                  {showAllCategories ? '상위 주제만 보기' : '22개 주제 모두 보기'}
                  <span aria-hidden="true">{showAllCategories ? '↑' : '↓'}</span>
                </button>
              </div>

              <div className={styles.sideStack}>
                <div className={styles.noteCard}>
                  <span className={styles.noteNumber}>01</span>
                  <p className={styles.noteEyebrow}>가장 많이 등장한 영역</p>
                  <h3>일을 더 잘하거나,<br />배움을 더 깊게.</h3>
                  <p>
                    업무생산성·협업 {analysis.categoryCounts[0]?.count ?? 0}건과
                    교육·학습 {analysis.categoryCounts[1]?.count ?? 0}건이 가장 큰 주제입니다.
                    이는 사람들이 제출한 아이디어의 분포이며 시장 수요 조사는 아닙니다.
                  </p>
                </div>
                <div className={styles.keywordPanel}>
                  <div className={styles.panelHeadCompact}>
                    <span className={styles.panelKicker}>WORDS IN THE BRIEF</span>
                    <h3>자주 쓰인 문제의 언어</h3>
                  </div>
                  <p className={styles.keywordIntro}>
                    제목과 요약에 아래 표현이 등장한 과제 수입니다. 한 과제에 여러 표현이 나올 수 있습니다.
                  </p>
                  <div className={styles.keywordCloud}>
                    {analysis.keywords.slice(0, 10).map(({ keyword, count }) => (
                      <button
                        key={keyword}
                        type="button"
                        className={`${styles.keywordChip} ${activeKeyword === keyword ? styles.keywordChipActive : ''}`}
                        onClick={() => chooseKeyword(keyword)}
                        aria-pressed={activeKeyword === keyword}
                      >
                        {keyword} <span>{count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className={styles.pairPanel}>
              <div>
                <span className={styles.panelKicker}>WHERE TOPICS MEET</span>
                <h3>주제가 만나는 지점</h3>
                <p>두 태그를 함께 선택한 과제 수입니다. 교차 영역을 눌러 실제 서비스를 살펴보세요.</p>
              </div>
              <div className={styles.pairGrid}>
                {tagPairs.map((pair) => (
                  <button
                    key={`${pair.first}-${pair.second}`}
                    type="button"
                    onClick={() => choosePair(pair.first, pair.second)}
                    aria-label={`${pair.first} · ${pair.second} 태그를 모두 선택한 과제 ${pair.count}건 보기`}
                  >
                    <span>{pair.first} <i aria-hidden="true">×</i> {pair.second}</span>
                    <strong>{pair.count}<small>건</small></strong>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className={styles.section} aria-labelledby="popularity-title">
            <div className={styles.sectionHead}>
              <div>
                <p className={styles.sectionIndex}>02 / THE ATTENTION</p>
                <h2 id="popularity-title">어떤 과제가 주목받았을까</h2>
              </div>
              <p className={styles.sectionHeadNote}>
                투표는 수집 시점의 공개 반응입니다. 노출·홍보·팀 규모의 영향을 구분할 수 없습니다.
              </p>
            </div>
            <div className={styles.attentionGrid}>
              <div className={styles.chartPanel}>
                <div className={styles.panelHead}>
                  <div>
                    <span className={styles.panelKicker}>VOTE DISTRIBUTION</span>
                    <h3>투표가 어디에 모였나</h3>
                  </div>
                  <span className={styles.panelSub}>과제 수 기준</span>
                </div>
                <div className={styles.voteChart} role="list" aria-label="투표 구간별 과제 수">
                  {analysis.voteBuckets.map((bucket) => (
                    <div key={bucket.label} className={styles.voteRow} role="listitem">
                      <span>{bucket.label}표</span>
                      <div className={styles.voteTrack} aria-hidden="true">
                        <span style={{ width: `${(bucket.count / maxBucketCount) * 100}%` }} />
                      </div>
                      <strong>{formatNumber(bucket.count)}</strong>
                    </div>
                  ))}
                </div>
                <div className={styles.chartFootnote}>
                  중앙값 <strong>{analysis.medianVotes}표</strong>
                  <span aria-hidden="true">·</span>
                  상위 100개 과제의 투표 점유율 <strong>{formatPercent(analysis.top100VoteShare)}</strong>
                </div>
              </div>
              <div className={styles.leaderPanel}>
                <div className={styles.panelHeadCompact}>
                  <span className={styles.panelKicker}>TOP 05 / PUBLIC VOTES</span>
                  <h3>인기 과제</h3>
                </div>
                <ol className={styles.leaderList}>
                  {topProjects.map((project, index) => (
                    <li key={project.id}>
                      <a href={project.detailUrl} target="_blank" rel="noopener noreferrer">
                        <span className={styles.leaderRank}>{String(index + 1).padStart(2, '0')}</span>
                        <span className={styles.leaderText}>
                          <strong>{project.title}</strong>
                          <small>{project.tags.join(' · ')}</small>
                        </span>
                        <span className={styles.leaderVotes}>{project.votes}<small>표</small></span>
                      </a>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
            <div className={styles.contextStrip}>
              <div>
                <span className={styles.contextLabel}>참가 형태</span>
                <strong>개인 {formatNumber(analysis.individualCount)}건 <span>/</span> 팀 {formatNumber(analysis.teamCount)}건</strong>
                <p>팀은 전체의 {formatPercent(teamPercent)}입니다. 투표 수 차이를 제품의 품질 차이로 해석하지 않았습니다.</p>
              </div>
              <div>
                <span className={styles.contextLabel}>제출 시점</span>
                <strong>{formatMonthDay(lastSubmissionDay?.date)} · {formatNumber(lastSubmissionDay?.count ?? 0)}건</strong>
                <p>전체의 {formatPercent(((lastSubmissionDay?.count ?? 0) / analysis.totalProjects) * 100)}가 이날 제출됐습니다.</p>
              </div>
            </div>
          </section>

          <section id="ideas" className={styles.section} aria-labelledby="ideas-title">
            <div className={styles.sectionHead}>
              <div>
                <p className={styles.sectionIndex}>03 / IDEA LENSES</p>
                <h2 id="ideas-title">아이디어를 읽는 세 가지 렌즈</h2>
              </div>
              <p className={styles.sectionHeadNote}>제출 분포와 사례에서 만든 탐색 가설입니다. 시장 검증 결과는 아닙니다.</p>
            </div>
            <div className={styles.ideaGrid}>
              <article className={styles.ideaCard}>
                <span className={styles.ideaIndex}>A / 밀집된 주제</span>
                <strong>넓은 업무 도구보다<br />한 사람의 한 단계</strong>
                <p>업무생산성·협업이 205건으로 가장 많습니다. 회의록 전체보다 ‘역할별 이해 차이와 다음 질문’처럼 구체적인 실패 지점을 찾는 것이 차별화 가설이 됩니다.</p>
                <a href="https://event.wanted.co.kr/ai-championship/2026/projects/731" target="_blank" rel="noopener noreferrer">
                  사례 · SynQ <ArrowIcon />
                </a>
              </article>
              <article className={styles.ideaCard}>
                <span className={styles.ideaIndex}>B / 교차하는 문제</span>
                <strong>규칙과 설명이<br />함께 필요한 순간</strong>
                <p>금융·부동산과 법률·행정을 함께 선택한 과제가 17건입니다. 위험한 결정에서는 출처, 정해진 계산, 사람 확인을 제품 경험으로 묶는 방식이 보입니다.</p>
                <a href="https://event.wanted.co.kr/ai-championship/2026/projects/1715" target="_blank" rel="noopener noreferrer">
                  사례 · 곁 <ArrowIcon />
                </a>
              </article>
              <article className={styles.ideaCard}>
                <span className={styles.ideaIndex}>C / 적게 제출된 주제</span>
                <strong>과제 수가 적은 곳에<br />질문을 가져가기</strong>
                <p>접근성 34건, 외국인 18건입니다. 공급이 적다는 사실만으로 기회가 증명되지는 않습니다. 당사자의 반복 과업과 도입 주체를 직접 확인할 출발점입니다.</p>
                <a href="https://event.wanted.co.kr/ai-championship/2026/projects/1185" target="_blank" rel="noopener noreferrer">
                  사례 · 일이쉽소 <ArrowIcon />
                </a>
              </article>
            </div>
          </section>

          <section id="explore" className={styles.section} aria-labelledby="explore-title">
            <div className={styles.sectionHead}>
              <div>
                <p className={styles.sectionIndex}>04 / OPEN THE INDEX</p>
                <h2 id="explore-title">1,391개 과제 탐색</h2>
              </div>
              <p className={styles.sectionHeadNote}>제목·요약 검색과 주제 필터를 조합해 비슷한 문제를 찾아보세요.</p>
            </div>
            <div className={styles.explorePanel}>
              <div className={styles.filterTop}>
                <label className={styles.searchField}>
                  <span>서비스 또는 문제 검색</span>
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setVisibleCount(18);
                    }}
                    placeholder="예: 이력서, 독서, 안전, 기록"
                  />
                </label>
                <label className={styles.selectField}>
                  <span>주제</span>
                  <select
                    value={activeTag}
                    onChange={(event) => {
                      setActiveTag(event.target.value);
                      setSecondTag('');
                      setVisibleCount(18);
                    }}
                  >
                    <option value="">모든 주제</option>
                    {analysis.categoryCounts.map((category) => (
                      <option key={category.name} value={category.name}>{category.name} ({category.count})</option>
                    ))}
                  </select>
                </label>
                <label className={styles.selectField}>
                  <span>정렬</span>
                  <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
                    <option value="popular">투표 많은 순</option>
                    <option value="newest">최근 제출 순</option>
                    <option value="oldest">먼저 제출 순</option>
                  </select>
                </label>
              </div>
              <div className={styles.resultMeta} aria-live="polite">
                <p>
                  <strong>{formatNumber(filteredProjects.length)}</strong>개 과제
                  {secondTag ? <span> · {activeTag} × {secondTag}</span> : null}
                  {activeKeyword ? <span> · ‘{activeKeyword}’ 표현 포함</span> : null}
                </p>
                {hasFilters ? <button type="button" onClick={clearFilters}>필터 초기화 ×</button> : null}
              </div>
              {visibleProjects.length > 0 ? (
                <div className={styles.projectGrid}>
                  {visibleProjects.map((project) => (
                    <article key={project.id} className={styles.projectCard}>
                      <div className={styles.projectTop}>
                        <span>PROJECT {String(project.id).padStart(4, '0')}</span>
                        <span className={styles.projectVote}>{formatNumber(project.votes)} <small>표</small></span>
                      </div>
                      <h3>{project.title}</h3>
                      <p>{project.summary.length > 1 ? project.summary : '제출 요약이 없어 원문에서 내용을 확인할 수 있습니다.'}</p>
                      <div className={styles.projectTags}>
                        {project.tags.map((tag) => <span key={tag}>{tag}</span>)}
                      </div>
                      <div className={styles.projectBottom}>
                        <span>{project.participation === 'TEAM' ? '팀' : '개인'} 제출</span>
                        <div>
                          {project.serviceUrl ? (
                            <a href={project.serviceUrl} target="_blank" rel="noopener noreferrer" aria-label={`${project.title} 서비스 열기`}>
                              서비스 <ArrowIcon />
                            </a>
                          ) : null}
                          <a href={project.detailUrl} target="_blank" rel="noopener noreferrer" aria-label={`${project.title} 원티드 상세 보기`}>
                            원문 <ArrowIcon />
                          </a>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className={styles.emptyState}>
                  <strong>일치하는 과제가 없습니다.</strong>
                  <p>검색어를 줄이거나 다른 주제를 선택해 보세요.</p>
                  <button type="button" onClick={clearFilters}>전체 과제 보기</button>
                </div>
              )}
              {filteredProjects.length > visibleCount ? (
                <button type="button" className={styles.loadMore} onClick={() => setVisibleCount((count) => count + 18)}>
                  과제 더 보기 <span>{formatNumber(Math.min(visibleCount, filteredProjects.length))} / {formatNumber(filteredProjects.length)}</span>
                </button>
              ) : null}
            </div>
          </section>

          <section className={styles.method} aria-labelledby="method-title">
            <div>
              <p className={styles.sectionIndex}>ABOUT THIS DATA</p>
              <h2 id="method-title">숫자를 읽기 전에</h2>
            </div>
            <div className={styles.methodBody}>
              <p>분석 단위는 고유 과제 ID 1건입니다. 태그와 도구는 제출자가 선택했으며 여러 개일 수 있습니다. 키워드는 제목·요약에 표현이 등장한 횟수가 아닌, 해당 표현을 포함한 과제 수입니다.</p>
              <p>투표 수는 {formatSnapshot(snapshotAt)}에 수집된 값입니다. 인기와 제품의 완성도, 지속 이용, 시장성을 같게 보지 않았습니다. 공개 설명에 적힌 구현·성과는 별도로 검증하지 않았습니다.</p>
              <p>데모 URL의 접근 코드와 추적 매개변수는 페이지용 데이터에서 제외했습니다. 서비스 링크가 열리지 않으면 원티드 상세 페이지에서 원본 주소를 확인할 수 있습니다.</p>
              <div className={styles.methodLinks}>
                <a href={sourceUrl} target="_blank" rel="noopener noreferrer">원티드 과제 목록 <ArrowIcon /></a>
                <Link href="/">내 링크로 돌아가기 <span aria-hidden="true">←</span></Link>
              </div>
            </div>
          </section>
        </div>
      </main>
      <footer className={styles.footer}>
        <span>AI IDEA ATLAS · WANTED AI CHAMPIONSHIP 2026</span>
        <span>공개 과제 데이터에서 읽은 아이디어의 풍경</span>
      </footer>
    </div>
  );
}
