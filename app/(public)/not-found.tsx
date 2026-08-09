import Link from 'next/link';
import { EmptyBox } from '@/components/EmptyBox';

/**
 * 공개 그룹 안에서 `notFound()` 가 불렸을 때의 화면 — **미매칭 URL 은 여기로 오지 않는다.**
 *
 * 역할 구분이 이 파일의 존재 이유다.
 * - **여기(`app/(public)/not-found.tsx`)**: `(public)` 그룹 안의 화면이 스스로 부른
 *   `notFound()` 만 받는다. 지금은 `app/(public)/category/[id]/page.tsx` 가 없는 분류 id 로
 *   들어왔을 때 부르는 것 하나뿐이다. 사이드바로 걸어 들어온 사람이라 셸(사이드바·헤더) 안에
 *   남는 것이 맞다 — 그 자리에서 다른 분류를 바로 고를 수 있다.
 * - **루트(`app/not-found.tsx`)**: 어느 라우트에도 걸리지 않은 URL 을 받는다. 그쪽에는 셸이
 *   없다(주소를 잘못 친 사람에게 사이드바를 세워 주려고 DB 를 조회할 이유가 없다).
 *
 * 이 파일이 `(public)` 레이아웃 안에 있으므로 셸은 **레이아웃이** 세운다 — 여기서 사이드바나
 * 헤더를 다시 그리지 않는다. 데이터 조회도 하지 않는다(셸이 이미 한 번 했다).
 *
 * `<main>` 과 `flex-1` 은 다른 공개 화면과 같은 계약이다(셸 JSDoc "화면과의 계약") —
 * 내용이 짧아도 세로를 채워 안내가 콘텐츠 영역 가운데에 선다.
 */
export default function PublicNotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-[12px] text-center">
      <h1 className="text-[20px] font-bold tracking-[-0.02em] text-ink">
        찾을 수 없는 분류입니다
      </h1>

      <p className="text-[12.5px] text-desc">
        주소가 바뀌었거나 지워진 분류입니다.
      </p>

      {/* 빈 상태와 같은 점선 박스를 쓴다 — '여기에는 보여 줄 것이 없다'는 같은 종류의 안내라
          다른 화면과 모양이 어긋날 이유가 없다(components/EmptyBox.tsx). */}
      <EmptyBox className="mt-[2px] max-w-[420px]">
        사이드바에서 다른 분류를 고르거나,{' '}
        <Link href="/" className="font-semibold text-ink underline underline-offset-2">
          홈으로 돌아가기
        </Link>
      </EmptyBox>
    </main>
  );
}
