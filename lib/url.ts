/**
 * 카드 하단 줄에 적는 주소. `https://www.perplexity.ai/` → `perplexity.ai`
 * (맨 앞 `www.`만 뗀다 — 프로토타입 표기 기준, docs/screenshots/03-shot.png)
 *
 * host를 뽑을 수 없으면 — 주소로 해석되지 않거나(`chat.openai.com/c/1`)
 * host라는 개념이 없는 스킴이면(`mailto:`·`tel:`) — 하단 줄을 비우는 대신
 * 입력을 그대로 돌려준다.
 */
export function hostOf(url: string): string {
  try {
    const { hostname } = new URL(url);

    return hostname === '' ? url : hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
