// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createClient } from '@supabase/supabase-js';

import { createPublicSupabaseClient } from './public';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ kind: 'public' })) }));

const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIGINAL_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

afterEach(() => {
  vi.mocked(createClient).mockClear();
  if (ORIGINAL_URL === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_URL;

  if (ORIGINAL_ANON_KEY === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ORIGINAL_ANON_KEY;
});

describe('createPublicSupabaseClient', () => {
  it('쿠키 저장·세션 갱신 없이 anon 자격만 사용하는 서버 client를 만든다', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://public-test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

    expect(createPublicSupabaseClient()).toEqual({ kind: 'public' });
    expect(createClient).toHaveBeenCalledWith(
      'https://public-test.supabase.co',
      'test-anon-key',
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      },
    );
  });
});
