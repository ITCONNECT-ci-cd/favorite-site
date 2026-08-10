import Link from 'next/link';

import {
  CleanupGroupList,
  CleanupLinkList,
  type CleanupItem,
  type CleanupItemGroup,
} from '@/components/admin/CleanupSelection';
import {
  CLEANUP_RETENTION_DAYS,
  type AbandonedBookmark,
  type CleanupBookmark,
  type DomainGroup,
  type DuplicateUrlGroup,
  type RetentionDays,
} from '@/lib/cleanup';
import { ADMIN_CLEANUP_PATH } from '@/lib/routes';
import { hostOf } from '@/lib/url';

/**
 * M2 — 관리자 정리 도구 본문 (DESIGN_SPEC 6장 "정리 도구", 프로토타입 545–595행 실측).
 *
 * 판정은 M1(`lib/cleanup.ts`)이 하고, 여기서는 넘어온 세 구역을 표시만 한다.
 *   ① 같은 주소를 두 번 등록  — 완전 동일 URL 중복(정리 대상).
 *   ② 같은 도메인 · 서로 다른 페이지 — 참고용, **정리 대상이 아님**(그 사실을 화면에 명시).
 *   ③ 오래 손대지 않은 링크  — 기준 탭 30·90·180(기본)·365일. rpc 의존이라 없을 수 있다(아래).
 *
 * ## 왜 서버 컴포넌트이고, 기준 탭이 왜 URL(?days=)인가
 *
 * 통계(K2 StatsView)의 기간 탭은 클라이언트 `useState` 다 — 이미 받은 365일 배열을 `slice` 로
 * 다시 그릴 뿐 서버 왕복이 없기 때문이다. 정리 도구의 기준 탭은 사정이 다르다: 방치 판정은
 * 기준일마다 `cleanup_abandoned(retention_days)` **rpc 를 새로 쳐야** 하고(clicks 는 비공개라
 * DB 함수 몫 — M1), 잘라 쓸 상위 집합이 없다. 그래서 기준일은 URL 에 싣고(`?days=`) 서버가
 * 그 값으로 다시 조회한다. 탭은 `Link` 라 프리페치로 즉시 넘어간다.
 *
 * ## 클라이언트로 넘기는 것은 **줄에 그릴 세 칸뿐이다**
 *
 * 접힘·체크·일괄 삭제는 서버 왕복 없이 그 자리에서 일어나야 하므로 목록만
 * `components/admin/CleanupSelection.tsx`(클라이언트)로 떼어 냈다. 이 화면은 서버 컴포넌트로
 * 남아 **경계에서 자료를 깎는다**: 판정 결과를 통째로 넘기지 않고 `CleanupItem`(id·title·host)
 * 으로 접어 넘기므로, 방치 판정이 클릭 기록에서 끌어온 `last_clicked_at` 과 `created_at`·
 * `category_id` 는 클라이언트 경계를 넘지 않는다. 기준 탭·0건 안내·"정리 대상 아님" 명시처럼
 * 상호작용이 없는 것들도 여기 그대로 남는다.
 *
 * ## 한 북마크가 ①과 ②에 함께 뜰 수 있다 (M1 인계)
 *
 * 한 host 가 완전 중복 URL 과 서로 다른 페이지를 **둘 다** 가지면 그 중복 북마크는 ①과 ②에
 * 모두 등장한다(M1 findDomainGroups 의 distinct≥2 필터는 "중복뿐인 host"만 뺀다). 두 구역은
 * 서로 **독립한 목록**이라(키를 공유하지 않는다 — ①은 url, ②는 host, ③은 id) 겹쳐도 무해하다.
 * 체크 상태도 구역마다 따로다 — 목록 컴포넌트가 구역마다 하나씩 서서 각자 자기 선택을 든다
 * (CleanupSelection 의 "구역마다 따로 산다"). 시드엔 완전 중복이 0건이라 실제 겹침은 없지만,
 * 구조가 그 경우를 견딘다.
 *
 * `<main>` 은 페이지가 갖고(app/admin/cleanup/page.tsx), 본문 패딩·스크롤은 셸이 진다
 * (AdminShell 계약). 여기서는 그 안의 콘텐츠만 만든다.
 */
