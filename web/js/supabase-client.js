// web/js/supabase-client.js
// Supabase SDK 단일 인스턴스. UMD 전역(window.supabase) 사용이므로
// 각 HTML에서 web/vendor/supabase-js.min.js를 모듈 스크립트보다 먼저 로드할 것.
// service_role 키 사용 금지 — anon/publishable key만 허용.
import { CONFIG, isConfigured } from './config.js';

let client = null;

export function getClient() {
  if (client) return client;
  if (!isConfigured()) {
    throw new Error('NOT_CONFIGURED: Supabase 접속 정보가 없습니다. web/js/config.local.js를 배포 단계에서 주입하세요.');
  }
  const g = (typeof window !== 'undefined' && window.supabase) || globalThis.supabase;
  if (!g || typeof g.createClient !== 'function') {
    throw new Error('SDK_MISSING: web/vendor/supabase-js.min.js 로드가 필요합니다.');
  }
  client = g.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: {
      // 탭 단위 세션 (§4.4 기본안). XSS 방지는 textContent + CSP로 별도 보장.
      storage: typeof sessionStorage !== 'undefined' ? sessionStorage : undefined,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });
  return client;
}
