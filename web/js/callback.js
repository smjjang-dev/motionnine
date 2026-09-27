// web/js/callback.js — callback.html 전용 (CSP 인라인 스크립트 금지 Compliance)
import { handleCallback } from './auth.js';

try {
  await handleCallback();
} catch {
  document.getElementById('cbMsg').textContent = '로그인 처리에 실패했습니다. 로그인 화면으로 돌아가세요.';
  const a = document.createElement('a');
  a.href = 'login.html';
  a.className = 'btn primary';
  a.style.cssText = 'width:100%;margin-top:12px;display:block;text-align:center';
  a.textContent = '로그인으로 돌아가기';
  document.querySelector('.auth-box').appendChild(a);
}
