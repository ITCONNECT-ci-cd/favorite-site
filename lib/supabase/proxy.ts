import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { requireEnv } from './env';

/**
 * 만료된 Supabase 세션 토큰을 갱신하고, 갱신된 쿠키를 실은 응답을 돌려준다.
 *
 * 루트 `proxy.ts` 가 요청마다 이 함수를 부른다. 로직을 그쪽에 직접 두지 않은 이유는
 * 루트 파일이 Next 의 파일 컨벤션이라 테스트에서 그대로 import 하기 어렵기 때문이다.
 * 여기 있으면 평범한 함수라 `NextRequest` 하나 만들어 호출해 볼 수 있다.
 *
 * ## 이게 없으면 생기는 일
 *
 * Supabase 액세스 토큰은 1시간짜리다. 갱신은 리프레시 토큰으로 새 쿠키를 **써야** 끝나는데,
 * 서버 컴포넌트는 렌더 중 쿠키를 쓸 수 없다(`server.ts` 의 `setAll` catch 가 그 자리다).
 * 그래서 쓰기가 가능한 유일한 지점인 프록시가 갱신을 대신한다. 이 계층이 빠지면 관리자가
 * 한 시간마다 무작위로 로그아웃된다.
 *
 * ## 손대기 전에 알아야 할 것
 *
 * `createServerClient` 와 `getUser()` **사이에 코드를 넣지 마라.** 그 사이에서 응답을
 * 만들거나 던지면 갱신된 쿠키가 유실되는데, 증상이 "가끔 로그아웃"이라 추적이 매우 어렵다.
 *
 * 반환된 응답 객체를 다른 것으로 갈아치우지도 마라. 갱신 쿠키가 이 객체에 붙어 있어서,
 * 새 `NextResponse` 를 만들어 돌려주면 브라우저와 서버의 세션이 어긋난다. 헤더를 더해야
 * 하면 이 객체에 더해라.
 *
 * 이 경고는 **`setAll` 콜백 밖**을 가리킨다 — 아래 `setAll` 안에서 `response` 를 다시 만드는
 * 줄은 모순이 아니라 Supabase 공식 SSR 패턴이다. 갱신된 쿠키를 요청 객체에 먼저 심은 뒤
 * 그 요청으로 응답을 다시 만들어야 이번 요청을 이어서 처리할 서버 컴포넌트가 새 쿠키를
 * 읽을 수 있기 때문이다. 그 재생성은 곧바로 쿠키·헤더를 새 객체에 다시 붙이므로 유실이 없다.
 *
 * ⚠️ 단, 그 안전은 **`setAll` 이 요청당 최대 한 번 불린다**는 전제 위에 있다. 두 번째
 * 호출은 응답을 다시 만들면서 **앞선 호출이 붙여 둔 Set-Cookie 를 잃는다.** 지금은
 * `getUser()` 한 번이 전부라(갱신도 한 번뿐) 그 전제가 성립한다. 이 함수에 Supabase
 * 호출을 더 넣게 되면 그때는 `response.cookies` 를 유지한 채 누적하도록 고쳐야 한다.
 *
 * ## 리다이렉트는 여기서 하지 않는다
 *
 * 미인증 접근 처리는 관리 레이아웃(H2/H3)이 `getAdminSession()` 으로 판단한다. 프록시는
 * 전 경로에서 도니 여기에 가드를 넣으면 공개 화면까지 로그인으로 튕긴다. 이 계층의 책임은
 * **세션 갱신 하나뿐**이다.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headers) => {
          // 두 곳에 써야 한다. 요청 쿠키는 이번 요청을 이어서 처리할 서버 컴포넌트가 읽고,
          // 응답 쿠키는 브라우저가 받아 다음 요청에 쓴다. 한쪽만 쓰면 둘이 어긋난다.
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }

          // 위 루프로 갱신 쿠키를 심은 **뒤** 그 요청으로 응답을 다시 만든다. 이 재생성이
          // 상단 "응답 객체를 갈아치우지 마라" 경고와 모순돼 보이지만, 경고는 이 콜백 밖의
          // 교체를 말한다(윗줄 JSDoc). 요청당 한 번만 불린다는 전제도 그쪽에 적어 뒀다.
          response = NextResponse.next({ request });

          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }

          // 두 번째 인자를 반드시 반영해야 한다. auth 쿠키를 실어 보낼 때 supabase-js 가
          // `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0` ·
          // `Expires: 0` · `Pragma: no-cache` 를 넘긴다. 이걸 버리면 CDN·리버스 프록시가
          // **세션 토큰이 담긴 응답을 캐시해 다른 사용자에게 그대로 내줄 수 있다.**
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  // 이 호출이 갱신을 일으킨다 — 만료됐으면 supabase-js 가 리프레시하고, 그 결과가 위
  // setAll 을 타고 쿠키로 나간다. 반환값을 안 쓴다고 지우면 갱신 자체가 사라진다.
  await supabase.auth.getUser();

  return response;
}
