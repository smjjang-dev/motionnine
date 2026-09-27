// web/js/config.local.example.js
// 이 파일을 복사해 web/js/config.local.js로 저장하고 실값을 채울 것.
// config.local.js는 .gitignore 처리되어 커밋되지 않음. 대시보드·비밀저장소에서 관리.
export const LOCAL_CONFIG = {
  SUPABASE_URL: 'https://<ref>.supabase.co',
  SUPABASE_ANON_KEY: '<publishable-key>',
  // Cloudflare Pages 시연 주소 등 실 배포 URL (末尾 슬래시 없음)
  SITE_URL: 'https://<site>.pages.dev',
  ENV: 'prod',
};
