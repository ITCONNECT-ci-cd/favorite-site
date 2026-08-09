/**
 * 홈 화면 자리표시자 — 디자인 토큰·폰트가 실제로 적용되는지 눈으로 확인하기 위한 최소 화면.
 * 실제 홈(3섹션 + 링크 카드)은 D2 스토리에서 구현한다.
 */
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-2 bg-surface px-6 text-center">
      <h1 className="text-xl font-bold tracking-[-0.02em] text-ink">내 링크</h1>
      <p className="text-[13px] text-desc">
        사내 구성원이 자주 쓰는 링크를 한곳에서 찾는 대시보드
      </p>
    </main>
  );
}
