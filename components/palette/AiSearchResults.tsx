'use client';

import type { MouseEvent } from 'react';
import { toast } from '@/components/Toast';
import { FaviconTile } from '@/components/palette/CommandPalette';
import type { AiSearchState } from '@/components/palette/useAiSearch';
// id·reason 한 건의 타입만 재사용한다(서버 모듈 lib/ai-search.ts 는 수정하지 않는다 — 파일 경계).
import type { AiSearchItem } from '@/lib/ai-search';
import type { AiSearchReason } from '@/lib/ai-search-client';
import { openToastText, recordClick } from '@/lib/clicks';
import type { BookmarkWithCount, SiteData } from '@/lib/types';
import { hostOf } from '@/lib/url';

/**
 * N3. ⌘K 팔레트의 **AI 의미 검색 영역** — 프로토타입 197~228행. 팔레트 결과 목록 아래·하단 바 위의
 * 슬롯(`aiSlot`)에 들어간다. 상태는 `useAiSearch` 훅이 쥐고, 여기서는 그 `state` 를 화면으로만 옮긴다.
 *
 * ### 무엇을 그리나 (N2 응답 계약 · route.ts JSDoc)
 * - `loading` — 점 3개 + "뜻이 비슷한 링크를 찾는 중"(프로토타입 199~207행).
 * - `source='ai'` & 결과 있음 — "AI가 의미로 찾은 링크 N건" + 근거 행(60px) + 소요 시간(프로토타입 209~227행).
 * - `source='ai'` & 결과 0 — **폴백이 아니라 "의미상 못 찾음"**. `ok:true`/`reason:'ok'` 인 빈 배열이다.
 * - `source='keyword'`, `reason='rate-limit'` — DB 를 건드리지 않은 구분 안내("잠시 후 재시도").
 * - `source='keyword'`, 그 밖의 이유(not-configured·timeout·error·parse-error) — 이름 검색으로 대신한
 *   실결과를 이유와 함께 보여 준다(결과가 없으면 "이름 검색 결과도 없습니다").
 * - HTTP(400/413)·네트워크 오류 — 실행 실패 안내.
 *
 * ### 키워드와 시각 분리 (완료 기준)
 * 팔레트 본문의 키워드 결과 행은 흰 바탕이다. AI 영역은 상단 구분선(#e7e3dc)과 옅은 바탕(#f5f3ef)으로
 * 한 덩어리를 이뤄, "여기부터는 AI가 고른 것"이 눈에 갈린다. 색은 DESIGN_SPEC 1장이 토큰화하지 않은
 * 값이라 팔레트 본체와 같은 임의값으로 적는다(그 파일 상단 주석과 같은 판단).
 *
 * ### 링크 열기
 * AI 결과 행도 팔레트 결과 행과 같은 계약이다 — 진짜 앵커로 새 탭을 열고, 클릭 기록(F3)·토스트를
 * 남긴 뒤 팔레트를 닫는다. 가운데 클릭은 집계만 하고 닫지 않는다(뒤 탭으로 열고 계속 찾는다).
 * 팔레트의 `anchorProps` 와 같은 모양이며, 호스트가 준 `onClose`(= 팔레트 닫기)를 왼쪽 클릭에서만 부른다.
 */

/** 점 3개 로딩 애니메이션 — 프로토타입 `@keyframes dot`(10행) 그대로 opacity 를 흔든다.
 *  전역 globals.css 가 아니라 이 컴포넌트가 직접 싣는다(Toast 의 rise 키프레임과 같은 처리). */
const DOT_KEYFRAMES = `
@keyframes palette-ai-dot {
  0%, 60%, 100% { opacity: .2; }
  30% { opacity: 1; }
}
`;

/** AI 영역 한 덩어리를 위 결과와 갈라 주는 옅은 바탕 + 상단 구분선. */
const ZONE = 'border-t border-[#e7e3dc] bg-[#f5f3ef]';

/** 헤더 줄(로딩·성공·폴백이 공유) — 좌측 제목/설명, 우측 소요 시간. */
const HEADER = `flex items-center gap-[10px] px-[18px] ${ZONE}`;

/** AI/폴백 결과 행 60px (프로토타입 217행). 호버 배경 #f7f5f2 = bg-page. */
const ROW = 'flex h-[60px] items-center gap-[12px] border-b border-line px-[18px] cursor-pointer hover:bg-page';

