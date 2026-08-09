/** C2. 카드 하단 줄이 쓰는 주소 유틸. */
import { describe, expect, it } from 'vitest';
import { hostOf } from '@/lib/url';

describe('hostOf', () => {
  it('주소에서 host만 뽑는다', () => {
    expect(hostOf('https://chat.openai.com/')).toBe('chat.openai.com');
  });

  it('경로·쿼리·해시를 버린다', () => {
    expect(hostOf('https://claude.ai/login?returnTo=%2F%3F#top')).toBe('claude.ai');
  });

  it('맨 앞 www.는 뗀다 (프로토타입 스크린샷 표기 기준)', () => {
    // https://www.perplexity.ai/ → perplexity.ai (docs/screenshots/03-shot.png)
    expect(hostOf('https://www.perplexity.ai/')).toBe('perplexity.ai');
  });

  it('중간에 있는 www.는 그대로 둔다', () => {
    expect(hostOf('https://docs.www.example.com/')).toBe('docs.www.example.com');
  });

  it('www로 시작하기만 하는 이름은 건드리지 않는다', () => {
    expect(hostOf('https://wwwx.example.com/')).toBe('wwwx.example.com');
  });

  it('대문자 host는 소문자로 정규화된다', () => {
    expect(hostOf('https://WWW.Example.COM/')).toBe('example.com');
  });

  it('포트는 host에 넣지 않는다', () => {
    expect(hostOf('http://localhost:3000/links')).toBe('localhost');
  });

  it('주소로 해석되지 않으면 입력을 그대로 돌려준다', () => {
    // 카드 하단 줄이 비는 것보다 원문이라도 보여주는 편이 낫다.
    expect(hostOf('chat.openai.com/c/1')).toBe('chat.openai.com/c/1');
    expect(hostOf('')).toBe('');
  });

  it('host가 없는 스킴도 입력을 그대로 돌려준다', () => {
    // new URL은 던지지 않지만 hostname이 빈 문자열이라 하단 줄이 통째로 비어 버린다.
    expect(hostOf('mailto:hello@example.com')).toBe('mailto:hello@example.com');
    expect(hostOf('tel:+8215771234')).toBe('tel:+8215771234');
    expect(hostOf('file:///C:/links.html')).toBe('file:///C:/links.html');
  });
});
