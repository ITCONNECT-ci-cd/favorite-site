/**
 * C2. 아이콘 5종 — DESIGN_SPEC 2-1장의 SVG path·stroke-width를 그대로 옮겼는지 고정한다.
 * path 문자열이 한 글자라도 달라지면 프로토타입과 모양이 어긋난다.
 */
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { CheckIcon, EyeIcon, PencilIcon, PinIcon, TrashIcon } from '@/components/icons';

function svgOf(element: ReactElement): SVGSVGElement {
  const { container } = render(element);
  const svg = container.querySelector('svg');

  if (svg === null) throw new Error('svg를 그리지 않았다');
  return svg;
}

function pathsOf(svg: SVGSVGElement): string[] {
  return [...svg.querySelectorAll('path')].map((path) => path.getAttribute('d') ?? '');
}

/** DESIGN_SPEC 2-1: 아이콘 | stroke-width | path 목록 */
const ICONS: [string, ReactElement, string, string[]][] = [
  [
    '눈',
    <EyeIcon key="eye" />,
    '2',
    ['M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z'],
  ],
  [
    '핀',
    <PinIcon key="pin" />,
    '1.7',
    ['M9.4 3h5.2l-.8 5.6 3.2 3.1v1.7H6.9v-1.7l3.3-3.1L9.4 3z', 'M12 13.4V21'],
  ],
  ['연필', <PencilIcon key="pencil" />, '1.8', ['M4 20.5h4L20 8.5l-4-4L4 16.5v4z', 'M14.5 6l4 4']],
  [
    '휴지통',
    <TrashIcon key="trash" />,
    '1.8',
    ['M4 6.5h16', 'M9 6.5V4h6v2.5', 'M6.5 6.5l1 13.5h9l1-13.5'],
  ],
  ['체크', <CheckIcon key="check" />, '2.6', ['M4.5 12.5l5 5 10-11']],
];

describe('아이콘 (components/icons.tsx)', () => {
  it.each(ICONS)('%s 아이콘의 path가 스펙과 같다', (_name, element, _strokeWidth, paths) => {
    expect(pathsOf(svgOf(element))).toEqual(paths);
  });

  it.each(ICONS)('%s 아이콘의 stroke-width가 스펙값이다', (_name, element, strokeWidth) => {
    expect(svgOf(element)).toHaveAttribute('stroke-width', strokeWidth);
  });

  it.each(ICONS)('%s 아이콘은 12px에 공통 stroke 규칙을 쓴다', (_name, element) => {
    const svg = svgOf(element);

    expect(svg).toHaveAttribute('width', '12');
    expect(svg).toHaveAttribute('height', '12');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('stroke-linecap', 'round');
    expect(svg).toHaveAttribute('stroke-linejoin', 'round');
  });

  it.each(ICONS)('%s 아이콘은 보조 기술에서 감춘다 (이름은 버튼이 갖는다)', (_name, element) => {
    const svg = svgOf(element);

    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
  });

  it('눈 아이콘에는 동공 원이 있다', () => {
    const circle = svgOf(<EyeIcon />).querySelector('circle');

    expect(circle).toHaveAttribute('cx', '12');
    expect(circle).toHaveAttribute('cy', '12');
    expect(circle).toHaveAttribute('r', '2.6');
  });

  it('기본 fill은 none이다', () => {
    for (const [, element] of ICONS) {
      expect(svgOf(element)).toHaveAttribute('fill', 'none');
    }
  });

  it('핀만 채운 상태를 가진다 (켜짐: fill currentColor)', () => {
    expect(svgOf(<PinIcon filled />)).toHaveAttribute('fill', 'currentColor');
    expect(svgOf(<PinIcon filled={false} />)).toHaveAttribute('fill', 'none');
  });
});