/** 안내(빈 결과·오류) 블록 — 팔레트 0건 안내와 같은 여백, 다만 AI 영역이라 바탕을 깐다. */
const NOTICE = `px-[24px] pt-[34px] pb-[28px] text-center ${ZONE}`;

/**
 * 이유별 한 줄 설명. `ok`(성공)·`rate-limit`(구분 안내)은 아래 렌더에서 먼저 갈라지므로 이 값이
 * 화면에 나오지 않지만, 새 이유가 늘면 TS 가 빠뜨림을 잡도록 6종을 모두 적는다(Record<AiSearchReason>).
 */
const REASON_DETAIL: Record<AiSearchReason, string> = {
  ok: '',
  'rate-limit': '',
  'not-configured': 'AI 검색을 아직 준비 중입니다',
  timeout: 'AI 검색이 시간을 초과했습니다',
  error: 'AI 검색에 문제가 생겼습니다',
  'parse-error': 'AI 응답을 이해하지 못했습니다',
};

/** 소요 시간 라벨 — 프로토타입 214행 "0.75초". tookMs 750 → "0.75초". */
function tookLabel(tookMs: number): string {
  return `${(tookMs / 1000).toFixed(2)}초`;
}

/**
 * 분류 칩 문구 — 하위면 하위 이름, 아니면 상위 이름(팔레트 `categoryLabel`·lib/search 와 같은 규칙).
 * 팔레트의 것은 모듈 내부 함수라 재사용할 수 없어 같은 한 줄을 여기 둔다. 규칙이 어긋나면 함께 고친다.
 */
function categoryLabel(bookmark: BookmarkWithCount, names: Map<string, string>): string {
  return bookmark.category_id === null ? '' : (names.get(bookmark.category_id) ?? '');
}

/** 결과 항목(id)을 실제 링크로 잇는다. 없는 id 는 버린다 — 계약상 실존 id 지만 순수 함수가 믿고 터지지 않게. */
function resolve(items: AiSearchItem[], byId: Map<string, BookmarkWithCount>): {
  bookmark: BookmarkWithCount;
  reason: string | null;
}[] {
  const rows: { bookmark: BookmarkWithCount; reason: string | null }[] = [];
  for (const item of items) {
    const bookmark = byId.get(item.id);
    if (bookmark !== undefined) rows.push({ bookmark, reason: item.reason });
  }

  return rows;
}

/** 결과 행 하나 — 팔레트 결과 행과 같은 열기 계약(기록·토스트·닫기, 가운데 클릭은 닫지 않음). */
function AiRow({
  bookmark,
  detail,
  categoryName,
  onClose,
}: {
  bookmark: BookmarkWithCount;
  /** 우측 넓은 칸에 적을 글 — AI 근거(why)거나, 폴백이면 링크 설명이다. */
  detail: string;
  categoryName: string;
  onClose: () => void;
}) {
  const report = () => {
    recordClick(bookmark.id);
    toast(openToastText(bookmark.title));
  };

  return (
    <a
      href={bookmark.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => {
        report();
        onClose();
      }}
      onAuxClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (event.button === 1) report();
      }}
      className={ROW}
    >
      <FaviconTile bookmark={bookmark} size={26} />

      <span className="w-[230px] min-w-0 flex-none">
        <span className="block truncate text-[14px] font-semibold">{bookmark.title}</span>
        <span className="block truncate text-[10.5px] text-fainter">{hostOf(bookmark.url)}</span>
      </span>

      <span className="min-w-0 flex-1 truncate text-[12.5px] text-sub">{detail}</span>

      {categoryName !== '' && (
        <span className="flex-none rounded-[4px] border border-[#e7e3dc] bg-side px-[8px] py-[2px] text-[10.5px] text-[#5a5651]">
          {categoryName}
        </span>
      )}
    </a>
  );
}

/** 로딩 — 점 3개가 차례로 켜졌다 꺼진다. */
function Loading() {
  // `animate-[name_duration_delay_infinite]` — 두 번째 시간값이 지연이다(프로토타입 .18s·.36s).
  const dot = 'size-[5px] flex-none rounded-full bg-ink';

  return (
    <div data-testid="ai-loading" className={`${HEADER} py-[20px]`}>
      <style>{DOT_KEYFRAMES}</style>
      <span className="flex gap-[4px]">
        <span className={`${dot} motion-safe:animate-[palette-ai-dot_1.1s_infinite]`} />
        <span className={`${dot} motion-safe:animate-[palette-ai-dot_1.1s_0.18s_infinite]`} />
        <span className={`${dot} motion-safe:animate-[palette-ai-dot_1.1s_0.36s_infinite]`} />
      </span>
      <span className="text-[12.5px] text-sub">뜻이 비슷한 링크를 찾는 중</span>
    </div>
  );
}