export type CleanupViewProps = {
  /** 현재 기준일 — URL `?days=` 가 정한다. 방치 부제·탭 선택이 이 값을 쓴다. */
  retentionDays: RetentionDays;
  /** ① 완전 동일 URL 중복 그룹(정리 대상). */
  duplicateUrlGroups: DuplicateUrlGroup[];
  /** ② 같은 host·다른 페이지 그룹(참고용, 정리 대상 아님). */
  domainGroups: DomainGroup[];
  /**
   * ③ 방치 후보. **null 은 "아직 집계 불가"** 다 — 0004 미적용 등으로 `cleanup_abandoned` rpc 가
   * 실패해 페이지가 ③만 접었다는 신호(빈 배열 `[]` 은 "방치가 0건"이라 뜻이 다르다).
   */
  abandoned: AbandonedBookmark[] | null;
};

/** 카드·패널 공통 상자 — 프로토타입 `background:#fff;border:1px solid #e3dfd9;border-radius:9px`. */
const PANEL = 'overflow-hidden rounded-[9px] border border-border bg-card';
/** 패널 머리 줄 — 프로토타입 `padding:14px 16px;border-bottom;background:#f7f5f2`. */
const PANEL_HEAD = 'border-b border-border bg-page px-[16px] py-[14px]';

/** 기준 탭 하나 — 프로토타입 579행: 높이 24px, 좌우 9px, 라운드 6px, 11px/600, 테두리 #ddd8d1. */
const TAB =
  'flex h-[24px] items-center rounded-[6px] border border-border-strong px-[9px] text-[11px] font-semibold whitespace-nowrap';
const TAB_ON = 'bg-ink text-white';
/** 비선택 탭의 글자색은 스펙 색상표에 없는 프로토타입 고유값 — 상단 탭·통계 기간 탭과 같은 임의 값. */
const TAB_OFF = 'bg-card text-[#3a3833]';

/** 안내문 한 줄 — 프로토타입 561행: `padding:18px 16px;font-size:12px;line-height:1.7`. */
const NOTICE = 'px-[16px] py-[18px] text-[12px] leading-[1.7]';

/** 그룹 안 제목들을 한 줄로 잇는다(프로토타입 `titles`). ②는 처음 6개까지(프로토타입 1143행). */
function titlesOf(bookmarks: readonly CleanupBookmark[], limit?: number): string {
  const list = limit === undefined ? bookmarks : bookmarks.slice(0, limit);

  return list.map((bookmark) => bookmark.title).join(' · ');
}

/**
 * 판정 결과 한 건을 **줄에 그릴 만큼만** 접는다 — 이 세 칸이 클라이언트 경계를 넘는 전부다
 * (위 JSDoc "클라이언트로 넘기는 것은 줄에 그릴 세 칸뿐이다"). 주소는 여기서 host 로 바꿔 넘긴다:
 * `hostOf` 는 카드 하단 줄과 같은 규칙이라 판정과 화면이 어긋나지 않고, 원본 url 은 줄에 쓰이지
 * 않으므로 함께 보낼 이유가 없다.
 */
function toItem(bookmark: CleanupBookmark): CleanupItem {
  return { id: bookmark.id, title: bookmark.title, host: hostOf(bookmark.url) };
}

/** ① 완전 동일 URL 그룹 → 접었다 펴는 그룹. 이름은 host 지만 키는 url 이다(같은 host 의 다른 중복과 갈린다). */
function toDuplicateGroups(groups: readonly DuplicateUrlGroup[]): CleanupItemGroup[] {
  return groups.map((group) => ({
    key: group.url,
    label: hostOf(group.url),
    preview: titlesOf(group.bookmarks),
    items: group.bookmarks.map(toItem),
  }));
}

/** ② 같은 host 그룹 → 접었다 펴는 그룹. */
function toDomainGroups(groups: readonly DomainGroup[]): CleanupItemGroup[] {
  return groups.map((group) => ({
    key: group.host,
    label: group.host,
    preview: titlesOf(group.bookmarks, 6),
    items: group.bookmarks.map(toItem),
  }));
}

