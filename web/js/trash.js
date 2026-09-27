// web/js/trash.js — W-08 페이지 컨트롤러 (owner 전용)
// 삭제건 전용 조회 RPC가 없으므로 search_orders(owner는 RLS상 삭제건 포함)를
// 페이지 순회하며 deleted_at != null만 모아 표시 (08번 "또는" 허용 방식).
import { requireOwner } from './auth.js';
import { searchOrders, restoreOrder, mapDbError } from './order-api.js';
import { fmtKRW } from './money.js';
import { toKST } from './datetime.js';

const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 50;
const MAX_SCAN = 200; // 스캔 상한 (export 스냅샷과 동일 기준)
let rows = [];
let pendingRestore = null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function msg(t) {
  $('trashMsg').textContent = t;
}

async function fetchDeleted() {
  const out = [];
  let page = 1;
  for (;;) {
    const batch = await searchOrders({ page, size: PAGE_SIZE });
    if (!batch || batch.length === 0) break;
    for (const r of batch) {
      if (r.deleted_at) out.push(r);
    }
    if (batch.length < PAGE_SIZE || out.length >= MAX_SCAN) break;
    page += 1;
  }
  return out.slice(0, MAX_SCAN);
}

function restoreBtn(r) {
  const b = el('button', 'btn primary sm', '복원');
  b.type = 'button';
  b.addEventListener('click', () => {
    $('rsText').textContent = `${r.order_no}를 복원할까요? 번호·금액·이력은 그대로 유지됩니다.`;
    $('rsModal').style.display = 'block';
    pendingRestore = r;
  });
  return b;
}

function render() {
  const tb = $('trashRows');
  tb.replaceChildren();
  const cards = $('trashCards');
  cards.replaceChildren();
  if (rows.length === 0) {
    msg('삭제된 발주가 없습니다.');
    return;
  }
  msg('');
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.appendChild(el('td', null, r.order_no));
    tr.appendChild(el('td', null, `${r.client_name} · ${r.product_name} (${fmtKRW(r.total_amount)}원)`));
    tr.appendChild(el('td', null, `${toKST(r.deleted_at)} ${r.updated_by_name ?? ''}`));
    tr.appendChild(el('td', null, r.delete_reason ?? '-'));
    const td = el('td');
    td.appendChild(restoreBtn(r));
    tr.appendChild(td);
    tb.appendChild(tr);

    const card = el('div', 'ocard');
    const t1 = el('div', 't1');
    t1.appendChild(el('span', null, r.order_no));
    t1.appendChild(el('span', 'pill p-stop', '삭제됨'));
    card.appendChild(t1);
    card.appendChild(el('div', 't2', `${r.client_name} · ${r.product_name} · 사유: ${r.delete_reason ?? '-'}`));
    const t3 = el('div', 't3');
    t3.appendChild(el('span', null, `${toKST(r.deleted_at)} ${r.updated_by_name ?? ''}`));
    t3.appendChild(restoreBtn(r));
    card.appendChild(t3);
    cards.appendChild(card);
  }
}

async function load() {
  msg('불러오는 중…');
  try {
    rows = await fetchDeleted();
    render();
  } catch (err) {
    msg(mapDbError(err));
  }
}

async function doRestore() {
  const r = pendingRestore;
  pendingRestore = null;
  $('rsModal').style.display = 'none';
  if (!r) return;
  msg('복원 중…');
  try {
    await restoreOrder(r.id, r.version);
    msg('복원되었습니다.');
    await load();
  } catch (err) {
    // VERSION_CONFLICT 등 — 최신 삭제 상태를 다시 로드
    msg(mapDbError(err));
    await load();
  }
}

async function init() {
  const access = await requireOwner();
  if (!access) return;
  $('rsOk').addEventListener('click', doRestore);
  $('rsCancel').addEventListener('click', () => {
    pendingRestore = null;
    $('rsModal').style.display = 'none';
  });
  await load();
}

init();
