// @vitest-environment node
import { describe, expect, it } from 'vitest';

import snapshot from '@/data/wanted-ai-championship-2026.json';
import { analyzeWantedProjects, type WantedProject } from '@/lib/wanted-analysis';

const projects = snapshot.projects as WantedProject[];

describe('published Wanted project snapshot', () => {
  it('keeps the report and page totals tied to the same 1,391 submissions', () => {
    const result = analyzeWantedProjects(projects);
    expect(new Set(projects.map(({ id }) => id)).size).toBe(1391);
    expect(result.totalProjects).toBe(1391);
    expect(result.totalVotes).toBe(12804);
    expect(result.categoryCounts).toHaveLength(22);
    expect(result.zeroVoteProjects).toBe(422);
    expect(result.categoryCounts[0]).toMatchObject({ name: '업무생산성/협업', count: 205 });
  });

  it('does not publish test credentials, contact details or a local demo address', () => {
    for (const project of projects) {
      const publicText = `${project.title} ${project.summary}`;
      expect(publicText).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      expect(publicText).not.toMatch(/(?:비밀번호|패스워드|\bPW\b|password|passcode)\s*[:：=]/i);
      expect(publicText).not.toMatch(/01[016789][-. ]?\d{3,4}[-. ]?\d{4}/);
      if (project.serviceUrl) {
        const host = new URL(project.serviceUrl).hostname.toLowerCase();
        expect(host).not.toMatch(/^(?:localhost|0\.0\.0\.0|127\.0\.0\.1|10\.|192\.168\.)/);
      }
    }
  });
});
