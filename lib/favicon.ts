import type { Bookmark } from '@/lib/types';

/**
 * 카드 파비콘 타일에 그릴 이미지 주소.
 *
 * 저장된 `favicon_url`을 그대로 쓴다 — 여기서 구글 파비콘 서비스 같은 대체 주소를 만들어 내지 않는다.
 * 값이 없으면 `null`이고, 카드는 이미지 없이 회색 타일만 그린다.
 * (빈 문자열은 `url("")`로 나가 깨진 이미지가 되므로 없는 것과 똑같이 다룬다.)
 */
export function faviconSrc(bookmark: Pick<Bookmark, 'favicon_url'>): string | null {
  const src = bookmark.favicon_url;

  return src !== null && src.trim() !== '' ? src : null;
}

/**
 * 카드 하단 줄에 적는 주소. `https://www.perplexity.ai/` → `perplexity.ai`
 * (맨 앞 `www.`만 뗀다 — 프로토타입 표기 기준, docs/screenshots/03-shot.png)
 *
 * 주소로 해석되지 않으면 하단 줄을 비우는 대신 입력을 그대로 돌려준다.
 */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
