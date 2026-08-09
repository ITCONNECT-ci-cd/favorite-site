import type { AdminSession } from '@/lib/supabase/server';

/**
 * `getAdminSession()` 이 돌려주는 관리자 세션 요약의 테스트용 한 벌 (J1).
 *
 * 이 값이 **non-null 이라는 사실**만이 의미를 갖는다 — 관문의 계약이 "인증됨"이 아니라
 * "그 관리자임"이라(lib/supabase/server.ts) 화면은 안의 필드로 다시 판정하지 않는다.
 * 그래서 여기 적힌 uuid·이메일은 아무 값이어도 되고, 화면 테스트가 이 값을 읽는 순간
 * 그 화면이 계약을 어기고 있다는 신호다.
 *
 * `ADMIN_EMAIL` 을 끌어오지 않는 것도 같은 이유다 — 실제 계정 주소를 fixture 에 박아 두면
 * 테스트가 환경 설정에 묶인다.
 */
export const adminSession: AdminSession = {
  userId: '00000000-0000-4000-8000-000000000001',
  email: 'admin@example.test',
};
