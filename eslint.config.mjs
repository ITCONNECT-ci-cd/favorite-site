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
]);

export default eslintConfig;
