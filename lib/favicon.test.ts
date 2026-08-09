/** C2. 링크 카드가 쓰는 파비콘 유틸. */
import { describe, expect, it } from 'vitest';
import { faviconSrc } from '@/lib/favicon';

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
