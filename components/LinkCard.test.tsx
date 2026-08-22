/**
 * C2. 링크 카드 — 홈·카테고리·즐겨찾기·매일이 공유하는 단 하나의 카드.
 * 수치의 원본은 docs/DESIGN_SPEC.md 2-1장이며, 이 테스트가 그 값을 고정한다.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinkCard, type LinkCardProps } from '@/components/LinkCard';
import type { BookmarkWithCount } from '@/lib/types';
import { middleClick, rightClick } from '@/test/events';
import { PENCIL_PATH, TRASH_PATH } from '@/test/icon-paths';

const BOOKMARK: BookmarkWithCount = {
  id: 'bm-1',
  category_id: 'cat-ai',
  title: 'ChatGPT',
  url: 'https://chat.openai.com/',
  description: 'AI 대화·문서 초안',
  tags: [],
  favicon_url: 'https://cdn.example.com/openai.png',
  is_pinned: true,
  source: 'manual',
  is_favorite: false,
  fav_order: 0,
  sort_order: 0,
  created_at: '2024-10-18T00:00:00.000Z',
  click_count: 3,
};

type Overrides = Omit<Partial<LinkCardProps>, 'bookmark'> & {
  bookmark?: Partial<BookmarkWithCount>;
};

function renderCard({ bookmark, ...props }: Overrides = {}) {
  const { container } = render(<LinkCard bookmark={{ ...BOOKMARK, ...bookmark }} {...props} />);

  return container.firstElementChild as HTMLElement;
}

/**
 * 카드의 개발 경고(`console.warn`)를 가로채고 스파이를 돌려준다.
 *
 * 경고 자체가 계약이라 없애지 않고 삼키기만 한다 — 무시된 슬롯 요청을 일부러 만드는 테스트가
 * 여럿이라, 그냥 두면 그 문구가 출력을 덮어 진짜 경고를 못 보게 된다. 복원은 아래 afterEach.
 */
function silenceWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

// spyOn 으로 만든 것만 되돌린다 — 개별 테스트의 vi.fn() 콜백은 건드리지 않는다.
afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * 파비콘 타일 — 본문과 같은 곳으로 가는 마우스 전용 보조 영역이라
 * 접근성 트리에서는 감춰져 있다(탭 순서 중복 제거). 그래서 role로 찾지 못한다.
 */
function faviconLink(): HTMLAnchorElement {
  const link = document.body.querySelector<HTMLAnchorElement>('a[aria-hidden="true"]');

  if (link === null) throw new Error('파비콘 앵커를 찾지 못했다');
  return link;
}

/** 본문 블록 — 접근성 이름은 이름 + 설명이다. */
const bodyLink = () => screen.getByRole('link', { name: /AI 대화·문서 초안/ });
const pinButton = () => screen.getByRole('button', { name: 'ChatGPT 즐겨찾기' });
const checkButton = () => screen.getByRole('button', { name: 'ChatGPT 선택' });
/** 관리자 전용 둘 (J1) — isAdmin 이 아닌 렌더에서는 존재 자체가 없다. */
const editButton = () => screen.getByRole('button', { name: 'ChatGPT 수정' });
const deleteButton = () => screen.getByRole('button', { name: 'ChatGPT 삭제' });

