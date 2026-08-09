# 내 링크

사내 구성원이 자주 쓰는 링크를 한곳에서 찾는 대시보드.

## 스택

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS v4 · Vitest · Supabase (예정) · Vercel (예정)

## 개발

```bash
npm run dev        # 개발 서버 (http://localhost:3000)
npm test           # 단위 테스트 (Vitest)
npm run typecheck  # 타입 검사 (tsc --noEmit)
npm run lint       # ESLint
npm run build      # 프로덕션 빌드
```

## 문서

- 구현 계획: `docs/superpowers/plans/2026-08-09-link-dashboard-full-plan.md`
- `docs/`는 디자인 핸드오프 번들(읽기 전용)입니다 — PRD, DESIGN_SPEC, 프로토타입, 스크린샷, 시드 데이터가 들어 있습니다. 코드에서 참조만 하고 수정하지 않습니다.

디자인 토큰·타이포그래피의 원본은 `docs/DESIGN_SPEC.md` 1장이며, 코드에서는 `app/globals.css`의 `@theme`이 이를 그대로 옮긴 것입니다. 제품은 **라이트 모드 전용**입니다.
