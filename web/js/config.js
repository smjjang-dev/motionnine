// web/js/config.js
// 공개 설정 전용. 최종 번들에 그대로 들어가므로 비밀값(service_role, OAuth Secret,
// SMTP 비밀번호 등)을 절대 넣지 말 것. 브라우저에는 URL + publishable/anon key만.
// 실값은 배포 시점에 web/js/config.local.js(깃무시)로 주입. 예시: config.local.example.js
let local = {};
try {
  local = (await import('./config.local.js')).LOCAL_CONFIG ?? {};
} catch {
  local = {};
}

const PLACEHOLDER_URL = 'https://<ref>.supabase.co';
const PLACEHOLDER_KEY = '<publishable-key>';

export const CONFIG = {
  SUPABASE_URL: local.SUPABASE_URL ?? PLACEHOLDER_URL,
  SUPABASE_ANON_KEY: local.SUPABASE_ANON_KEY ?? PLACEHOLDER_KEY,
  // OAuth/메일 콜백 복귀 기준 URL. 비어 있으면 현재 origin 사용.
  SITE_URL: (local.SITE_URL ?? '').replace(/\/$/, ''),
  ENV: local.ENV ?? 'dev',
};

export function isConfigured() {
  return !CONFIG.SUPABASE_URL.includes('<ref>') && !CONFIG.SUPABASE_ANON_KEY.startsWith('<');
}

export function siteUrl() {
  if (CONFIG.SITE_URL) return CONFIG.SITE_URL;
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return '';
}
