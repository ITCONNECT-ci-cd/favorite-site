import type { Metadata } from 'next';

import snapshot from '@/data/wanted-ai-championship-2026.json';
import { analyzeWantedProjects, type WantedProject } from '@/lib/wanted-analysis';

import { WantedAtlas } from './WantedAtlas';

export const metadata: Metadata = {
  title: 'AI 아이디어 지형도 · 원티드 AI Championship 2026',
  description:
    '원티드 AI Championship 2026 공개 과제 1,391건의 주제, 키워드, 투표 반응과 서비스 아이디어를 탐색합니다.',
};

export default function WantedChampionshipResearchPage() {
  const projects = snapshot.projects as WantedProject[];

  return (
    <WantedAtlas
      projects={projects}
      analysis={analyzeWantedProjects(projects)}
      snapshotAt={snapshot.snapshotAt}
      sourceUrl={snapshot.sourceUrl}
    />
  );
}