describe('LinkCard 렌더', () => {
  it('이름·설명·주소·클릭 수를 보여준다', () => {
    renderCard();

    expect(screen.getByText('ChatGPT')).toBeInTheDocument();
    expect(screen.getByText('AI 대화·문서 초안')).toBeInTheDocument();
    expect(screen.getByText('chat.openai.com')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('주소는 host만 보여준다 (www. 제거, 경로 제거)', () => {
    renderCard({ bookmark: { url: 'https://www.perplexity.ai/search?q=1' } });

    expect(screen.getByText('perplexity.ai')).toBeInTheDocument();
  });

  it('클릭 수가 0이어도 0으로 적는다', () => {
    renderCard({ bookmark: { click_count: 0 } });

    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('설명이 없으면 설명 줄을 그리지 않는다', () => {
    renderCard({ bookmark: { description: null } });

    expect(screen.getByText('ChatGPT')).toBeInTheDocument();
    expect(screen.queryByText('AI 대화·문서 초안')).not.toBeInTheDocument();
  });

  it('파비콘을 19px 배경 이미지로 타일 가운데에 그린다', () => {
    renderCard();

    expect(faviconLink()).toHaveStyle({
      backgroundImage: 'url("https://cdn.example.com/openai.png")',
    });
    expect(faviconLink()).toHaveClass('bg-[length:19px_19px]', 'bg-center', 'bg-no-repeat');
  });

  it('파비콘이 없으면 이미지 없이 회색 타일만 그린다', () => {
    renderCard({ bookmark: { favicon_url: null } });

    expect(faviconLink()).not.toHaveStyle({ backgroundImage: 'url("null")' });
    expect(faviconLink().style.backgroundImage).toBe('');
    expect(faviconLink()).toHaveClass('bg-side');
  });

  it('따옴표가 든 주소에서도 배경 선언이 살아남는다', () => {
    // 이스케이프하지 않으면 url() 문자열이 중간에서 닫혀 선언 전체가 무효가 되고
    // 파비콘이 통째로 사라진다.
    renderCard({ bookmark: { favicon_url: 'https://cdn.example.com/a").png' } });

    expect(faviconLink().style.backgroundImage).not.toBe('');
  });
});

describe('LinkCard 열기', () => {
  it('본문과 파비콘 둘 다 새 탭으로 가는 진짜 앵커다', () => {
    renderCard();

    // 앵커여야 가운데 클릭·Ctrl+클릭·우클릭 메뉴·상태바 미리보기가 살아난다.
    for (const link of [bodyLink(), faviconLink()]) {
      expect(link).toHaveAttribute('href', 'https://chat.openai.com/');
      expect(link).toHaveAttribute('target', '_blank');
      // 열린 탭이 window.opener를 잡지 못하게 막는다(reverse tabnabbing).
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('본문을 누르면 onOpen을 부른다', () => {
    const onOpen = vi.fn();
    renderCard({ onOpen });

    fireEvent.click(bodyLink());

    expect(onOpen).toHaveBeenCalledWith('bm-1');
  });

  it('파비콘을 눌러도 똑같이 onOpen을 부른다', () => {
    const onOpen = vi.fn();
    renderCard({ onOpen });

    fireEvent.click(faviconLink());

    expect(onOpen).toHaveBeenCalledWith('bm-1');
  });

  it('가운데 클릭(새 탭)도 기록한다', () => {
    const onOpen = vi.fn();
    renderCard({ onOpen });

    middleClick(bodyLink());
    middleClick(faviconLink());

    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenCalledWith('bm-1');
  });

  it('우클릭은 메뉴만 여는 것이라 기록하지 않는다', () => {
    const onOpen = vi.fn();
    renderCard({ onOpen });

    rightClick(bodyLink());

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('기본 이동을 막지 않는다 (브라우저가 연다)', () => {
    const onOpen = vi.fn();
    renderCard({ onOpen });

    // preventDefault를 부르면 dispatchEvent가 false를 돌려준다.
    expect(fireEvent.click(bodyLink())).toBe(true);
    expect(fireEvent.click(faviconLink())).toBe(true);
  });

  it('onOpen을 주지 않아도 앵커는 그대로 동작한다', () => {
    renderCard();

    expect(fireEvent.click(bodyLink())).toBe(true);
    expect(bodyLink()).toHaveAttribute('href', 'https://chat.openai.com/');
  });

  it('파비콘 타일은 탭 순서에 끼어들지 않는다 (본문과 목적지가 같다)', () => {
    renderCard();

    expect(faviconLink()).toHaveAttribute('tabindex', '-1');
    expect(faviconLink()).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('카드 바탕을 눌러도 열리지 않는다 (열기 영역은 파비콘과 본문뿐)', () => {
    const onOpen = vi.fn();
    const card = renderCard({ onOpen });

    fireEvent.click(card);

    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('LinkCard 핀', () => {
  /** 핀은 관리 도구다(2026-08-11) — 이 블록의 렌더는 전부 관리자 응답이다. */
  const renderPinCard = (props: Overrides = {}) => renderCard({ isAdmin: true, ...props });

  it('관리자에게는 기본으로 핀을 보여준다', () => {
    renderPinCard();

    expect(pinButton()).toBeInTheDocument();
  });

  it('비관리자 응답에는 핀 마크업이 아예 실리지 않는다 (감추는 것이 아니다)', () => {
    // 즐겨찾기가 공용이 된 뒤 담는 일은 관리자 몫이다. 연필·휴지통과 같은 규칙 —
    // 늘 그려 두고 CSS 로 감추면 방문자 응답에 관리 도구가 남는다(README 주의사항 7).
    renderCard({ isAdmin: false });

    expect(screen.queryByRole('button', { name: 'ChatGPT 즐겨찾기' })).not.toBeInTheDocument();
  });

  it('핀을 누르면 onToggleFav만 부르고 링크는 열지 않는다', () => {
    const onToggleFav = vi.fn();
    const onOpen = vi.fn();
    renderPinCard({ onToggleFav, onOpen });

    fireEvent.click(pinButton());

    // 담긴 상태는 넘기지 않는다 — 카드가 받은 북마크에 이미 실려 있다.
    expect(onToggleFav).toHaveBeenCalledWith('bm-1');
    expect(onOpen).not.toHaveBeenCalled();
    // 앵커 밖의 형제 요소라 클릭이 앵커로 새지 않는다.
    expect(pinButton().closest('a')).toBeNull();
  });

  it('showPin=false면 관리자에게도 핀을 그리지 않는다 (홈의 운영 중 섹션)', () => {
    renderPinCard({ showPin: false });

    expect(screen.queryByRole('button', { name: 'ChatGPT 즐겨찾기' })).not.toBeInTheDocument();
  });

  it('꺼짐 상태는 흐린 회색이고 속이 비어 있다', () => {
    renderPinCard({ bookmark: { is_favorite: false } });

    expect(pinButton()).toHaveClass('text-ghost');
    expect(pinButton()).toHaveAttribute('aria-pressed', 'false');
    expect(pinButton().querySelector('svg')).toHaveAttribute('fill', 'none');
  });

  it('켜짐 상태는 진한 글자 + 선택 배경 + 채운 핀이다 — 판정은 북마크의 is_favorite 이다', () => {
    renderPinCard({ bookmark: { is_favorite: true } });

    expect(pinButton()).toHaveClass('text-ink', 'bg-select');
    expect(pinButton()).toHaveAttribute('aria-pressed', 'true');
    expect(pinButton().querySelector('svg')).toHaveAttribute('fill', 'currentColor');
  });
});

describe('LinkCard 체크', () => {
  it('기본으로는 체크를 그리지 않는다', () => {
    renderCard();

    expect(screen.queryByRole('button', { name: 'ChatGPT 선택' })).not.toBeInTheDocument();
  });

  it('showCheck=true면 체크를 그린다 (카테고리·매일·즐겨찾기 목록)', () => {
    renderCard({ showCheck: true });

    expect(checkButton()).toBeInTheDocument();
  });

  it('체크를 누르면 onToggleCheck만 부르고 링크는 열지 않는다', () => {
    const onToggleCheck = vi.fn();
    const onOpen = vi.fn();
    renderCard({ showCheck: true, onToggleCheck, onOpen });

    fireEvent.click(checkButton());

    expect(onToggleCheck).toHaveBeenCalledWith('bm-1');
    expect(onOpen).not.toHaveBeenCalled();
    expect(checkButton().closest('a')).toBeNull();
  });

  it('꺼짐 상태는 흐린 회색이다', () => {
    renderCard({ showCheck: true });

    expect(checkButton()).toHaveClass('text-check-off');
    expect(checkButton()).toHaveAttribute('aria-pressed', 'false');
  });

  it('켜짐 상태는 검은 배경 + 흰 체크다', () => {
    renderCard({ showCheck: true, checked: true });

    expect(checkButton()).toHaveClass('bg-ink', 'text-white');
    expect(checkButton()).toHaveAttribute('aria-pressed', 'true');
  });

  it('상단 액션 순서는 체크 → 핀이다', () => {
    // 핀은 관리자에게만 보이므로(2026-08-11) 둘 다 서는 화면은 관리자 화면뿐이다.
    const card = renderCard({ showCheck: true, isAdmin: true });
    const labels = [...card.querySelectorAll('button[aria-pressed]')].map((button) =>
      button.getAttribute('aria-label'),
    );

    expect(labels).toEqual(['ChatGPT 선택', 'ChatGPT 즐겨찾기']);
  });
});

describe('LinkCard 테두리 3상태', () => {
  it('기본은 카드 테두리(--color-card-border)다', () => {
    expect(renderCard()).toHaveClass('border-card-border');
  });

  it('즐겨찾기에 담긴 카드는 --color-fav-border다', () => {
    const card = renderCard({ bookmark: { is_favorite: true } });

    expect(card).toHaveClass('border-fav-border');
    expect(card).not.toHaveClass('border-card-border');
  });

  it('체크된 카드는 --color-ink다', () => {
    const card = renderCard({ showCheck: true, checked: true });

    expect(card).toHaveClass('border-ink');
    expect(card).not.toHaveClass('border-card-border');
  });

  it('체크가 즐겨찾기보다 우선한다', () => {
    const card = renderCard({ showCheck: true, checked: true, bookmark: { is_favorite: true } });

    expect(card).toHaveClass('border-ink');
    expect(card).not.toHaveClass('border-fav-border');
  });

  it('체크를 감춘 화면에서는 checked가 테두리를 바꾸지 못한다', () => {
    // 체크가 보이지 않는데 테두리만 검게 변하면 이유를 알 수 없는 상태가 된다.
    const card = renderCard({ showCheck: false, checked: true, bookmark: { is_favorite: true } });

    expect(card).toHaveClass('border-fav-border');
    expect(card).not.toHaveClass('border-ink');
  });
});

/**
 * J1. 현장 편집 노출 — 연필·휴지통은 **서버가 관리자로 확인했을 때만 렌더된다**.
 *
 * 숨기는 것이 아니라 **없는 것**이어야 한다(README 주의사항 7): 비관리자 렌더 결과에는
 * 버튼도, 아이콘 path 도 남지 않는다. 그래서 아래 첫 테스트가 role 조회뿐 아니라
 * 마크업 원문(스펙 2-1 의 path 문자열)까지 본다 — display:none 류의 회귀를 잡는 유일한 단언이다.
 */
describe('LinkCard 관리자 — 연필·휴지통 (J1)', () => {
  it('기본(비관리자)에는 연필·휴지통이 렌더되지 않는다 — 마크업 자체가 없다', () => {
    const card = renderCard({ showCheck: true });

    expect(screen.queryByRole('button', { name: /수정$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /삭제$/ })).not.toBeInTheDocument();
    // 감춘 것이 아니라 그리지 않은 것이다 — 아이콘 path 도 남지 않아야 한다.
    expect(card.innerHTML).not.toContain(PENCIL_PATH);
    expect(card.innerHTML).not.toContain(TRASH_PATH);
  });

  it('isAdmin=false 를 명시해도 마찬가지다', () => {
    const card = renderCard({ isAdmin: false, showCheck: true });

    expect(card.innerHTML).not.toContain(PENCIL_PATH);
    expect(card.innerHTML).not.toContain(TRASH_PATH);
  });

  it('isAdmin=true 면 체크 → 핀 → 연필 → 휴지통 순으로 넷을 그린다 (스펙 2-1 아이콘 표)', () => {
    const card = renderCard({ isAdmin: true, showCheck: true });
    const labels = [...card.querySelectorAll('button')].map((button) =>
      button.getAttribute('aria-label'),
    );

    expect(labels).toEqual([
      'ChatGPT 선택',
      'ChatGPT 즐겨찾기',
      'ChatGPT 수정',
      'ChatGPT 삭제',
    ]);
  });

  it('핀을 감춘 화면(홈의 매일·운영 중)에서도 관리자에게는 연필·휴지통이 보인다', () => {
    renderCard({ isAdmin: true, showPin: false });

    expect(editButton()).toBeInTheDocument();
    expect(deleteButton()).toBeInTheDocument();
  });

  it('연필: 21×21 액션 규약 + 꺼짐 #8b877f · 호버 배경 #efede8 + 잉크', () => {
    renderCard({ isAdmin: true });

    expect(editButton()).toHaveClass(
      'size-[21px]',
      'shrink-0',
      'rounded-[6px]',
      'cursor-pointer',
      'relative',
      'before:absolute',
      'before:-inset-y-[11.5px]',
      'before:-inset-x-[0.5px]',
      'text-faint',
      'hover:bg-[#efede8]',
      'hover:text-ink',
    );
  });

  it('휴지통: 같은 액션 규약이지만 호버만 위험 색이다 — 배경 #f4e8e6 + #a8443a', () => {
    renderCard({ isAdmin: true });

    expect(deleteButton()).toHaveClass(
      'size-[21px]',
      'shrink-0',
      'rounded-[6px]',
      'cursor-pointer',
      'relative',
      'before:absolute',
      'before:-inset-y-[11.5px]',
      'before:-inset-x-[0.5px]',
      'text-faint',
      'hover:bg-[#f4e8e6]',
      'hover:text-danger',
    );
    // 공용 호버 배경을 함께 달면 두 규칙이 다투고 승자는 CSS 출력 순서가 정한다.
    expect(deleteButton()).not.toHaveClass('hover:bg-[#efede8]');
  });

  /**
   * 연필은 카드 안에서 폼을 여닫는 버튼이라 그 상태를 이름 말고 `aria-expanded` 로도 알린다.
   * 값의 근거는 `isEditing` 플래그가 아니라 **본문이 실제로 슬롯으로 바뀌었는지**다 —
   * 플래그만 오고 슬롯이 비어 교체를 건너뛴 경우까지 참이라고 말하면, 화면을 볼 수 없는
   * 사용자에게만 있지도 않은 폼이 열렸다고 알리는 셈이 된다.
   */
  it.each([
    ['평소', {}, 'false'],
    ['플래그+슬롯이 갖춰져 실제로 교체됐을 때', { isEditing: true, editSlot: <div /> }, 'true'],
    ['플래그만 와서 교체를 건너뛴 때', { isEditing: true }, 'false'],
  ] as [string, Overrides, string][])(
    '연필의 aria-expanded: %s → %s',
    (_label, props, expected) => {
      silenceWarn();
      renderCard({ isAdmin: true, ...props });

      expect(editButton()).toHaveAttribute('aria-expanded', expected);
    },
  );

  it('휴지통에는 aria-expanded 를 달지 않는다 — 오버레이는 카드 밖 상태다', () => {
    // 삭제 확인은 카드가 여는 것이 아니라 화면이 얹는 오버레이(deleteSlot)라, 이 버튼이
    // 무엇을 펼쳤다고 말할 근거가 없다. J3 이 필요를 느끼면 그때 오버레이와 함께 배선한다.
    renderCard({ isAdmin: true });

    expect(deleteButton()).not.toHaveAttribute('aria-expanded');
  });

  it('연필·휴지통을 눌러도 링크를 열지 않는다 (열기 영역은 파비콘·본문뿐)', () => {
    const onOpen = vi.fn();
    renderCard({ isAdmin: true, onOpen });

    fireEvent.click(editButton());
    fireEvent.click(deleteButton());

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('onEdit·onDelete 는 그 카드의 id 를 돌려준다 (J2·J3 이 소비할 slot)', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    renderCard({ isAdmin: true, onEdit, onDelete });

    fireEvent.click(editButton());
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith('bm-1');

    fireEvent.click(deleteButton());
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith('bm-1');
  });

  it('콜백이 없어도(J1 시점 기본값) 클릭이 터지지 않는다', () => {
    renderCard({ isAdmin: true });

    expect(() => {
      fireEvent.click(editButton());
      fireEvent.click(deleteButton());
    }).not.toThrow();
  });
});

/**
 * J1 픽스업. 카드가 J2·J3 에게 열어 주는 **상태 슬롯 둘** — 계획서 5장 3단계 주의 칸의
 * "LinkCard.tsx의 연필·휴지통 배선(핸들러·상태 슬롯)은 J1 산출물"을 지키는 자리다.
 *
 * 두 스토리가 이 파일을 다시 열지 않아야 서로 병렬 안전하므로, 여기서 계약을 못 박는다:
 * `editSlot` 은 본문+하단 줄을 **교체**하고, `deleteSlot` 은 마지막 자식으로 **덧댄다**.
 */
describe('LinkCard 상태 슬롯 (J2·J3 인계)', () => {
  const editForm = () => <div data-testid="edit-slot">편집 폼</div>;
  const deleteOverlay = () => (
    <div data-testid="delete-slot" className="absolute inset-0 z-[6]">
      이 링크를 삭제할까요
    </div>
  );

  describe('editSlot — 본문 + 하단 줄 교체', () => {
    it('isEditing + editSlot 이면 본문 블록과 하단 줄이 슬롯으로 바뀐다', () => {
      renderCard({ isEditing: true, editSlot: editForm() });

      expect(screen.getByTestId('edit-slot')).toBeInTheDocument();
      // 교체 범위: 이름·설명이 든 본문 앵커 + 주소·클릭 수가 든 하단 줄.
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(screen.queryByText('ChatGPT')).not.toBeInTheDocument();
      expect(screen.queryByText('AI 대화·문서 초안')).not.toBeInTheDocument();
      expect(screen.queryByText('chat.openai.com')).not.toBeInTheDocument();
      expect(screen.queryByText('3')).not.toBeInTheDocument();
    });

    it('교체해도 상단 줄은 남는다 — 스펙 2-1 이 바꾸라는 것은 본문·하단뿐이다', () => {
      // 파비콘 타일·체크·핀·연필·휴지통은 편집 중에도 그대로다. 액션 줄을 isEditing 으로
      // 감추려면 DESIGN_SPEC 2-1 "인라인 편집"부터 고쳐야 한다.
      renderCard({ isEditing: true, editSlot: editForm(), isAdmin: true, showCheck: true });

      expect(faviconLink()).toBeInTheDocument();
      expect(checkButton()).toBeInTheDocument();
      expect(pinButton()).toBeInTheDocument();
      expect(editButton()).toBeInTheDocument();
      expect(deleteButton()).toBeInTheDocument();
    });

    it('editSlot 만 주고 isEditing 이 없으면 무시한다', () => {
      renderCard({ editSlot: editForm() });

      expect(screen.queryByTestId('edit-slot')).not.toBeInTheDocument();
      expect(screen.getByText('ChatGPT')).toBeInTheDocument();
      expect(screen.getByText('chat.openai.com')).toBeInTheDocument();
    });

    it('isEditing 만 주고 editSlot 이 없으면 본문을 지우지 않는다 (빈 카드 금지)', () => {
      silenceWarn();
      renderCard({ isEditing: true });

      expect(screen.getByText('ChatGPT')).toBeInTheDocument();
      expect(screen.getByText('AI 대화·문서 초안')).toBeInTheDocument();
      expect(screen.getByText('chat.openai.com')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    /**
     * `editSlot={cond && <Form/>}` 은 이 프로젝트에서 가장 쓰기 쉬운 관용구이고, cond 가 거짓이면
     * 슬롯에 **false** 가 담겨 온다. "undefined·null 이 아니면 노드"로 보면 그 한 줄이 곧바로
     * 교체를 발동시켜, 폼은 없는데 본문만 사라진 빈 카드가 된다. 기준은 값의 종류가 아니라
     * **React 가 무언가를 그리는가**여야 한다.
     *
     * `true` 도 같은 줄에 세운다 — `cond || <Form/>` 는 cond 가 참일 때 **true** 를 넘기고,
     * React 는 그 값 역시 아무것도 그리지 않는다. `false` 한 값만 막아 두면 규칙과 구현이
     * 여기서 어긋나 같은 빈 카드가 다시 열린다.
     */
    it.each([
      ['false — `cond && <Form/>` 의 거짓 가지', false],
      ['true — `cond || <Form/>` 의 참 가지', true],
      ['빈 문자열', ''],
    ] as const)('editSlot 이 %s 면 슬롯 없음으로 보고 본문을 남긴다', (_label, slot) => {
      silenceWarn();
      renderCard({ isEditing: true, editSlot: slot });

      expect(screen.getByText('ChatGPT')).toBeInTheDocument();
      expect(screen.getByText('AI 대화·문서 초안')).toBeInTheDocument();
      expect(screen.getByText('chat.openai.com')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('0 은 React 가 "0" 으로 그리므로 슬롯이다 — 넓게 잡아 정상 노드를 버리지 않는다', () => {
      renderCard({ isEditing: true, editSlot: 0 });

      expect(screen.getByText('0')).toBeInTheDocument();
      expect(screen.queryByText('ChatGPT')).not.toBeInTheDocument();
    });
  });

  /**
   * 개발 중 경고는 **한 방향뿐**이다 — "플래그는 켰는데 슬롯이 비었다"만 알린다.
   * 그 반대(슬롯만 있고 isEditing=false)는 폼 노드를 미리 만들어 넘기는 정상 사용법이라,
   * 경고를 걸면 목록을 한 번 그릴 때마다 카드 수만큼 콘솔이 쏟아진다.
   */
  describe('무시된 요청의 개발 경고', () => {
    it('isEditing 만 켜져 있으면 한 번 경고한다', () => {
      const warn = silenceWarn();
      renderCard({ isEditing: true });

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain('bm-1');
    });

    it('editSlot 이 false 여도 같은 경고다 — 그 값도 슬롯 없음이다', () => {
      const warn = silenceWarn();
      renderCard({ isEditing: true, editSlot: false });

      expect(warn).toHaveBeenCalledTimes(1);
    });

    const QUIET_CASES: [string, Overrides][] = [
      ['슬롯만 주고 플래그가 없을 때', { editSlot: <div /> }],
      ['둘 다 갖춰졌을 때', { isEditing: true, editSlot: <div /> }],
      ['둘 다 없을 때', {}],
    ];

    it.each(QUIET_CASES)('%s 는 경고하지 않는다', (_label, props) => {
      const warn = silenceWarn();
      renderCard(props);

      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('deleteSlot — 카드 위 오버레이 자리', () => {
    it('주면 카드 컨테이너의 마지막 자식으로 그린다', () => {
      const card = renderCard({ deleteSlot: deleteOverlay() });

      expect(card.lastElementChild).toBe(screen.getByTestId('delete-slot'));
    });

    it('카드는 위치·스타일을 강제하지 않는다 — 준 노드를 그대로 둔다', () => {
      // `absolute inset-0 z-[6]` 은 스펙 2-1 "삭제 확인"이 오버레이 자신의 것으로 적은 값이라
      // J3 의 컴포넌트가 갖는다. 카드가 감싸거나 클래스를 얹으면 그 계약이 깨진다.
      renderCard({ deleteSlot: deleteOverlay() });
      const overlay = screen.getByTestId('delete-slot');

      expect(overlay).toHaveClass('absolute', 'inset-0', 'z-[6]');
      expect(overlay.parentElement).toHaveClass('relative', 'overflow-hidden');
    });

    it('덧대기라서 본문을 지우지 않는다 — 오버레이가 배경으로 덮는다', () => {
      renderCard({ deleteSlot: deleteOverlay() });

      expect(screen.getByText('ChatGPT')).toBeInTheDocument();
      expect(screen.getByText('chat.openai.com')).toBeInTheDocument();
    });

    it('편집 슬롯과 동시에 열려도 서로를 밀어내지 않는다', () => {
      const card = renderCard({
        isEditing: true,
        editSlot: editForm(),
        deleteSlot: deleteOverlay(),
      });

      expect(screen.getByTestId('edit-slot')).toBeInTheDocument();
      expect(card.lastElementChild).toBe(screen.getByTestId('delete-slot'));
    });
  });

  describe('슬롯을 쓰지 않은 렌더는 슬롯이 없던 때와 같다', () => {
    it('카드의 자식은 상단 줄·본문·하단 줄 셋뿐이다 — 빈 슬롯이 노드를 남기지 않는다', () => {
      // 교체 분기의 프래그먼트도, 비어 있는 deleteSlot 도 DOM 에 아무것도 만들지 않아야 한다.
      const card = renderCard();

      expect(card.children).toHaveLength(3);
      expect(card.lastElementChild).toBe(screen.getByText('chat.openai.com').parentElement);
    });

    it('슬롯 prop 을 비워 넘겨도 마크업 원문이 한 글자도 달라지지 않는다', () => {
      const plain = renderCard();
      const withEmptySlots = renderCard({
        isEditing: false,
        editSlot: undefined,
        deleteSlot: undefined,
      });

      expect(withEmptySlots.outerHTML).toBe(plain.outerHTML);
    });
  });

  it('슬롯은 관리자 판정을 건드리지 않는다 — 비관리자 마크업은 여전히 0이다', () => {
    // 슬롯을 열어 준 것과 연필·휴지통을 그리는 조건은 별개다(README 주의사항 7).
    const card = renderCard({
      isEditing: true,
      editSlot: editForm(),
      deleteSlot: deleteOverlay(),
      showCheck: true,
    });

    expect(screen.queryByRole('button', { name: /수정$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /삭제$/ })).not.toBeInTheDocument();
    expect(card.innerHTML).not.toContain(PENCIL_PATH);
    expect(card.innerHTML).not.toContain(TRASH_PATH);
  });
});

describe('LinkCard 수치 (DESIGN_SPEC 2-1)', () => {
  it('컨테이너: relative·overflow hidden·radius 10px·min-h 126px(모바일 104px)·패딩 12px(모바일 10px)', () => {
    const card = renderCard();

    expect(card).toHaveClass(
      'relative',
      'overflow-hidden',
      'bg-card',
      'border',
      'rounded-[10px]',
      'flex',
      'flex-col',
      'gap-[6px]',
      'p-[10px]',
      'min-[820px]:p-[12px]',
      // 고정 높이 — min-height 가 아니다. 하한이면 제목 줄 수에 따라 카드가 커져 격자 행마다
      // 높이가 달라진다(components/card/geometry.ts).
      'h-[176px]',
      'min-[820px]:h-[180px]',
      'shadow-[0_1px_2px_rgba(20,21,22,.04)]',
    );
    expect(card.className).not.toMatch(/min-h-\[/);
  });

  it('컨테이너 호버: 테두리 ink + scale(1.05) + 그림자 + z-index 5, transition 0.22s', () => {
    const card = renderCard();

    expect(card).toHaveClass(
      'hover:border-ink',
      // 확대는 motion-safe 로만 건다 — 움직임을 꺼 둔 사용자에게는 규칙 자체가 컴파일되지 않는다(D5).
      'motion-safe:hover:[transform:scale(1.05)]',
      'hover:shadow-[0_10px_26px_rgba(20,21,22,.14)]',
      'hover:z-[5]',
      '[transition:transform_.22s_cubic-bezier(.22,.9,.28,1),box-shadow_.22s_ease,border-color_.22s_ease]',
    );
  });

  it('확대를 무조건부로 걸지 않는다 — prefers-reduced-motion 가드', () => {
    const card = renderCard();

    // motion-safe 없는 hover:[transform:...] 이 남아 있으면 우선순위 다툼이 생긴다.
    // 클래스 이름을 통째로 적지 않고 정규식으로 본다 — 적으면 Tailwind 스캐너가 그 문자열을
    // 후보로 주워 쓰지 않는 유틸이 최종 CSS 에 실린다.
    expect(card.className).not.toMatch(/(?:^|\s)hover:\[transform/);
  });

  it('상단 줄: min-h 32px, align-items flex-start, gap 4px', () => {
    const topRow = renderCard().firstElementChild;

    expect(topRow).toHaveClass('flex', 'items-start', 'gap-[4px]', 'min-h-[32px]');
  });

  it('파비콘 타일: 32px, 흰 배경 + 1px 기본 테두리 + radius 9px', () => {
    renderCard();

    expect(faviconLink()).toHaveClass(
      'size-[32px]',
      'shrink-0',
      'rounded-[9px]',
      'bg-card',
      'border',
      'border-border',
    );
  });

  it('액션 줄: margin-left auto, gap 1px, 우측 정렬, 줄바꿈 허용', () => {
    renderCard();
    const actions = faviconLink().nextElementSibling;

    expect(actions).toHaveClass(
      'ml-auto',
      'flex',
      'items-center',
      'justify-end',
      'flex-wrap',
      'gap-px',
      'min-w-0',
    );
  });

  it('액션 버튼: 21×21px, radius 6px, 호버 배경 #efede8', () => {
    renderCard({ showCheck: true, isAdmin: true });

    for (const button of [checkButton(), pinButton()]) {
      expect(button).toHaveClass(
        'size-[21px]',
        'shrink-0',
        'rounded-[6px]',
        'hover:bg-[#efede8]',
        'cursor-pointer',
      );
    }
  });

  it('액션 버튼의 손가락 자리를 세로 44px 로 넓힌다 — 보이는 크기(21×21)는 그대로', () => {
    renderCard({ showCheck: true, isAdmin: true });

    for (const button of [checkButton(), pinButton()]) {
      // ::before 로만 넓힌다 — 버튼 상자를 키우면 스펙 2-1의 21×21이 깨진다.
      expect(button).toHaveClass(
        'size-[21px]',
        'relative',
        'before:absolute',
        'before:-inset-y-[11.5px]',
        'before:-inset-x-[0.5px]',
      );
    }
  });

  it('본문 블록: margin-top auto, 이름 13.5px/600 2줄, 설명 12px 3줄', () => {
    renderCard();

    expect(bodyLink()).toHaveClass('mt-auto', 'block', 'w-full', 'cursor-pointer');
    expect(screen.getByText('ChatGPT')).toHaveClass(
      'block',
      'text-[13px]',
      'min-[820px]:text-[13.5px]',
      'font-semibold',
      'leading-[1.3]',
      'tracking-[-0.01em]',
      'max-h-[2.6em]',
      'overflow-hidden',
    );
    expect(screen.getByText('AI 대화·문서 초안')).toHaveClass(
      'block',
      'text-[12px]',
      'text-desc',
      'leading-[1.4]',
      // 3줄 — 설명을 "이 서비스가 무엇인가" 한 문장으로 다시 쓰면서 2줄에서 늘렸다.
      'max-h-[4.2em]',
      'overflow-hidden',
      'mt-[4px]',
    );
  });

  it('하단 줄: margin-top 5px, gap 8px / 주소 10.5px 1줄 말줄임 / 클릭 수 11px/600', () => {
    const card = renderCard();
    const host = screen.getByText('chat.openai.com');
    const bottomRow = host.parentElement;

    expect(bottomRow).toBe(card.lastElementChild);
    expect(bottomRow).toHaveClass('flex', 'items-center', 'gap-[8px]', 'mt-[5px]');
    expect(host).toHaveClass('flex-1', 'min-w-0', 'truncate', 'text-[10.5px]', 'text-muted');
    expect(screen.getByText('3')).toHaveClass(
      'flex',
      'shrink-0',
      'items-center',
      'gap-[4px]',
      'text-[11px]',
      'font-semibold',
      'text-faint',
    );
  });

  it('클릭 수 앞에는 12px 눈 아이콘이 붙는다', () => {
    renderCard();
    const eye = screen.getByText('3').querySelector('svg');

    expect(eye).toHaveAttribute('width', '12');
    expect(eye).toHaveAttribute('stroke-width', '2');
  });
});
