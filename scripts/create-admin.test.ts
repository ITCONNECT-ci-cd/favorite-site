// @vitest-environment node
// 스크립트용 헬퍼라 DOM 이 필요 없다 — jsdom 을 띄우지 않는다.
import { describe, expect, it } from 'vitest';

import { generatePassword } from '@/scripts/create-admin';

/**
 * 관리자 비밀번호 생성기의 성질 검사.
 *
 * 이 값은 **사람이 파일에서 눈으로 읽어 옮겨 치는** 자격이고, 한 번 잘못 만들어지면
 * 계정이 이미 생성된 뒤라 되돌리기가 번거롭다. 그런데 출력이 무작위라 한 번 돌려서는
 * "운 좋게 통과"와 "정말 맞다"가 구분되지 않는다 — 예를 들어 4종 강제가 통째로 빠져도
 * 무작위 32자면 대개 4종이 다 들어간다. 그래서 성질을 여러 번 돌려서 확인한다.
 *
 * 실제 Supabase 왕복(생성·로그인)은 여기서 하지 않는다. `scripts/create-admin.ts` 를
 * import 해도 `main()` 이 돌지 않는 것은 그 파일의 `isDirectRun()` 가드 덕분이고,
 * **이 파일이 통과한다는 사실 자체가 그 가드가 살아 있다는 증거**다(가드가 없으면
 * import 시점에 실제 프로젝트로 계정 생성이 나간다).
 */
const RUNS = 50;

/** create-admin.ts 의 ALPHABET 4종을 합친 것과 같아야 한다. */
const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_=+';

/** 눈으로 옮겨 칠 때 헷갈리는 글자들 — 알파벳에서 빠져 있어야 한다. */
const AMBIGUOUS = ['0', 'O', '1', 'l', 'I'];

const samples = Array.from({ length: RUNS }, () => generatePassword());

describe(`generatePassword (${RUNS}회 반복)`, () => {
  it('길이가 항상 32자다', () => {
    for (const password of samples) {
      expect(password, password).toHaveLength(32);
    }
  });

  it('대문자·소문자·숫자·특수문자를 전부 포함한다', () => {
    // Supabase 프로젝트가 문자 종류 요건을 켜 두면 운 나쁜 무작위 문자열이 거부된다.
    // 4종 강제가 사라지면 이 검사가 RUNS 회 중 어딘가에서 걸린다.
    for (const password of samples) {
      expect(password, `소문자 없음: ${password}`).toMatch(/[a-z]/);
      expect(password, `대문자 없음: ${password}`).toMatch(/[A-Z]/);
      expect(password, `숫자 없음: ${password}`).toMatch(/[0-9]/);
      expect(password, `특수문자 없음: ${password}`).toMatch(/[!@#$%^&*\-_=+]/);
    }
  });

  it('모호한 글리프(0 O 1 l I)를 쓰지 않는다', () => {
    for (const password of samples) {
      for (const glyph of AMBIGUOUS) {
        expect(password.includes(glyph), `'${glyph}' 가 섞였다: ${password}`).toBe(false);
      }
    }
  });

  it('알파벳 밖의 문자가 섞이지 않는다', () => {
    for (const password of samples) {
      const strays = [...password].filter((char) => !ALPHABET.includes(char));

      expect(strays, `알파벳 밖 문자: ${strays.join('')}`).toEqual([]);
    }
  });

  it('매번 다른 값이 나온다 (상수·고정 시드가 아니다)', () => {
    // 충돌 확률은 사실상 0 이다(알파벳 69자, 32자리). 겹친다면 무작위가 아닌 것이다.
    expect(new Set(samples).size).toBe(RUNS);
  });

  it('첫 4자리의 문자 종류가 고정돼 있지 않다 (섞기가 살아 있다)', () => {
    // 4종을 심은 뒤 Fisher–Yates 를 빼먹으면 앞 4자리가 항상 소·대·숫자·특수 순서가 되어
    // 추측 공간이 그만큼 줄어든다. 50회 중 단 한 번도 흐트러지지 않을 확률은 무시할 만하다.
    const alwaysLowerFirst = samples.every((password) => /[a-z]/.test(password[0]));

    expect(alwaysLowerFirst).toBe(false);
  });
});
