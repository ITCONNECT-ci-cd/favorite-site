'use client';

import {
  createContext,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';

import { useSelectedCategory, type AdminCategory } from '@/components/admin/CategoryPanel';
import type { AdminLink, LinkRowMap } from '@/components/admin/LinkTable';
import type { AdminSubCategory, SubCategoryMap } from '@/components/admin/SubCategoryRow';
import { toast } from '@/components/Toast';
import { fillDiscordFavicons } from '@/lib/discord-favicon-fill';
import { reconcileDiscordFaviconOrphans } from '@/lib/discord-favicon-reconcile';
import {
  DISCORD_FAVICON_PROVIDER_APPROVAL_REQUIRED,
  REQUEST_FAILED,
} from '@/lib/constants';
import { hostOf } from '@/lib/url';

/**
 * 표를 늘어놓는 네 가지 차례 (프로토타입 376–379행 · 1109–1112행).
 *
 * `order` 가 기본이자 **손으로 정한 순서**다 — 드래그 정렬(`reorderBookmarks`)이 저장하는 그
 * 순서이고, 나머지 셋은 화면에서만 다시 늘어놓는 보기다. 그래서 `order` 가 아닌 동안에는 표가
 * 드래그를 받지 않는다(components/admin/LinkTable.tsx `handleDrop`).
 */
export type SortMode = 'order' | 'sub' | 'clicks' | 'name';
export type SourceFilter = 'all' | 'discord';

/** select 가 그릴 차례와 글자. 배열 순서가 곧 option 순서다. */
const SORTS: ReadonlyArray<{ value: SortMode; label: string }> = [
  { value: 'order', label: '직접 지정한 순서' },
  { value: 'sub', label: '하위 카테고리순' },
  { value: 'clicks', label: '클릭 많은순' },
  { value: 'name', label: '이름순' },
];

function isSortMode(value: string): value is SortMode {
  return SORTS.some((sort) => sort.value === value);
}

/**
 * "지금 이 목록을 어떻게 걸러 어떻게 늘어놓는가" — 필터 줄이 정하고 링크 표가 읽는다.
 *
 * 세 값 다 **화면 안에서만** 산다. 서버 왕복이 없다: 걸러 낼 목록도, 정렬에 쓰는 클릭 수·하위
 * 이름도 이미 화면(app/admin/page.tsx)이 접어 내린 값이라 다시 물어볼 것이 없다. 그래서 이
 * 파일에는 액션 호출도, 실패 토스트도, 이중 제출 빗장도 없다(I·J 트랙의 서버 왕복 표준이
 * 적용되지 않는 유일한 자리다).
 */
export type LinkFilterValue = {
  /** 검색 칸에 적힌 글자 그대로. 다듬는 것은 읽는 쪽이다(`visibleLinks`). */
  query: string;
  setQuery: (next: string) => void;
  /**
   * 고른 하위 칩. **`null` 은 '전체'**, 그 밖에는 언제나 `categoryId` 다 — 하위 칩이면 그 하위의
   * id, '하위 미지정' 칩이면 **상위 자신의 id** 다.
   *
   * 상위 id 가 곧 "하위 미지정"인 이유는 링크가 언제나 어딘가에 속하기 때문이다: 하위에 배정되지
   * 않은 링크의 `categoryId` 는 상위 id 다(`AdminLink` JSDoc). 프로토타입은 `'—'` 라는 표시용 값을
   * 따로 두고 `!b.sub` 로 갈랐지만(1107행), 그쪽은 하위를 이름으로 다뤄 id 가 없었다.
   */
  subFilter: string | null;
  setSubFilter: (next: string | null) => void;
  sourceFilter: SourceFilter;
  setSourceFilter: (next: SourceFilter) => void;
  sort: SortMode;
  setSort: (next: SortMode) => void;
};

const LinkFilterContext = createContext<LinkFilterValue | null>(null);

/**
 * 필터 상태를 드는 자리 — **필터 줄과 링크 표의 공통 조상**이다(app/admin/page.tsx 가 마운트한다).
 *
 * ## 왜 이 파일에 있나
 *
 * 값을 **만드는** 것이 필터 줄이라 상태도 그 모듈에 둔다. 표는 읽기만 한다 — 좌측 패널이
 * 선택 상태를 갖고 우측 전체가 읽는 것과 같은 모양이다(CategoryPanel `SelectedCategoryProvider`).
 * 줄과 표는 형제라 prop 으로는 닿지 않고, 화면(page)이 두 값을 들면 "필터가 무엇인가"의 소유자가
 * 화면으로 올라가 버린다.
 *
 * ## 카테고리를 바꾸면 **줄이던 두 값만** 처음으로 돌아간다
 *
 * 리셋은 `key` 하나가 한다(링크 표·하위 줄이 쓰는 것과 같은 장치). 'AI 도구 모음'에서 적던
 * 검색어와 거기서 고른 하위 칩이 '마케팅'으로 따라가면, 고른 칩은 그 상위에 있지도 않은 하위를
 * 가리키고 표는 이유 없이 비어 보인다.
 *
 * **정렬은 따라간다 — 프로토타입도 하위 칩만 되돌렸다**(1101행 `{ catSel: g, subFilter: null }`).
 * 검색어와 칩은 목록을 **줄이는** 값이라 남으면 빈 표를 만들지만, 정렬은 아무것도 줄이지 않는
 * 보기 취향이다: 카테고리와 결합이 없고 어디서 골라도 뜻이 같아, 되돌리면 오히려 "클릭 많은순으로
 * 훑는 중"이라는 사람의 작업이 카테고리마다 끊긴다. 그래서 `sort` 만 `key` 바깥에 산다.
 *
 * 줄이는 두 값이 남았을 때의 혼란은 표가 대신 덮는다 — 걸러 낸 결과가 0건이면 "조건에 맞는 링크가
 * 없습니다. 검색어나 하위 필터를 지워 보세요."가 뜬다(LinkTable). 그 문장이 정렬을 말하지 않는 것도
 * 같은 이유다: 정렬로는 표가 비지 않는다.
 *
 * `key` 가 바뀌면 children 까지 새로 서는데, 그 안의 표는 어차피 자기 `key` 로 같은 일을 이미
 * 한다(LinkTable) — 새로 서는 범위가 넓어질 뿐 없던 초기화가 생기지는 않는다.
 *
 * ## DOM 을 만들지 않는다
 *
 * children 을 그대로 돌려준다 — 줄과 표 사이에 상자가 끼면 상자(LinkAddRow)의 구분선 계산과
 * 어긋난다.
 */
export function LinkFilterProvider({ children }: { children: ReactNode }) {
  const { selected } = useSelectedCategory();
  // 정렬은 `key` 바깥이라 카테고리를 넘어 그대로 간다(위 JSDoc). 안쪽 두 값만 새 카테고리에서
  // 처음부터 선다.
  const [sort, setSort] = useState<SortMode>('order');

  return (
    <FilterState key={selected?.id ?? ''} sort={sort} setSort={setSort}>
      {children}
    </FilterState>
  );
}

function FilterState({
  children,
  sort,
  setSort,
}: {
  children: ReactNode;
  sort: SortMode;
  setSort: (next: SortMode) => void;
}) {
  const [query, setQuery] = useState('');
  const [subFilter, setSubFilter] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');

  const value = useMemo<LinkFilterValue>(
    () => ({
      query,
      setQuery,
      subFilter,
      setSubFilter,
      sourceFilter,
      setSourceFilter,
      sort,
      setSort,
    }),
    [query, subFilter, sourceFilter, sort, setSort],
  );

  return <LinkFilterContext.Provider value={value}>{children}</LinkFilterContext.Provider>;
}

/**
 * 필터를 읽는 통로 — 링크 표가 이것만 쓴다.
 *
 * provider 밖에서 부르면 던진다. 조용히 "필터 없음"을 돌려주면 **배선을 빼먹은 화면이 정상으로
 * 보인다** — 검색·칩·정렬이 아무 일도 하지 않는 채로(`useSelectedCategory` 와 같은 근거).
 */
export function useLinkFilter(): LinkFilterValue {
  const value = useContext(LinkFilterContext);
  if (value === null) {
    throw new Error('useLinkFilter 는 LinkFilterProvider 안에서만 쓸 수 있습니다.');
  }

  return value;
}

/**
 * 한 링크가 검색어에 맞는가 — **이름 · 설명 · 주소(host)** 를 본다(프로토타입 1108행).
 *
 * 칸마다 따로 본다. 프로토타입은 세 값을 이어 붙인 한 문자열에서 찾아(`(b.title + b.desc + b.host)`)
 * 이름 끝과 설명 앞에 걸친 글자가 우연히 맞았다 — 그렇게 걸린 행은 화면 어디에도 맞은 이유가
 * 보이지 않는다.
 *
 * 주소는 **표에 적히는 표기**(`hostOf` — 맨 앞 `www.` 만 뗀다)를 본다. 경로까지 넣지 않는 것은
 * 표가 경로를 그리지 않아서다: 보이지 않는 글자에 맞아 나온 행은 위와 같은 문제가 된다.
 */
function matches(link: AdminLink, query: string): boolean {
  if (query === '') return true;

  return [link.title, link.description ?? '', hostOf(link.url)].some((field) =>
    field.toLowerCase().includes(query),
  );
}

/**
 * 이 링크가 고른 칩에 걸리는가.
 *
 * `null`(전체)은 다 통과시키고, 하위 칩은 그 하위 소속만 남긴다. '하위 미지정' 칩은 **목록에 있는
 * 하위 중 어디에도 속하지 않은** 링크를 남긴다 — 상위 직속(`categoryId` = 상위 id)이 그것이고,
 * **없어진 하위를 가리키는 링크도 여기 들어온다.**
 *
 * 뒤쪽 경우는 화면이 잠시 지나는 상태다: 하위를 지우면 서버가 그 안의 링크를 상위로 올리는데
 * (`deleteSubCategory`), 새 하위 목록과 새 링크 행이 도착하는 사이에 옛 `categoryId` 가 한 프레임
 * 남는다. 그 프레임에서 표의 하위 select 는 이미 `—`(하위 없음)를 그리므로(LinkTable `subValue`),
 * 칩도 같은 것을 보아야 한다 — 아니면 `—` 라고 적힌 행이 '하위 미지정' 을 눌렀을 때 사라진다.
 */
function inSubFilter(
  link: AdminLink,
  subFilter: string | null,
  nameOf: ReadonlyMap<string, string>,
): boolean {
  if (subFilter === null) return true;
  if (nameOf.has(subFilter)) return link.categoryId === subFilter;

  return !nameOf.has(link.categoryId);
}

/**
 * 표가 **그리는** 목록 — 거른 뒤 늘어놓은 결과다.
 *
 * ⚠️ **보내는 목록과 다르다.** 드래그 정렬은 이 결과가 아니라 걸러지지 않은 목록 전체를 보내야
 * 한다 — `sort_order` 는 테이블 전체가 공유하는 컬럼 하나라 일부만 보내면 보낸 것들이 0..k 로
 * 앞당겨져 나머지와 뒤섞인다(`reorderBookmarks` JSDoc · LinkTable `handleDrop`).
 *
 * 순서를 바꾸는 셋(`clicks`·`name`·`sub`)은 **동점일 때 원래 차례를 지킨다** — `Array.prototype.sort`
 * 가 안정 정렬이라 따로 손댈 것이 없다(ES2019 부터 규격이다). 프로토타입이 하위순에만 적어 둔
 * `|| a.order - b.order`(1111행)가 그 뜻이고, 나머지 둘도 같은 성질에 기대고 있었다.
 *
 * 인자로 받은 배열은 건드리지 않는다 — 서버가 준 목록이 그대로 낙관적 순서의 밑이라 제자리 정렬로
 * 흔들면 저장되지 않은 순서가 조용히 바뀐다. 지금 그것을 지키는 것은 아래 `links.filter(...)` 다 —
 * 이미 새 배열을 준다. `[...shown]` 은 그 위에 한 벌을 더 뜨는 사본이라 오늘은 남는 일이지만, 걸러
 * 낼 것이 없는 갈래가 생겨 `shown` 이 인자를 그대로 가리키게 되는 날에도 이 줄이 그 앞을 막는다.
 */
export function visibleLinks(
  links: readonly AdminLink[],
  subs: readonly AdminSubCategory[],
  filter: Pick<LinkFilterValue, 'query' | 'subFilter' | 'sourceFilter' | 'sort'>,
): readonly AdminLink[] {
  const query = filter.query.trim().toLowerCase();
  const nameOf = new Map(subs.map((sub) => [sub.id, sub.name]));

  const shown = links.filter(
    (link) =>
      inSubFilter(link, filter.subFilter, nameOf) &&
      matches(link, query) &&
      (filter.sourceFilter === 'all' || link.source === 'discord'),
  );

  if (filter.sort === 'order') return shown;

  return [...shown].sort((a, b) => {
    if (filter.sort === 'clicks') return b.clickCount - a.clickCount;
    if (filter.sort === 'name') return a.title.localeCompare(b.title, 'ko');

    /* 하위 카테고리순. **하위 없음(상위 직속)은 맨 뒤**다 — 프로토타입은 없는 하위를 `'헬'` 로
       바꿔 넣어 뒤로 미뤘지만(1111행), 그 글자는 `호`·`후` 로 시작하는 하위 이름보다는 앞에
       선다. 여기서는 있고 없음을 먼저 가른다. */
    const left = nameOf.get(a.categoryId);
    const right = nameOf.get(b.categoryId);
    if (left === undefined || right === undefined) {
      if (left === right) return 0;

      return left === undefined ? 1 : -1;
    }

    return left.localeCompare(right, 'ko');
  });
}

/**
 * 줄 — 프로토타입 원문 `display:flex; align-items:center; gap:10px; height:44px; padding:0 16px;
 * background:#fff; border-bottom:1px solid #e3dfd9`.
 *
 * **높이만 고정이 아니라 밑값이다.** 칩은 하위 수만큼 늘어난다 — 실제 데이터의 첫 카테고리는
 * 하위가 10개라 칩이 12개고(전체 + 10 + 하위 미지정), 한 줄에 들어가지 않는다. 44px 로 못 박으면
 * 넘친 칩이 그냥 **사라진다**: 이 줄을 담은 상자가 `overflow-hidden` 이라(LinkAddRow) 잘린 부분이
 * 화면 밖으로도 나가지 못한다. 좁은 화면(<820px 에서 관리자 2단이 1단으로 접힌다 — DESIGN_SPEC
 * 1장)에서는 줄 자체도 감싼다.
 *
 * 위아래 7px 는 **한 줄일 때 정확히 44px 이 되게** 고른 값이다(가장 높은 항목인 검색 칸·select 가
 * 30px + 7 + 7). 줄이 늘면 그만큼 아래로 자란다.
 */
const ROW =
  'flex flex-wrap items-center gap-x-[10px] gap-y-[10px] min-h-[44px] px-[16px] py-[7px] bg-card border-b border-border';

/** 검색 칸 190×30px. 배경 `#f3f1ed` 는 색상표의 "사이드바 · 검색창 배경" 그대로다. */
const SEARCH =
  'w-[190px] h-[30px] rounded-[6px] border border-border-strong bg-side px-[10px] text-[12px] text-ink';

/** 칩 줄 — 남는 자리를 다 쓰고(`flex:1`) 좁아지면 감싼다. `min-w-0` 이 없으면 긴 하위 이름이 줄을 밀어낸다. */
const CHIPS = 'flex flex-wrap gap-[5px] flex-1 min-w-0';

/** 칩 26px — 라운드 6px, 11.5px/600, 테두리 `#ddd8d1`. 손가락 커서는 이 트랙의 공통 관례다(I2). */
const CHIP =
  'flex h-[26px] items-center rounded-[6px] border border-border-strong px-[10px] text-[11.5px] font-semibold whitespace-nowrap cursor-pointer';
/**
 * 고른 칩 / 안 고른 칩 (프로토타입 1099행 `bg`·`fg`).
 *
 * `#3a3833` 은 DESIGN_SPEC 1장 색상표에 없는 프로토타입 고유값이라 토큰이 아니라 값으로 적는다
 * (LinkTable 의 `#5a5651` 과 같은 판단).
 */
const CHIP_ON = 'bg-ink text-white';
const CHIP_OFF = 'bg-card text-[#3a3833]';

/** '정렬' 라벨 11px `#9a9791`. */
const SORT_LABEL = 'text-[11px] text-fainter flex-none';
/** 정렬 select 120×30px. */
const SORT_FIELD =
  'w-[120px] flex-none h-[30px] rounded-[6px] border border-border-strong bg-card px-[6px] text-[11.5px] text-ink';

/**
 * 링크·하위가 없는 카테고리에서 매 렌더 새 배열을 만들지 않기 위한 자리.
 *
 * 같은 상수가 LinkTable·SubCategoryRow 에도 따로 있다 — 빈 배열 하나를 나누자고 모듈을 엮기보다
 * 쓰는 자리 옆에 두는 쪽을 골랐다(공유해서 아낄 것이 `[]` 하나뿐이다).
 */
const NO_LINKS: readonly AdminLink[] = [];
const NO_SUBS: readonly AdminSubCategory[] = [];

/**
 * 필터 줄 — DESIGN_SPEC 6장 "필터 줄", 프로토타입 367–381행.
 *
 * 목록 안에서 찾고(검색), 하위별로 좁히고(칩), 늘어놓는 차례를 고른다(정렬 4종). 이 필터들은 **화면
 * 안에서만** 일어난다. 같은 줄의 자동 favicon 유지보수 버튼만 관리자 server action으로 왕복하며
 * busy/중복 제출 빗장을 갖는다. 어느 상위인지는 prop 이 아니라 좌측 패널과 공유하는 선택 상태에서
 * 온다(`useSelectedCategory`).
 *
 * ## 자리 — 링크 추가 줄과 같은 상자 안, 표 **앞**이다
 *
 * 프로토타입에서 흰 상자 하나가 추가 줄 + 필터 줄 + 표를 함께 담는다(359–412행). 그래서 이
 * 컴포넌트도 상자를 만들지 않고 `<LinkAddRow>` 의 children 으로 들어가며, 자기 **아래** 구분선만
 * 스스로 그린다(표 헤더와의 경계 — 프로토타입 367행 `border-bottom`).
 *
 * ## 고른 결과는 prop 이 아니라 문맥으로 표에 닿는다
 *
 * 표는 형제라 prop 으로는 닿지 않는다. 위 `LinkFilterProvider` 가 둘의 공통 조상에서 값을 들고,
 * 표는 `useLinkFilter()` + `visibleLinks()` 로 읽는다.
 *
 * ## 개수는 거르기 **전** 목록을 센다
 *
 * 칩에 붙는 숫자는 검색어와 무관하다(프로토타입 1095–1097행도 같다). 검색으로 줄어든 수를 얹으면
 * 되돌아갈 곳("전체 5")이 사라져, 지금 몇 개를 감추고 있는지 알 길이 없어진다.
 *
 * 하위가 하나도 없으면 '전체'와 '하위 미지정'이 같은 수를 세지만 둘 다 그린다 — 프로토타입 그대로다.
 * 한쪽을 감추면 하위를 처음 만드는 순간 칩이 튀어나오고, 그전까지는 "하위 미지정이라는 갈래가
 * 있다"는 사실 자체가 화면에서 사라진다.
 */
export function FilterRow({
  linksByCategory,
  subsByCategory,
  faviconProviderApproved = false,
}: {
  linksByCategory: LinkRowMap;
  subsByCategory: SubCategoryMap;
  /** 서버가 exact `DISCORD_FAVICON_PROVIDER_APPROVED=true`에서만 내려 주는 privacy 승인값. */
  faviconProviderApproved?: boolean;
}) {
  const { selected } = useSelectedCategory();

  // 상위가 하나도 없으면 걸러 볼 목록도 없다 — 애초에 `LinkAddRow` 가 그 경우 children 을 그리지
  // 않지만(그쪽 JSDoc), 이 컴포넌트를 다른 자리에 놓아도 같은 판단이 서게 여기서도 막는다.
  if (selected === null) return null;

  return (
    <Row
      parent={selected}
      links={linksByCategory[selected.id] ?? NO_LINKS}
      subs={subsByCategory[selected.id] ?? NO_SUBS}
      faviconProviderApproved={faviconProviderApproved}
    />
  );
}

/** 칩 하나가 아는 것 — 이름 · 개수 · 그 칩이 세우는 필터 값(`null` = 전체). */
type Chip = { key: string; name: string; count: number; value: string | null };

function Row({
  parent,
  links,
  subs,
  faviconProviderApproved,
}: {
  parent: AdminCategory;
  links: readonly AdminLink[];
  subs: readonly AdminSubCategory[];
  faviconProviderApproved: boolean;
}) {
  const {
    query,
    setQuery,
    subFilter,
    setSubFilter,
    sourceFilter,
    setSourceFilter,
    sort,
    setSort,
  } = useLinkFilter();
  const sortId = useId();
  const approvalNoteId = useId();
  const fillingRef = useRef(false);
  const reconcilingRef = useRef(false);
  const [filling, startFill] = useTransition();
  const [reconciling, startReconcile] = useTransition();

  function fillFavicons(): void {
    if (!faviconProviderApproved || fillingRef.current || reconcilingRef.current) return;
    fillingRef.current = true;

    startFill(async () => {
      try {
        const result = await fillDiscordFavicons();
        toast(
          result.ok
            ? `${result.filled}개 채움 · ${result.failed}개 실패 · ${result.remaining}개 남음`
            : result.error,
        );
      } catch (error) {
        console.error('[FilterRow] 자동 파비콘 요청 실패', error);
        toast(REQUEST_FAILED);
      } finally {
        fillingRef.current = false;
      }
    });
  }

  function reconcileFavicons(): void {
    if (fillingRef.current || reconcilingRef.current) return;
    reconcilingRef.current = true;

    startReconcile(async () => {
      try {
        const result = await reconcileDiscordFaviconOrphans();
        toast(
          result.ok
            ? `${result.deleted}개 고아 정리 · ${result.kept}개 유지 · ${result.invalid}개 건너뜀`
            : result.error,
        );
      } catch (error) {
        console.error('[FilterRow] 파비콘 고아 정리 요청 실패', error);
        toast(REQUEST_FAILED);
      } finally {
        reconcilingRef.current = false;
      }
    });
  }

  /* 어느 칩에 몇 개인지 한 번만 센다 — 칩마다 목록을 다시 훑으면 하위가 늘수록 훑는 횟수가 함께
     는다. 키는 칩의 필터 값이라 상위 id 가 그대로 "하위 미지정" 개수가 되고, **목록에 없는 하위**를
     가리키는 링크도 거기로 모인다(거를 때와 같은 규칙 — `inSubFilter`). 세는 규칙과 거르는 규칙이
     갈라지면 "하위 미지정 2" 를 눌렀는데 3줄이 남는 화면이 된다. */
  const subIds = new Set(subs.map((sub) => sub.id));
  const countOf = new Map<string, number>();
  for (const link of links) {
    const key = subIds.has(link.categoryId) ? link.categoryId : parent.id;
    countOf.set(key, (countOf.get(key) ?? 0) + 1);
  }

  const chips: Chip[] = [
    { key: 'all', name: '전체', count: links.length, value: null },
    ...subs.map((sub) => ({
      key: sub.id,
      name: sub.name,
      count: countOf.get(sub.id) ?? 0,
      value: sub.id,
    })),
    // 상위 직속 = 하위 미지정. 값이 상위 id 인 이유는 `subFilter` JSDoc 에 있다.
    { key: 'none', name: '하위 미지정', count: countOf.get(parent.id) ?? 0, value: parent.id },
  ];

  /* 지금 눌린 것으로 **보여야 할** 값 — 거를 때와 같은 규칙이다(`inSubFilter`). 고른 하위가 사라진
     한 프레임 동안(하위 삭제 후 새 목록이 먼저 도착한다) `subFilter` 는 목록에 없는 id 를 가리키는데,
     거르기는 그것을 이미 '하위 미지정' 으로 접는다. 여기서 `subFilter` 를 그대로 비교하면 아무 칩도
     안 눌린 채 걸러진 표만 남아, 무엇이 이 표를 줄였는지가 화면에서 사라진다. */
  const active = subFilter === null || subIds.has(subFilter) ? subFilter : parent.id;

  return (
    <div data-testid="filter-row" className={ROW}>
      {/* placeholder 는 값이 들어가면 사라져 이름 역할을 못 한다 — 같은 문장을 접근성 이름으로도
          준다(팔레트 입력·추가 줄과 같은 처리). */}
      <input
        aria-label="이 목록에서 검색"
        placeholder="이 목록에서 검색"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className={SEARCH}
      />

      {/* 하위 줄(I2)의 `role="group"` 과 같은 자리지만 **다른 이름**이다 — 그쪽은 하위를 고치는
          줄이고 이쪽은 목록을 좁히는 줄이라, 이름이 같으면 보조기기에서 둘을 구별할 수 없다. */}
      <span role="group" aria-label="하위 카테고리 필터" className={CHIPS}>
        {chips.map((chip) => {
          const on = active === chip.value;

          /* 라디오가 아니라 눌린 버튼으로 낸다 — 값이 하나만 켜지는 것은 라디오와 같지만, 칩은
             화살표 키로 옮겨 다니는 묶음이 아니라 각자 눌리는 버튼이다(하위 줄의 칩과 같은 결).
             켜진 것은 `aria-pressed` 가 알리고, 눈에는 배경·글자색이 함께 뒤집혀 보인다. */
          return (
            <button
              key={chip.key}
              type="button"
              aria-pressed={on}
              onClick={() => setSubFilter(chip.value)}
              className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}
            >
              {chip.name} {chip.count}
            </button>
          );
        })}
      </span>

      <span role="group" aria-label="등록 출처 필터" className="flex gap-[5px] flex-none">
        {([
          ['all', '전체'],
          ['discord', '자동만'],
        ] as const).map(([value, label]) => {
          const on = sourceFilter === value;

          return (
            <button
              key={value}
              type="button"
              aria-pressed={on}
              onClick={() => setSourceFilter(value)}
              className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}
            >
              {label}
            </button>
          );
        })}
      </span>

      {/* 눈에 보이는 '정렬'을 그대로 select 의 이름으로 쓴다 — `aria-label` 을 따로 적으면 보이는
          글자와 읽히는 이름이 갈라질 수 있다. */}
      <label htmlFor={sortId} className={SORT_LABEL}>
        정렬
      </label>
      <select
        id={sortId}
        value={sort}
        onChange={(event) => {
          // 네 값 말고는 들어올 길이 없지만(option 이 넷뿐이다), 확인 없이 캐스팅하면 나중에
          // option 을 늘릴 때 타입만 통과하고 정렬은 조용히 기본값이 된다.
          if (isSortMode(event.target.value)) setSort(event.target.value);
        }}
        className={SORT_FIELD}
      >
        {SORTS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <button
        type="button"
        aria-busy={filling}
        aria-describedby={faviconProviderApproved ? undefined : approvalNoteId}
        title={
          faviconProviderApproved ? undefined : DISCORD_FAVICON_PROVIDER_APPROVAL_REQUIRED
        }
        disabled={!faviconProviderApproved || filling || reconciling}
        onClick={fillFavicons}
        className="h-[30px] flex-none rounded-[6px] border border-border-strong bg-card px-[10px] text-[11.5px] font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50"
      >
        {filling ? '자동 파비콘 채우는 중…' : '자동 파비콘 채우기'}
      </button>

      {!faviconProviderApproved && (
        <span id={approvalNoteId} role="note" className="max-w-[180px] text-[10.5px] text-fainter">
          {DISCORD_FAVICON_PROVIDER_APPROVAL_REQUIRED}
        </span>
      )}

      <button
        type="button"
        aria-busy={reconciling}
        disabled={filling || reconciling}
        onClick={reconcileFavicons}
        className="h-[30px] flex-none rounded-[6px] border border-border-strong bg-card px-[10px] text-[11.5px] font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50"
      >
        {reconciling ? '고아 객체 정리 중…' : '고아 객체 정리'}
      </button>
    </div>
  );
}
