// web/js/pending.js — W-03 게이트 화면
// 진입 시 get_my_access() 1회로 상태별 카드 1개만 표시. 폴링 금지(수동 새로고침만).
// 문구는 §4.2-7 고정 문구만 사용.
import { getSession, fetchMyAccess, signOut, takeNotice } from './auth.js';

const $ = (id) => document.getElementById(id);

function render(access, email) {
  $('cardPending').style.display = 'none';
  $('cardStopped').style.display = 'none';
  if (!access || access.status === 'pending') {
    $('pendingWho').textContent = `${access?.display_name ?? '-'}(${email ?? '-'})`;
    $('cardPending').style.display = 'block';
  } else if (access.status === 'active') {
    location.href = 'orders.html';
  } else {
    // suspended · rejected → 중지 문구로 통일
    $('cardStopped').style.display = 'block';
  }
  $('gateLoading').style.display = 'none';
}

async function refresh() {
  const btn = $('btnRecheck');
  btn.disabled = true;
  try {
    const session = await getSession();
    if (!session) {
      location.href = 'login.html';
      return;
    }
    const access = await fetchMyAccess();
    render(access, session.user?.email);
  } catch {
    $('gateLoading').textContent = '상태를 불러오지 못했습니다. [내 상태 다시 확인]을 눌러주세요.';
  } finally {
    btn.disabled = false;
  }
}

async function init() {
  const notice = takeNotice();
  if (notice) $('gateNotice').textContent = notice;
  $('btnRecheck').addEventListener('click', refresh);
  $('btnLogout1').addEventListener('click', signOut);
  $('btnLogout2').addEventListener('click', signOut);
  await refresh();
}

init();