/** 안내(빈 결과·오류) — 제목 + 부제. 팔레트 0건 안내와 같은 크기다. */
function Notice({ title, sub }: { title: string; sub: string }) {
  return (
    <div data-testid="ai-notice" className={NOTICE}>
      <div className="mb-[7px] text-[14.5px] font-bold">{title}</div>
      <div className="text-[12.5px] leading-[1.75] text-desc">{sub}</div>
    </div>
  );
}

/** 결과 목록(성공·폴백 공유) — 헤더 한 줄 + 60px 행들. */
function Hits({
  title,
  note,
  tookMs,
  rows,
  categoryNames,
  onClose,
  useReason,
}: {
  title: string;
  note: string;
  tookMs: number;
  rows: { bookmark: BookmarkWithCount; reason: string | null }[];
  categoryNames: Map<string, string>;
  onClose: () => void;
  /** true 면 우측 칸에 AI 근거를, false(폴백) 면 링크 설명을 적는다. */
  useReason: boolean;
}) {
  return (
    <div data-testid="ai-hits">
      <div className={`${HEADER} border-b py-[12px]`}>
        <span className="text-[12.5px] font-bold">{title}</span>
        <span className="text-[11.5px] text-desc">{note}</span>
        <span className="ml-auto text-[10.5px] text-fainter">{tookLabel(tookMs)}</span>
      </div>
      {rows.map(({ bookmark, reason }) => (
        <AiRow
          key={bookmark.id}
          bookmark={bookmark}
          detail={(useReason ? reason : null) ?? bookmark.description ?? ''}
          categoryName={categoryLabel(bookmark, categoryNames)}
          onClose={onClose}
        />
      ))}
    </div>
  );
}

export type AiSearchResultsProps = {
  /** 훅이 쥔 상태(idle 은 호스트가 걸러 여기로 오지 않는다). */
  state: Exclude<AiSearchState, { status: 'idle' }>;
  /** 결과 id 를 실제 링크로 잇고, 분류 이름을 붙이는 데 쓴다. */
  data: SiteData;
  /** 왼쪽 클릭으로 링크를 연 뒤 팔레트를 닫는다(호스트의 closePalette). */
  onClose: () => void;
};

export function AiSearchResults({ state, data, onClose }: AiSearchResultsProps) {
  if (state.status === 'loading') return <Loading />;

  const { query, result } = state;

  if (!result.ok) {
    return <Notice title="AI 검색을 실행하지 못했습니다" sub="잠시 후 다시 시도해 주세요" />;
  }

  const { source, reason, results, tookMs } = result.response;
  const items = Array.isArray(results) ? results : [];
  const byId = new Map(data.bookmarks.map((bookmark) => [bookmark.id, bookmark]));
  const categoryNames = new Map(data.categories.map((category) => [category.id, category.name]));

  if (source === 'ai') {
    // 빈 AI 결과는 폴백이 아니라 "의미상 못 찾음"이다(reason:'ok', results:[]).
    if (items.length === 0) {
      return (
        <Notice
          title="AI가 의미상 맞는 링크를 찾지 못했습니다"
          sub={`“${query}” — 다른 말로 다시 물어보세요`}
        />
      );
    }

    return (
      <Hits
        title={`AI가 의미로 찾은 링크 ${resolve(items, byId).length}건`}
        note="이름이 안 겹쳐도 하는 일이 맞으면 가져옵니다"
        tookMs={tookMs}
        rows={resolve(items, byId)}
        categoryNames={categoryNames}
        onClose={onClose}
        useReason
      />
    );
  }

  // source === 'keyword' — 폴백. rate-limit 만 DB 를 건드리지 않은 구분 안내다.
  if (reason === 'rate-limit') {
    return (
      <Notice
        title="AI 검색 요청이 많습니다"
        sub="잠시 후 다시 시도해 주세요"
      />
    );
  }

  const detail = REASON_DETAIL[reason];
  const rows = resolve(items, byId);

  if (rows.length === 0) {
    return <Notice title={detail} sub="이름 검색 결과도 없습니다" />;
  }

  return (
    <Hits
      title="이름 검색 결과로 대신합니다"
      note={detail}
      tookMs={tookMs}
      rows={rows}
      categoryNames={categoryNames}
      onClose={onClose}
      useReason={false}
    />
  );
}
