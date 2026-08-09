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
    // 쓰기 서버 액션은 **로그인한 사용자 자격**(anon 키 + 쿠키)으로만 DB 에 나가야 한다.
    // service role 클라이언트를 끌어오면 RLS 가 통째로 우회되어, 액션 첫 줄의 세션 검사에
    // 구멍이 생기는 순간 세션 없이도 뚫리는 공개 쓰기 엔드포인트가 된다(lib/mutations.ts 상단).
    // 주석과 테스트만으로는 새로 손대는 사람이 되돌릴 수 있어 린트로도 막는다.
    files: ["lib/mutations.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/supabase/admin", "@/lib/supabase/admin"],
              message:
                "쓰기 액션은 service role 을 쓰지 않는다 — RLS 2차 방어가 사라진다. createServerSupabaseClient()(anon+쿠키)를 써라.",
            },
          ],
        },
      ],
    },
  },
  {
    // 반대 방향의 같은 계약(lib/favicon-collect.ts 상단 "이중 방어 계약").
    // 이 모듈은 service role 을 **정당하게** 쓴다 — favicons 버킷에 storage 정책이 없어
    // 업로드가 그 키를 요구한다. 그래서 여기서는 supabase/admin 을 막지 않는다. 대신 그 키가
    // 닿는 범위를 Storage 하나로 묶어 두는 것이 위 mutations 규칙과 짝을 이루는 두 번째 벽이라,
    // 테이블 쓰기로 건너갈 수 있는 유일한 통로인 쓰기 액션 모듈을 막는다.
    // ESLint 가 보는 것은 **정적 import 뿐**이다(H4 교훈) — 동적 import()·require() 우회는
    // lib/favicon-collect.test.ts 의 소스 스캔이 맡는다. 둘이 한 벌이다.
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
