/** C2. 링크 카드가 쓰는 파비콘·주소 유틸. */
import { describe, expect, it } from 'vitest';
import { faviconSrc, hostOf } from '@/lib/favicon';

describe('faviconSrc', () => {
  it('저장된 favicon_url을 그대로 돌려준다', () => {
    expect(faviconSrc({ favicon_url: 'https://cdn.example.com/openai.png' })).toBe(
      'https://cdn.example.com/openai.png',
    );
  });

  it('data URL도 손대지 않는다', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';

    expect(faviconSrc({ favicon_url: dataUrl })).toBe(dataUrl);
  });

  it('favicon_url이 없으면 null이다 (카드가 회색 타일을 그린다)', () => {
    expect(faviconSrc({ favicon_url: null })).toBeNull();
  });

  it('빈 문자열·공백만 있는 값도 없는 것으로 본다', () => {
    // url("")은 깨진 이미지로 그려지므로 null과 똑같이 다뤄야 한다.
    expect(faviconSrc({ favicon_url: '' })).toBeNull();
    expect(faviconSrc({ favicon_url: '   ' })).toBeNull();
  });
});

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
});
