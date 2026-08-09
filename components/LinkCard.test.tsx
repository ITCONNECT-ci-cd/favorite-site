/**
 * C2. 링크 카드 — 홈·카테고리·즐겨찾기·매일이 공유하는 단 하나의 카드.
 * 수치의 원본은 docs/DESIGN_SPEC.md 2-1장이며, 이 테스트가 그 값을 고정한다.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LinkCard, type LinkCardProps } from '@/components/LinkCard';
import type { BookmarkWithCount } from '@/lib/types';

const BOOKMARK: BookmarkWithCount = {
  id: 'bm-1',
  category_id: 'cat-ai',
  title: 'ChatGPT',
  url: 'https://chat.openai.com/',
  description: 'AI 대화·문서 초안',
  tags: [],
  favicon_url: 'https://cdn.example.com/openai.png',
  is_pinned: true,
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

/** fireEvent에는 auxClick 헬퍼가 없어 auxclick 이벤트를 직접 만들어 쏜다. */
function auxClick(element: Element, button: number) {
  return fireEvent(element, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button }));
}

/** 가운데 클릭 = 새 탭 (button 1). 왼쪽 클릭은 click이라 auxclick으로 오지 않는다. */
const middleClick = (element: Element) => auxClick(element, 1);
/** 우클릭 (button 2) — 메뉴만 연다. */
const rightClick = (element: Element) => auxClick(element, 2);

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
  it('기본으로 핀을 보여준다', () => {
    renderCard();

    expect(pinButton()).toBeInTheDocument();
  });

  it('핀을 누르면 onToggleFav만 부르고 링크는 열지 않는다', () => {
    const onToggleFav = vi.fn();
    const onOpen = vi.fn();
    renderCard({ onToggleFav, onOpen });

    fireEvent.click(pinButton());

    expect(onToggleFav).toHaveBeenCalledWith('bm-1');
    expect(onOpen).not.toHaveBeenCalled();
    // 앵커 밖의 형제 요소라 클릭이 앵커로 새지 않는다.
    expect(pinButton().closest('a')).toBeNull();
  });

  it('showPin=false면 핀을 그리지 않는다 (홈의 매일·운영 중 섹션)', () => {
    renderCard({ showPin: false });

    expect(screen.queryByRole('button', { name: 'ChatGPT 즐겨찾기' })).not.toBeInTheDocument();
  });

  it('꺼짐 상태는 흐린 회색이고 속이 비어 있다', () => {
    renderCard();

    expect(pinButton()).toHaveClass('text-ghost');
    expect(pinButton()).toHaveAttribute('aria-pressed', 'false');
    expect(pinButton().querySelector('svg')).toHaveAttribute('fill', 'none');
  });

  it('켜짐 상태는 진한 글자 + 선택 배경 + 채운 핀이다', () => {
    renderCard({ isFaved: true });

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
    const card = renderCard({ showCheck: true });
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
    const card = renderCard({ isFaved: true });

    expect(card).toHaveClass('border-fav-border');
    expect(card).not.toHaveClass('border-card-border');
  });

  it('체크된 카드는 --color-ink다', () => {
    const card = renderCard({ showCheck: true, checked: true });

    expect(card).toHaveClass('border-ink');
    expect(card).not.toHaveClass('border-card-border');
  });

  it('체크가 즐겨찾기보다 우선한다', () => {
    const card = renderCard({ showCheck: true, checked: true, isFaved: true });

    expect(card).toHaveClass('border-ink');
    expect(card).not.toHaveClass('border-fav-border');
  });

  it('체크를 감춘 화면에서는 checked가 테두리를 바꾸지 못한다', () => {
    // 체크가 보이지 않는데 테두리만 검게 변하면 이유를 알 수 없는 상태가 된다.
    const card = renderCard({ showCheck: false, checked: true, isFaved: true });

    expect(card).toHaveClass('border-fav-border');
    expect(card).not.toHaveClass('border-ink');
  });
});

describe('LinkCard 관리자', () => {
  it('isAdmin=true여도 연필·휴지통은 아직 그리지 않는다 (3단계 J1·J2 몫)', () => {
    renderCard({ isAdmin: true, showCheck: true });

    expect(screen.queryByRole('button', { name: /편집|수정/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /삭제/ })).not.toBeInTheDocument();
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
      'min-h-[104px]',
      'min-[820px]:min-h-[126px]',
      'shadow-[0_1px_2px_rgba(20,21,22,.04)]',
    );
  });

  it('컨테이너 호버: 테두리 ink + scale(1.05) + 그림자 + z-index 5, transition 0.22s', () => {
    const card = renderCard();

    expect(card).toHaveClass(
      'hover:border-ink',
      'hover:[transform:scale(1.05)]',
      'hover:shadow-[0_10px_26px_rgba(20,21,22,.14)]',
      'hover:z-[5]',
      '[transition:transform_.22s_cubic-bezier(.22,.9,.28,1),box-shadow_.22s_ease,border-color_.22s_ease]',
    );
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
    renderCard({ showCheck: true });

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

  it('본문 블록: margin-top auto, 이름 13.5px/600 2줄, 설명 12px 2줄', () => {
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
      'max-h-[2.8em]',
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
