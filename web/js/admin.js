// web/js/admin.js — W-07 페이지 컨트롤러 (owner 전용)
// 정원 최대값 조회 RPC가 따로 없으므로(변경 응답에만 포함), 화면에는 활성 수 +
// 마지막으로 확인된 최대값을 표시. 정원 검사는 서버(manage_member·update_limit)가 강제.
import { requireOwner } from './auth.js';
import { adminList, manageMember, updateLimit, mapDbError } from './order-api.js';
import { toKSTDate } from './datetime.js';

const $ = (id) => document.getElementById(id);
let me = null;
let members = [];
let knownMax = Number(sessionStorage.getItem('motion9_max') ?? 5);
let pendingConfirm = null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function shortEmail(email) {
  if (!email) return '-';
  return email.length > 24 ? `${email.slice(0, 23)}…` : email;
}

function msg(t) {
  $('adminMsg').textContent = t;
}

function askConfirm(text, fn) {
  $('cfText').textContent = text;
  $('cfModal').style.display = 'block';
  pendingConfirm = fn;
}

async function runConfirm() {
  const fn = pendingConfirm;
  pendingConfirm = null;
  $('cfModal').style.display = 'none';
  if (fn) await fn();
}

function actionBtn(label, cls, fn) {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', () => {
    b.disabled = true;
    Promise.resolve()
      .then(fn)
      .catch((err) => msg(mapDbError(err)))
      .finally(() => {
        b.disabled = false;
      });
  });
  return b;
}

async function doManage(action, target, label, role = null) {
  msg('처리 중…');
  try {
    await manageMember(action, target, role);
    msg(`${label} 완료.`);
    await load();
  } catch (err) {
    msg(mapDbError(err));
  }
}

function render() {
  const pend = members.filter((m) => m.status === 'pending');
  const active = members.filter((m) => m.status === 'active');
  const stopped = members.filter((m) => m.status === 'suspended' || m.status === 'rejected');

  $('quotaText').textContent = `정원: 활성 ${active.length} / 최대 ${knownMax} (대표 포함) — 3~5 범위에서만 변경 가능`;
  $('quotaBar').style.width = `${Math.min(100, (active.length / 5) * 100)}%`;
  $('limitWarn').textContent = `현재 활성 ${active.length}명 — 이보다 낮게 줄일 수 없습니다.`;

  const pt = $('pendRows');
  pt.replaceChildren();
  $('pendTitle').textContent = `승인 대기 (${pend.length})`;
  for (const m of pend) {
    const tr = document.createElement('tr');
    tr.appendChild(el('td', null, `${m.display_name} · ${shortEmail(m.email)}`));
    tr.appendChild(el('td', null, m.email_confirmed_at ? '이메일 확인됨' : '미확인'));
    tr.appendChild(el('td', null, toKSTDate(m.created_at)));
    const td = el('td');
    const ok = actionBtn('승인', 'btn primary sm', () =>
      askConfirm(`${m.display_name}(${m.email ?? '-'})을 승인할까요? 활성 정원을 검사합니다.`, () =>
        doManage('approve', m.user_id, '승인'),
      ),
    );
    if (!m.email_confirmed_at) ok.disabled = true;
    td.appendChild(ok);
    td.appendChild(document.createTextNode(' '));
    td.appendChild(
      actionBtn('거절', 'btn ghost sm', () =>
        askConfirm(`${m.display_name}을 거절할까요?`, () => doManage('reject', m.user_id, '거절')),
      ),
    );
    tr.appendChild(td);
    pt.appendChild(tr);
  }

  const at = $('activeRows');
  at.replaceChildren();
  $('activeTitle').textContent = `활성 (${active.length})`;
  for (const m of active) {
    const tr = document.createElement('tr');
    tr.appendChild(el('td', null, `${m.display_name}${m.user_id === me.user_id ? ' (나)' : ''}`));
    tr.appendChild(el('td', null, m.role));
    const st = el('td');
    st.appendChild(el('span', 'pill p9', 'active'));
    tr.appendChild(st);
    const td = el('td');
    if (m.user_id === me.user_id) {
      td.textContent = '—';
    } else {
      td.appendChild(
        actionBtn('중지', 'btn ghost sm', () =>
          askConfirm(`${m.display_name}을 중지할까요? 업무 접근이 즉시 차단됩니다.`, () =>
            doManage('suspend', m.user_id, '중지'),
          ),
        ),
      );
      if (m.role !== 'owner') {
        td.appendChild(document.createTextNode(' '));
        td.appendChild(
          actionBtn('owner 승격', 'btn ghost sm', () =>
            askConfirm(`${m.display_name}을 owner로 승격할까요?`, () =>
              doManage('change_role', m.user_id, '승격', 'owner'),
            ),
          ),
        );
      }
    }
    tr.appendChild(td);
    at.appendChild(tr);
  }

  const st = $('stopRows');
  st.replaceChildren();
  $('stopTitle').textContent = `중지 (${stopped.length})`;
  for (const m of stopped) {
    const tr = document.createElement('tr');
    tr.appendChild(el('td', null, m.display_name));
    tr.appendChild(el('td', null, m.status));
    // 관리자 감사 이력 조회 RPC가 없으므로 membership의 승인·갱신 시각을 표시
    tr.appendChild(el('td', null, `승인 ${m.approved_at ? toKSTDate(m.approved_at) : '-'} · 갱신 ${toKSTDate(m.updated_at)}`));
    const td = el('td');
    td.appendChild(
      actionBtn('재활성화(정원 검사)', 'btn sm', () =>
        askConfirm(`${m.display_name}을 재활성화할까요? 활성 정원을 검사합니다.`, () =>
          doManage('reactivate', m.user_id, '재활성화'),
        ),
      ),
    );
    tr.appendChild(td);
    st.appendChild(tr);
  }
}

async function load() {
  msg('불러오는 중…');
  try {
    members = (await adminList()) ?? [];
    msg('');
    render();
  } catch (err) {
    msg(mapDbError(err));
  }
}

async function doLimit() {
  const n = Number($('limitSel').value);
  askConfirm(`최대 인원을 ${n}명으로 변경할까요?`, async () => {
    msg('처리 중…');
    try {
      const res = await updateLimit(n);
      if (res && res[0]) {
        knownMax = Number(res[0].max_active_admins);
        sessionStorage.setItem('motion9_max', String(knownMax));
      }
      msg('정원 변경 완료.');
      await load();
    } catch (err) {
      msg(mapDbError(err));
    }
  });
}

async function init() {
  me = await requireOwner();
  if (!me) return;
  $('btnLimit').addEventListener('click', doLimit);
  $('cfOk').addEventListener('click', runConfirm);
  $('cfCancel').addEventListener('click', () => {
    pendingConfirm = null;
    $('cfModal').style.display = 'none';
  });
  await load();
}

init();
