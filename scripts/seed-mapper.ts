import { randomUUID } from 'node:crypto';

import type { Bookmark, Category } from '@/lib/types';

/**
 * docs/data/links.json 의 원시 레코드.
 * raw/tier/dup/old/cluster 등 매핑에 쓰지 않는 여분 필드가 더 붙어 있어도 허용한다.
 */
export type RawLink = {
  id: number;
  title: string;
  url: string;
  host: string;
  desc: string;
  group: string;
  /** 빈 문자열이면 '하위 없음' (실측: "" 125건, null 0건) */
  sub: string;
  tags: string[];
  pinned: boolean;
  /** unix seconds */
  added: number;
  [extra: string]: unknown;
};

/** categories 테이블에 그대로 insert 할 수 있는 행 */
export type CategorySeed = Category;

/** bookmarks 테이블 행 + seed 파이프라인 전용 확장 필드 */
export type BookmarkSeed = Bookmark & {
  /** docs/data/icons 안에 파일이 있으면 `"<legacyId>.png"`, 없으면 null */
  iconFile: string | null;
  /** links.json 원본 id — B4 파비콘 업로드 매칭용 (DB 컬럼 아님) */
  legacyId: number;
};

export type Seed = {
  categories: CategorySeed[];
  bookmarks: BookmarkSeed[];
};

/**
 * 원시 링크 배열을 DB insert 용 rows 로 바꾸는 순수 변환.
 *
 * 파일시스템에는 접근하지 않는다 — 파비콘 파일 존재 여부는 `availableIconIds` 로 주입받는다
 * (실제 디렉터리 스캔은 호출측 몫).
 *
 * @param raw docs/data/links.json 을 파싱한 배열. 이 배열과 그 요소는 변경하지 않는다.
 * @param availableIconIds `docs/data/icons/<id>.png` 가 실제로 존재하는 원본 id 집합.
 */
export function buildSeed(
  raw: readonly RawLink[],
  availableIconIds: ReadonlySet<number>,
): Seed {
  const categories: CategorySeed[] = [];
  /** group 이름 → 상위 카테고리 uuid + (sub 이름 → 하위 uuid). 하위 이름은 그룹 안에서만 유일하다. */
  const groups = new Map<string, { topId: string; subIds: Map<string, string> }>();
  /** raw 인덱스별로 확정된 bookmarks.category_id */
  const categoryIdPerLink: string[] = [];

  // 카테고리는 '최초 등장' 기준으로 한 번만 만든다.
  // 그룹은 비연속으로 등장할 수 있으므로(실측: 참고자료가 구글 서비스를 사이에 두고 두 구간으로
  // 갈라져 등장) 연속 구간(run) 단위가 아니라 이름 단위로 dedupe 해야 한다.
  for (const link of raw) {
    let group = groups.get(link.group);
    if (group === undefined) {
      group = { topId: randomUUID(), subIds: new Map() };
      groups.set(link.group, group);
      categories.push({
        id: group.topId,
        name: link.group,
        parent_id: null,
        sort_order: groups.size - 1,
      });
    }

    // 빈 문자열 sub 는 '하위 없음' — 하위 카테고리를 만들지 않고 상위에 직속시킨다.
    if (link.sub === '') {
      categoryIdPerLink.push(group.topId);
      continue;
    }

    let subId = group.subIds.get(link.sub);
    if (subId === undefined) {
      // 그룹 안에서의 최초 등장 순서가 곧 sort_order.
      const sortOrder = group.subIds.size;
      subId = randomUUID();
      group.subIds.set(link.sub, subId);
      categories.push({
        id: subId,
        name: link.sub,
        parent_id: group.topId,
        sort_order: sortOrder,
      });
    }
    categoryIdPerLink.push(subId);
  }

  const bookmarks: BookmarkSeed[] = raw.map((link, index) => ({
    id: randomUUID(),
    category_id: categoryIdPerLink[index],
    title: link.title,
    url: link.url,
    description: link.desc,
    tags: [...link.tags],
    // 실제 URL 은 파비콘 업로드(B4) 후에 채운다.
    favicon_url: null,
    is_pinned: link.pinned,
    // links.json 에 order 필드가 없으므로 배열 인덱스를 그대로 쓴다.
    sort_order: index,
    created_at: new Date(link.added * 1000).toISOString(),
    iconFile: availableIconIds.has(link.id) ? `${link.id}.png` : null,
    legacyId: link.id,
  }));

  return { categories, bookmarks };
}
