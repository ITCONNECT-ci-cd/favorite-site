'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { LoginFormState } from '@/components/admin/LoginForm';
import { ADMIN_PATH } from '@/lib/routes';
import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * 관리자 로그인·로그아웃 서버 액션.
 *
 * ## 왜 anon + 쿠키 클라이언트인가
 *
 * `lib/supabase/admin.ts` 의 service role 클라이언트가 아니라 `createServerSupabaseClient()`
 * (anon 키 + 요청 쿠키) 를 쓴다. 로그인의 결과물은 **응답에 실릴 세션 쿠키**이고, 그 쿠키를
 * 심는 주체가 이 클라이언트이기 때문이다. service role 로는 비밀번호를 검증할 수도, 사용자
 * 세션을 만들 수도 없다.
 *
 * 서버 액션 안에서는 `cookies().set()` 이 허용된다 — 그래서 `createServerSupabaseClient` 의
 * `setAll` 이 여기서는 조용히 삼켜지지 않고 실제로 쿠키를 쓴다(서버 컴포넌트 렌더 중에는
 * 못 쓴다. 그쪽 catch 의 사연은 lib/supabase/server.ts 주석에 있다).
 *
 * ## `revalidatePath` 가 `redirect` 앞에 오는 이유
 *
 * `redirect` 는 제어 흐름 예외를 던져 뒷줄을 실행시키지 않는다. 무효화를 먼저 해 둬야 도착한
 * 화면이 방금 바뀐 세션을 보고 다시 그려진다 (`app/admin/layout.tsx` 의 `getAdminSession()`,
 * 그리고 3단계 J1 이 붙일 공개 화면의 편집 노출까지). 순서를 바꾸면 화면이 한 박자 늦는다.
 */

/*
 * 로그인 성공·로그아웃 뒤 돌아갈 자리는 둘 다 `ADMIN_PATH` 다 — 그 자리에서
 * `app/admin/layout.tsx` 가 세션을 다시 보고 관리 화면과 로그인 화면을 가른다.
 *
 * 값은 `lib/routes.ts` 에서 가져온다. 여기에 다시 적어 두면 로그인 화면·상단 탭이 쓰는 값과
 * 갈라진다. (`'use server'` 파일은 **async 함수만 export** 할 수 있어 자기 상수를 남에게
 * 나눠 줄 수 없다 — 상수가 중립 모듈에 사는 이유이자, `LoginFormState` 가 컴포넌트 쪽에
 * 사는 이유이기도 하다.)
 */

/**
 * 이메일·비밀번호로 로그인한다.
 *
 * **실패는 전부 `{ failed: true }` 하나로 접는다.** 자격 불일치·계정 없음·네트워크 오류를
 * 구분해 돌려주면 어떤 이메일이 계정으로 존재하는지 밖에서 확인할 수 있다(계정 열거).
 * 돌려줄 수 있는 타입 자체가 boolean 이라 사유를 실을 자리가 없다 —
 * 근거와 경고는 `LoginFormState` 주석에 적어 뒀다.
 *
 * 원문은 삼키지 않고 서버 로그에만 남긴다. 화면에는 나가지 않는다.
 */
export async function signInAction(_state: LoginFormState, formData: FormData): Promise<LoginFormState> {
  // 폼을 거치지 않은 POST 도 이 액션에 닿을 수 있다(서버 액션은 공개 엔드포인트다).
  // 그래서 필드가 없을 수 있다고 보고 읽는다 — `File` 이 올 수도 있어 문자열만 받는다.
  const email = readField(formData, 'email').trim();
  const password = readField(formData, 'password');

  // 빈 입력을 Supabase 까지 보내지 않는다. 어차피 실패고, 왕복만 늘어난다.
  if (email === '' || password === '') return { failed: true };

  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error !== null) {
      console.warn('관리자 로그인 실패', { code: error.code, message: error.message });

      return { failed: true };
    }
  } catch (error) {
    // 네트워크·환경변수 문제 등. 사용자에게는 자격 실패와 똑같이 보인다.
    console.error('관리자 로그인 처리 중 오류', error);

    return { failed: true };
  }

  revalidatePath('/', 'layout');
  redirect(ADMIN_PATH);
}

/**
 * 로그아웃하고 로그인 화면으로 되돌린다 (H3 관리자 셸의 우측 '로그아웃'이 소비한다).
 *
 * 기본 scope 는 global 이라 발급된 리프레시 토큰까지 회수한다 — 관리자 계정은 하나뿐이고,
 * "로그아웃했는데 다른 기기에 세션이 남아 있다"가 더 곤란하다(scripts/create-admin.ts 와 같은 판단).
 *
 * 호출이 실패해도 **화면은 반드시 로그인으로 되돌린다.** 여기서 오류를 띄우고 머무르면
 * 사용자는 로그아웃됐는지 아닌지 모르는 채로 관리 화면에 남는다. 쿠키가 남아 있다면 다음
 * 요청의 `getAdminSession()` 이 다시 판정하므로, 이 자리에서 억지로 붙잡을 이유가 없다.
 */
export async function signOutAction(): Promise<void> {
  try {
    const supabase = await createServerSupabaseClient();
    await supabase.auth.signOut();
  } catch (error) {
    console.error('로그아웃 처리 중 오류 — 로그인 화면으로 되돌린다', error);
  }

  revalidatePath('/', 'layout');
  redirect(ADMIN_PATH);
}

/** `FormData.get` 은 `File | string | null` 을 준다. 문자열이 아니면 없는 것으로 본다. */
function readField(formData: FormData, name: string): string {
  const value = formData.get(name);

  return typeof value === 'string' ? value : '';
}
