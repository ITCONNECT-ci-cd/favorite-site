import { VISITOR_KEY } from '@/lib/constants';

/**
 * localStorage를 쓸 수 없는 환경(프라이빗 모드 등)의 세션 한정 폴백.
 * 저장에 성공한 경우에는 절대 채우지 않는다 — localStorage가 유일한 진실이다.
 */
let memoryId: string | null = null;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Math.random 기반 UUID v4. 비보안 컨텍스트(사내 http 접속 등)에는
 * crypto.randomUUID가 없어서 필요하다. 익명 식별자일 뿐이라 암호학적 강도는
 * 필요 없지만, F2가 그대로 API로 보내므로 형식은 UUID여야 한다.
 */
function fallbackUuidV4(): string {
  const hex = '0123456789abcdef';
  let out = '';

  for (let i = 0; i < 36; i += 1) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
    else if (i === 14) out += '4'; // 버전
    else if (i === 19) out += hex[(Math.floor(Math.random() * 16) & 0x3) | 0x8]; // variant
    else out += hex[Math.floor(Math.random() * 16)];
  }

  return out;
}

function createId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return fallbackUuidV4();
  }
}

/** 읽기 자체가 막혔는지(ok:false)와 읽어낸 값을 구분해서 돌려준다. */
type ReadResult = { ok: true; value: string | null } | { ok: false };

function tryRead(): ReadResult {
  try {
    return { ok: true, value: window.localStorage.getItem(VISITOR_KEY) };
  } catch {
    return { ok: false };
  }
}

/** 저장에 성공하면 true. 실패해도 던지지 않는다. */
function safeWrite(id: string): boolean {
  try {
    window.localStorage.setItem(VISITOR_KEY, id);
    return true;
  } catch {
    return false;
  }
}

/**
 * 클릭 집계(F2)에 쓰는 익명 방문자 식별자. 브라우저 전용이다.
 *
 * 최초 호출에서 한 번 만들어 localStorage(VISITOR_KEY)에 영속하고,
 * 이후 호출은 같은 값을 돌려준다. 저장이 불가능한 환경에서는
 * 세션 한정 메모리 값으로 물러난다(탭을 닫으면 사라진다).
 */
export function getVisitorId(): string {
  // 서버에는 방문자 세션이라는 개념이 없다. 여기서 모듈 상태에 값을 남기면
  // 프로세스의 모든 요청이 한 id를 공유하게 되므로, 캐시 없이 일회용 값만 돌려준다.
  if (typeof window === 'undefined') return createId();

  if (memoryId !== null) return memoryId;

  // 형식이 깨진 값을 그대로 쓰면 F2가 그 브라우저에서 영구히 400을 받는 무성 고장이 된다.
  const read = tryRead();
  if (read.ok && read.value !== null && UUID_RE.test(read.value)) return read.value;

  const id = createId();
  const wrote = safeWrite(id);

  // 읽기가 막혔거나 쓰기가 실패했다면 다음 호출에서 이 값을 되찾을 수 없다.
  // 그때만 세션 한정으로 메모리에 고정한다(정상 환경에서는 localStorage가 유일한 진실).
  if (!read.ok || !wrote) memoryId = id;

  return id;
}
