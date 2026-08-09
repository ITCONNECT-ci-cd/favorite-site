import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 디자인 핸드오프 번들(읽기 전용) — 소스가 아니므로 린트 대상에서 제외.
    "docs/**",
  ]),
  {
    // service role 클라이언트는 **기본이 금지**다 — 그 키는 RLS 를 통째로 우회하므로, 끌어온
    // 파일 하나하나가 세션 검사 한 줄만 뚫리면 열리는 쓰기 경로가 된다(lib/mutations.ts 상단 ·
    // lib/favicon-collect.ts "이중 방어 계약").
    //
    // 규칙을 전역으로 두는 것은 **선언과 강제의 범위를 맞추기 위해서다.** 근거 주석
    // (lib/favicon-collect.ts)은 "`@/lib/supabase/admin` import 는 이 파일에서만 정당하다" 라고
    // 적어 두었는데, 금지가 lib/mutations.ts 한 파일에만 걸려 있으면 새로 만드는 서버 컴포넌트나
    // 액션 모듈은 아무 경고 없이 그 키를 끌어올 수 있었다. 이제 정당한 자리만 아래에서 되돌린다.
    //
    // ESLint 가 보는 것은 **정적 import 뿐**이다(H4 교훈) — 동적 import()·require() 우회는
    // lib/mutations.test.ts · lib/favicon-collect.test.ts 의 소스 스캔이 맡는다. 둘이 한 벌이다.
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/supabase/admin", "@/lib/supabase/admin"],
              message:
                "service role 은 RLS 를 통째로 우회한다 — 정당한 자리는 app/api/click/route.ts(익명 방문자를 대신해 쓴다) · lib/favicon-collect.ts(정책 없는 Storage 버킷 업로드) 둘뿐이고 eslint.config.mjs 가 그 둘만 열어 둔다. 쓰기 액션·서버 컴포넌트에서는 createServerSupabaseClient()(anon+쿠키)를 써라.",
            },
          ],
        },
      ],
    },
  },
  {
    // 위 금지를 **되돌리는 유일한 목록**이다. 늘리려면 "왜 이 파일만 service role 이어야 하는가"를
    // 그 파일 상단에 먼저 적어라 — 목록에 이름만 늘면 금지가 이름뿐인 것이 된다.
    //
    // - app/api/click/route.ts — 익명 방문자의 클릭을 서버가 대신 기록한다(로그인 세션이 없다).
    // - lib/supabase/admin.ts — 그 클라이언트를 만드는 모듈 자신.
    // - lib/favicon-collect.test.ts — 짝인 액션이 쓰는 팩토리를 vi.mock 으로 갈아 끼우고
    //   "테이블에는 손대지 않는다"를 그 대역으로 확인한다. 테스트가 import 하지 못하면 확인할
    //   대상 자체가 없다.
    //
    // lib/favicon-collect.ts 는 여기 없다 — 아래에서 자기 규칙을 따로 갖는다(같은 자리에 두면
    // 그 파일의 @/lib/mutations 금지까지 함께 꺼진다).
    files: ["app/api/click/route.ts", "lib/supabase/admin.ts", "lib/favicon-collect.test.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    // 반대 방향의 같은 계약(lib/favicon-collect.ts 상단 "이중 방어 계약").
    // 이 모듈은 service role 을 **정당하게** 쓴다 — favicons 버킷에 storage 정책이 없어
    // 업로드가 그 키를 요구한다. 그래서 여기서는 supabase/admin 을 막지 않는다(이 블록이
    // 위 전역 패턴을 통째로 대체한다). 대신 그 키가 닿는 범위를 Storage 하나로 묶어 두는 것이
    // 짝을 이루는 두 번째 벽이라, 테이블 쓰기로 건너갈 수 있는 유일한 통로인 쓰기 액션 모듈을 막는다.
    files: ["lib/favicon-collect.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/lib/mutations", "@/lib/mutations"],
              message:
                "이 모듈은 Storage 업로드 전용 — 테이블 쓰기는 createBookmark(쿠키 클라이언트)의 몫이다. service role 로 테이블을 쓰면 이중 방어가 무너진다.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
