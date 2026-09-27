// web/js/auth.js
// W-01/02/03에서 import. 시그니처는 09번 지시서 §2 그대로.
// 권한 판정은 JWT가 아닌 DB membership(get_my_access) 실시간 조회로만 수행.
// 가입 시 클라이언트가 role/status를 보내도 서버 트리거가 pending/admin으로 강제 —
// 이 모듈은 role/status를 절대 전송하지 않음(§4.2-2).
import { getClient } from './supabase-client.js';
import { siteUrl } from './config.js';

export const STATUS = { PENDING: 'pending', ACTIVE: 'active', SUSPENDED: 'suspended', REJECTED: 'rejected' };
const NOTICE_KEY = 'motion9_notice';

function authed() {
  return getClient().auth;
}

export async function getSession() {
  const { data } = await authed().getSession();
  return data.session ?? null;
}

export async function fetchMyAccess() {
  const { data, error } = await getClient().rpc('motion9_get_my_access');
  if (error) throw error;
  return (data && data[0]) || null;
}

// 로그인 후 분기. 반환값은 이동한 URL.
export function routeByStatus(access) {
  if (access && access.status === STATUS.ACTIVE) {
    location.href = 'orders.html';
    return 'orders.html';
  }
  const st = access ? access.status : STATUS.PENDING;
  location.href = `pending.html?state=${st}`;
  return `pending.html?state=${st}`;
}

export async function signInEmail(email, password) {
  const { error } = await authed().signInWithPassword({ email, password });
  if (error) throw error;
  const access = await fetchMyAccess();
  return routeByStatus(access);
}

export async function signInWithGoogle() {
  const redirectTo = `${siteUrl()}/html/callback.html`;
  const { error } = await authed().signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  });
  if (error) throw error;
}

// 가입 — 표시 이름은 Auth 메타데이터 참고용으로만 전달. 권한은 서버가 강제.
export async function signUp(displayName, email, password) {
  const redirectTo = `${siteUrl()}/html/callback.html`;
  const { error } = await authed().signUp({
    email,
    password,
    options: { data: { display_name: displayName }, emailRedirectTo: redirectTo },
  });
  if (error) throw error;
}

export async function resendConfirm(email) {
  const { error } = await authed().resend({ type: 'signup', email });
  if (error) throw error;
}

export async function resetPassword(email) {
  const redirectTo = `${siteUrl()}/html/callback.html?type=recovery`;
  const { error } = await authed().resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

// callback.html 진입 시: SDK가 URL code를 세션으로 교환(detectSessionInUrl)한 뒤 분기.
// 실패·취소 시 login.html 복귀 + 사유 표시.
export async function handleCallback() {
  const params = new URLSearchParams(location.search);
  const err = params.get('error_description') || params.get('error');
  if (err) {
    setNotice('Google 로그인을 완료하지 못했습니다. 다시 시도하세요.');
    location.href = 'login.html';
    return;
  }
  const session = await getSession();
  if (!session) {
    // 다른 브라우저에서 연 링크 등 verifier 부재 케이스 → 재시작 안내
    setNotice('인증은 요청한 브라우저에서 완료하세요. 새 링크를 받으세요.');
    location.href = 'signup.html#t-fail';
    return;
  }
  if (params.get('type') === 'recovery') {
    setNotice('새 비밀번호를 설정하세요.');
    location.href = 'signup.html#t-reset';
    return;
  }
  const access = await fetchMyAccess();
  routeByStatus(access);
}

// 업무 페이지 가드. active가 아니면 해당 화면으로 리다이렉트하고 false 반환.
export async function requireActive() {
  const session = await getSession();
  if (!session) {
    location.href = 'login.html';
    return null;
  }
  let access = null;
  try {
    access = await fetchMyAccess();
  } catch {
    location.href = 'login.html';
    return null;
  }
  if (!access || access.status !== STATUS.ACTIVE) {
    const st = access ? access.status : STATUS.PENDING;
    location.href = `pending.html?state=${st}`;
    return null;
  }
  return access;
}

// admin/trash 가드. owner가 아니면 목록으로 돌려보내고 사유를 1회 표시.
export async function requireOwner() {
  const access = await requireActive();
  if (!access) return null;
  if (access.role !== 'owner') {
    setNotice('대표 관리자만 접근할 수 있습니다.');
    location.href = 'orders.html';
    return null;
  }
  return access;
}

export async function signOut() {
  try {
    await authed().signOut();
  } finally {
    clearLocalState();
    location.href = 'login.html';
  }
}

// 로그아웃·권한 오류 시 화면·메모리·쿼리 캐시 정리 대상 (세션 스토리지만 사용)
export function clearLocalState() {
  if (typeof sessionStorage === 'undefined') return;
  Object.keys(sessionStorage)
    .filter((k) => k.startsWith('motion9_'))
    .forEach((k) => sessionStorage.removeItem(k));
}

export function setNotice(msg) {
  if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(NOTICE_KEY, msg);
}

export function takeNotice() {
  if (typeof sessionStorage === 'undefined') return '';
  const v = sessionStorage.getItem(NOTICE_KEY) ?? '';
  sessionStorage.removeItem(NOTICE_KEY);
  return v;
}