export function CleanupView({
  retentionDays,
  duplicateUrlGroups,
  domainGroups,
  abandoned,
}: CleanupViewProps) {
  return (
    <div className="grid grid-cols-1 items-start gap-[18px] min-[820px]:grid-cols-2">
      {/* ── 좌: ① 완전 중복 + ② 도메인 (한 패널에 위아래로) ─────────────── */}
      <div className={PANEL}>
        <section aria-label="같은 주소를 두 번 등록">
          <div className={PANEL_HEAD}>
            <div className="text-[13px] font-bold text-ink">같은 주소를 두 번 등록</div>
            <div className="mt-[2px] text-[11.5px] text-desc">
              주소가 완전히 같은 것만 잡습니다 · {duplicateUrlGroups.length}건
            </div>
          </div>

          {duplicateUrlGroups.length === 0 ? (
            /* 0건 안내(DESIGN_SPEC 6장) — 빈 목록은 고장과 구분되지 않는다. */
            <p className={`${NOTICE} text-fainter`}>주소가 완전히 같은 중복은 없습니다.</p>
          ) : (
            <CleanupGroupList
              label="같은 주소를 두 번 등록"
              groups={toDuplicateGroups(duplicateUrlGroups)}
              tone="strong"
            />
          )}
        </section>

        <section aria-label="같은 도메인 · 서로 다른 페이지">
          {/* 프로토타입 563행: 상단 구분선 + 보조 툴바 배경으로 앞 구역과 나눈다. */}
          <div className="border-t border-line bg-toolbar px-[16px] py-[12px]">
            <div className="text-[12px] font-bold text-ink">같은 도메인 · 서로 다른 페이지</div>
            {/* 정리 대상이 아니라고 **항상** 명시한다(DESIGN_SPEC 6장) — 완전 중복(①)과 헷갈리지 않게.
                뒤 절은 그 문장과 아래 삭제 수단이 한 화면에서 반대되는 말로 읽히지 않게 붙였다:
                판정이 지우라고 하지 않을 뿐, 사람이 골라 지우는 길은 열려 있다(아래 주석). */}
            <div className="mt-[2px] text-[11.5px] text-fainter">
              서로 다른 서비스라 정리 대상이 아닙니다 · 직접 고른 것만 지웁니다
            </div>
          </div>

          {domainGroups.length === 0 ? (
            <p className={`${NOTICE} text-fainter`}>같은 도메인으로 묶이는 링크가 없습니다.</p>
          ) : (
            /* '정리 대상이 아닙니다'(위 안내)와 삭제 수단이 함께 있는 것은 모순이 아니다 — 그 문장은
               **자동으로 지울 대상이 아니라는 판정**이고, 여기서 지우는 것은 사람이 그룹을 펴서 보고
               고른 것뿐이다(사용자 요구: "같은 도메인이 겹치면 삭제"). */
            <CleanupGroupList
              label="같은 도메인 · 서로 다른 페이지"
              groups={toDomainGroups(domainGroups)}
              tone="soft"
            />
          )}
        </section>
      </div>

      {/* ── 우: ③ 방치 (기준 탭 + 목록) ─────────────────────────────── */}
      <section aria-label="오래 손대지 않은 링크" className={PANEL}>
        <div className={PANEL_HEAD}>
          <div className="flex items-center gap-[10px]">
            <span className="whitespace-nowrap text-[13px] font-bold text-ink">
              오래 손대지 않은 링크
            </span>
            <div role="group" aria-label="방치 판정 기준" className="flex gap-[5px]">
              {CLEANUP_RETENTION_DAYS.map((days) => {
                const active = days === retentionDays;

                return (
                  <Link
                    key={days}
                    href={`${ADMIN_CLEANUP_PATH}?days=${days}`}
                    /* 색만으로는 선택을 알릴 수 없다 — 스크린 리더는 배경색을 읽지 않는다. */
                    aria-current={active ? 'page' : undefined}
                    className={`${TAB} ${active ? TAB_ON : TAB_OFF}`}
                  >
                    {days}일
                  </Link>
                );
              })}
            </div>
          </div>

          {/* 부제는 방치 데이터가 있을 때만 — null(집계 불가)이면 아래 본문 안내가 대신 설명한다. */}
          {abandoned !== null && (
            <div className="mt-[2px] text-[11.5px] text-desc">
              {abandoned.length}개 · 최근 {retentionDays}일 동안 클릭 0회 + 등록한 지도 {retentionDays}
              일 지남
            </div>
          )}
        </div>

        {abandoned === null ? (
          /* 0004 미적용 등으로 rpc 가 없을 때 — ①②는 뜨고 ③만 이렇게 접힌다(페이지가 판단). */
          <p className={`${NOTICE} text-desc`}>
            오래 손대지 않은 링크는 아직 집계할 수 없습니다. 데이터베이스 정리 함수가 적용되면
            표시됩니다.
          </p>
        ) : abandoned.length === 0 ? (
          <p className={`${NOTICE} text-fainter`}>오래 손대지 않은 링크가 없습니다.</p>
        ) : (
          /* 프로토타입 587행이 장식으로 두었던 체크 자리가 여기서 실제 체크가 된다 — 방치 목록은
             줄이 전부 보이므로 구역 전체 선택도 함께 둔다(CleanupLinkList 주석). */
          <CleanupLinkList label="오래 손대지 않은 링크" items={abandoned.map(toItem)} />
        )}
      </section>
    </div>
  );
}
