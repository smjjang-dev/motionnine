// web/js/signup.js — W-02 페이지 컨트롤러 (4탭: 가입/발송/실패/재설정)
// tabs.js의 data-t 매핑은 그대로 사용. 해시(#t-join 등)로 진입 탭 지정 가능.
import { signUp, resendConfirm, resetPassword, getSession, takeNotice } from './auth.js';

const $ = (id) => document.getElementById(id);
const RESEND_COOLDOWN_SEC = 58;
let cooldownUntil = 0;
let cooldownTimer = null;

function activateTab(name) {
  const btn = document.querySelector(`.tabs button[data-t="${name}"]`);
  if (btn) btn.click();
}

function paneMsg(id, msg, isErr) {
  const e = $(id);
  e.textContent = msg;
  e.style.display = msg ? 'block' : 'none';
  e.className = isErr ? 'f-err err' : 'f-err hint';
}

function lock(btn, locked, busyLabel) {
  if (locked) {
    btn.disabled = true;
    btn.dataset.label = btn.textContent;
    if (busyLabel) btn.textContent = busyLabel;
  } else {
    btn.disabled = false;
    if (btn.dataset.label) btn.textContent = btn.dataset.label;
  }
}

// 재전송 쿨다운 표시. 여러 버튼이 공유.
function startCooldown() {
  cooldownUntil = Date.now() + RESEND_COOLDOWN_SEC * 1000;
  tickCooldown();
  if (cooldownTimer) clearInterval(cooldownTimer);
  cooldownTimer = setInterval(tickCooldown, 1000);
}

function cooldownLeft() {
  return Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
}

function tickCooldown() {
  const left = cooldownLeft();
  for (const id of ['btnResend', 'btnResendFail']) {
    const b = $(id);
    if (!b) continue;
    if (left > 0) {
      b.disabled = true;
      b.textContent = `인증메일 다시 받기 (${left}초 후 가능)`;
    } else {
      b.disabled = false;
      if (id === 'btnResend') b.textContent = '인증메일 다시 받기';
      else b.textContent = '새 링크 받기';
      if (cooldownTimer) {
        clearInterval(cooldownTimer);
        cooldownTimer = null;
      }
    }
  }
}

function resendFailMessage(err) {
  const raw = ((err && err.message) || '').toLowerCase();
  if (raw.includes('rate') || raw.includes('limit') || raw.includes('too many')) {
    return '발송 한도에 도달했습니다. 잠시 후 다시 시도하세요. Google 로그인이 연결된 경우 Google로 로그인할 수 있습니다.';
  }
  if (raw.startsWith('not_configured') || raw.startsWith('sdk_missing')) return err.message;
  return '재전송에 실패했습니다. 잠시 후 다시 시도하세요.';
}

async function doJoin() {
  const btn = $('btnJoin');
  if (btn.disabled) return;
  paneMsg('joinMsg', '', false);
  const name = $('su-name').value.trim();
  const email = $('su-email').value.trim();
  const pw = $('su-pw').value;
  if (name.length < 1 || name.length > 100) {
    paneMsg('joinMsg', '표시 이름을 1~100자로 입력하세요.', true);
    return;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    paneMsg('joinMsg', '이메일 형식을 확인하세요.', true);
    return;
  }
  if (pw.length < 8) {
    paneMsg('joinMsg', '비밀번호는 8자 이상 입력하세요.', true);
    return;
  }
  lock(btn, true, '가입 신청 중…');
  try {
    // role/status는 전송하지 않음 — 서버 트리거가 pending/admin으로 강제(§4.2-2)
    await signUp(name, email, pw);
    $('sentEmail').textContent = email;
    $('sentEmailHidden').value = email;
    $('failEmail').value = email;
    activateTab('t-sent');
    startCooldown();
  } catch (err) {
    const raw = (err && err.message) || '';
    if (/already|registered|exists/i.test(raw)) {
      paneMsg('joinMsg', '이미 가입된 이메일입니다. 로그인을 시도하세요.', true);
    } else if (/rate|limit|too many/i.test(raw)) {
      paneMsg('joinMsg', '요청이 많습니다. 잠시 후 다시 시도하세요.', true);
    } else {
      paneMsg('joinMsg', '가입 신청에 실패했습니다. 다시 시도하세요.', true);
    }
  } finally {
    lock(btn, false);
  }
}

async function doResend(emailInputId, msgId, btn) {
  if (cooldownLeft() > 0) return;
  const email = $(emailInputId).value.trim();
  if (!email) {
    paneMsg(msgId, '이메일을 입력하세요.', true);
    return;
  }
  lock(btn, true, '발송 중…');
  paneMsg(msgId, '', false);
  try {
    await resendConfirm(email);
    paneMsg(msgId, '인증 메일을 다시 보냈습니다. 받은편지함(스팸함 포함)을 확인하세요.', false);
    startCooldown();
  } catch (err) {
    paneMsg(msgId, resendFailMessage(err), true);
  } finally {
    if (cooldownLeft() <= 0) lock(btn, false);
  }
}

async function doReset() {
  const btn = $('btnReset');
  if (btn.disabled) return;
  const email = $('rs-email').value.trim();
  if (!email) {
    paneMsg('resetMsg', '이메일을 입력하세요.', true);
    return;
  }
  lock(btn, true, '발송 중…');
  try {
    await resetPassword(email);
  } catch {
    // 성공·실패 메시지 통일 — 계정 존재 여부 노출 금지(§4.3)
  } finally {
    lock(btn, false);
  }
  paneMsg('resetMsg', '입력한 주소로 안내를 보냈습니다.', false);
}

async function init() {
  const notice = takeNotice();
  const hash = (location.hash || '').replace('#', '');
  if (['t-join', 't-sent', 't-fail', 't-reset'].includes(hash)) {
    activateTab(hash);
  }
  if (notice) {
    activateTab('t-fail');
    paneMsg('failMsg', notice, true);
  }

  // 로그인된 세션이 있으면 가입 폼은 의미 없음 — 안내만 표시
  try {
    const session = await getSession();
    if (session) {
      paneMsg('joinMsg', '이미 로그인되어 있습니다. 로그아웃 후 이용하세요.', true);
      $('btnJoin').disabled = true;
    }
  } catch {
    // 무시하고 폼 유지
  }

  $('btnJoin').addEventListener('click', doJoin);
  $('btnResend').addEventListener('click', (ev) => doResend('sentEmailHidden', 'sentMsg', ev.currentTarget));
  $('btnResendFail').addEventListener('click', (ev) => doResend('failEmail', 'failMsg', ev.currentTarget));
  $('btnReset').addEventListener('click', doReset);
  tickCooldown();
}

init();
