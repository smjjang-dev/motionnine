// web/js/login.js — W-01 페이지 컨트롤러
import { signInEmail, signInWithGoogle, getSession, fetchMyAccess, routeByStatus, takeNotice } from './auth.js';

const $ = (id) => document.getElementById(id);

function showErr(msg) {
  const e = $('loginErr');
  e.textContent = msg;
  e.style.display = 'block';
}

function hideErr() {
  const e = $('loginErr');
  e.textContent = '';
  e.style.display = 'none';
}

// 실패 메시지 통일 — 계정 존재 여부 노출 금지(§4.3). 설정 오류만 그대로 표시.
function authFailMessage(err) {
  const raw = (err && err.message) || '';
  if (raw.startsWith('NOT_CONFIGURED') || raw.startsWith('SDK_MISSING')) return raw;
  if (raw.includes('provider')) return '현재 로그인 제공자에 문제가 있습니다. 대표 관리자에게 문의하세요.';
  return '이메일 또는 비밀번호를 확인하세요.';
}

async function init() {
  const notice = takeNotice();
  if (notice) showErr(notice);

  // 이미 로그인된 세션이면 상태별로 바로 이동
  try {
    const session = await getSession();
    if (session) {
      const access = await fetchMyAccess();
      routeByStatus(access);
      return;
    }
  } catch {
    // 세션 확인 실패는 로그인 폼 유지
  }

  $('btnGoogle').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    hideErr();
    try {
      await signInWithGoogle();
    } catch (err) {
      showErr(authFailMessage(err));
      btn.disabled = false;
    }
  });

  $('btnLogin').addEventListener('click', doEmailLogin);
  $('li-pw').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') doEmailLogin();
  });
  $('li-email').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') doEmailLogin();
  });

  $('pwToggle').addEventListener('click', () => {
    const pw = $('li-pw');
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    $('pwToggle').textContent = show ? '숨기기' : '보기';
    pw.focus();
  });
}

async function doEmailLogin() {
  const btn = $('btnLogin');
  if (btn.disabled) return;
  hideErr();
  const email = $('li-email').value.trim();
  const password = $('li-pw').value;
  if (!email || !password) {
    showErr('이메일 또는 비밀번호를 확인하세요.');
    return;
  }
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = '로그인 중…';
  try {
    await signInEmail(email, password);
  } catch (err) {
    showErr(authFailMessage(err));
    btn.disabled = false;
    btn.textContent = label;
  }
}

init();
