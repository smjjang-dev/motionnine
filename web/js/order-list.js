// web/js/order-list.js — W-04 페이지 컨트롤러
// 서버 페이지네이션만 사용 (전체 수신 후 브라우저 필터링 금지).
// 삭제건은 목록·집계에서 제외 — owner에게도 RLS상 삭제건이 보이므로 클라이언트에서 여과.
// PDF 내보내기 확인 모달까지 담당. 실제 파일 생성은 10번 단계 export.js가
// 'motion9:export-list' 이벤트로 연결됨.
import { requireActive, signOut, takeNotice } from './auth.js';
import { searchOrders, getStageCounts, exportOrders, mapDbError } from './order-api.js';
import { fmtKRW, stageName, stagePill } from './money.js';
import { toKST } from './datetime.js';

const $ = (id) => document.getElementById(id);
const STAGES = [1, 2, 3, 9];
let state = { q: '', from: '', to: '', stage: '', page: 1, size: 20 };
let lastRows = [];
let lastHasNext = false;
let loading = false;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function shortProduct(name, code) {
  const base = `${name} / ${code}`;
  return base.length > 22 ? `${base.slice(0, 21)}…` : base;
}

// ---- 쿼리스트링 양방향 바인딩 ----
function readQuery() {
  const p = new URLSearchParams(location.search);
  state = {
    q: p.get('q') ?? '',
    from: p.get('from') ?? '',
    to: p.get('to') ?? '',
    stage: p.get('stage') ?? '',
    page: Math.max(1, Number(p.get('page')) || 1),
    size: p.get('size') === '50' ? 50 : 20,
  };
}

function writeQuery() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.from) p.set('from', state.from);
  if (state.to) p.set('to', state.to);
  if (state.stage) p.set('stage', state.stage);
  if (state.page > 1) p.set('page', String(state.page));
  if (state.size !== 20) p.set('size', String(state.size));
  const qs = p.toString();
  history.replaceState(null, '', qs ? `orders.html?${qs}` : 'orders.html');
}

function syncControls() {
  $('q').value = state.q;
  $('fromDate').value = state.from;
  $('toDate').value = state.to;
  $('stageSel').value = state.stage;
  $('sizeSel').value = String(state.size);
}

// ---- 렌더 ----
function renderCounts(counts) {
  const map = new Map((counts ?? []).map((c) => [Number(c.stage), Number(c.cnt)]));
  for (const s of STAGES) {
    $(`cnt${s}`).textContent = String(map.get(s) ?? 0);
  }
}

function renderRows(rows) {
  const tb = $('orderRows');
  tb.replaceChildren();
  const cards = $('orderCards');
  cards.replaceChildren();
  for (const r of rows) {
    const tr = document.createElement('tr');
    const tdNo = el('td');
    const a = document.createElement('a');
    a.href = `order-detail.html?id=${r.id}`;
    a.textContent = r.order_no;
    tdNo.appendChild(a);
    tr.appendChild(tdNo);
    tr.appendChild(el('td', null, toKST(r.ordered_at)));
    tr.appendChild(el('td', null, r.client_name));
    tr.appendChild(el('td', null, r.orderer_name));
    tr.appendChild(el('td', null, shortProduct(r.product_name, r.product_code)));
    tr.appendChild(el('td', 'num', fmtKRW(r.quantity)));
    tr.appendChild(el('td', 'num', fmtKRW(r.total_amount)));
    const tdSt = el('td');
    const pill = el('span', `pill ${stagePill(r.shipping_stage)}`, stageName(r.shipping_stage));
    tdSt.appendChild(pill);
    tr.appendChild(tdSt);
    tb.appendChild(tr);

    const card = el('div', 'ocard');
    const t1 = el('div', 't1');
    const link = document.createElement('a');
    link.href = `order-detail.html?id=${r.id}`;
    link.textContent = r.order_no;
    t1.appendChild(link);
    t1.appendChild(el('span', `pill ${stagePill(r.shipping_stage)}`, stageName(r.shipping_stage)));
    card.appendChild(t1);
    card.appendChild(el('div', 't2', `${r.client_name} · ${r.orderer_name} · ${r.product_name}/${r.product_code} · ${fmtKRW(r.quantity)}개`));
    const t3 = el('div', 't3');
    t3.appendChild(el('span', null, toKST(r.ordered_at)));
    const b = el('b', null, `${fmtKRW(r.total_amount)}원`);
    t3.appendChild(b);
    card.appendChild(t3);
    cards.appendChild(card);
  }
}

function renderPager() {
  const pg = $('pager');
  pg.replaceChildren();
  const prev = el('button', 'btn sm', '이전');
  prev.type = 'button';
  prev.disabled = state.page <= 1;
  prev.addEventListener('click', () => {
    if (state.page > 1) {
      state.page -= 1;
      load();
    }
  });
  pg.appendChild(prev);
  for (let p = Math.max(1, state.page - 2); p <= state.page; p += 1) {
    const b = el('button', `btn sm${p === state.page ? ' dark' : ''}`, String(p));
    b.type = 'button';
    b.addEventListener('click', () => {
      state.page = p;
      load();
    });
    pg.appendChild(b);
  }
  if (lastHasNext) {
    const next = el('button', 'btn sm', '다음');
    next.type = 'button';
    next.addEventListener('click', () => {
      state.page += 1;
      load();
    });
    pg.appendChild(next);
  }
}

function showState(kind, msg) {
  const box = $('stateBox');
  box.replaceChildren();
  box.style.display = 'block';
  $('orderTable').style.display = 'none';
  $('orderCards').style.display = 'none';
  if (kind === 'loading') {
    for (let i = 0; i < 3; i += 1) box.appendChild(el('p', 'hint', '불러오는 중…'));
    return;
  }
  box.appendChild(el('p', null, msg));
  const btn = el('button', kind === 'empty' ? 'btn ghost sm' : 'btn sm', kind === 'empty' ? '필터 초기화' : '재시도');
  btn.type = 'button';
  btn.addEventListener('click', () => {
    if (kind === 'empty') resetFilters();
    else load();
  });
  box.appendChild(btn);
}

function showTable() {
  $('stateBox').style.display = 'none';
  $('orderTable').style.display = '';
  $('orderCards').style.display = '';
}

// ---- 데이터 ----
async function load() {
  if (loading) return;
  loading = true;
  writeQuery();
  syncControls();
  showState('loading');
  $('btnSearch').disabled = true;
  try {
    // 다음 페이지 존재 확인용으로 1건 더 조회 후 잘라냄
    const [rows, counts] = await Promise.all([
      searchOrders({ ...state, size: state.size + 1 }),
      getStageCounts(state),
    ]);
    const live = (rows ?? []).filter((r) => !r.deleted_at);
    lastHasNext = live.length > state.size;
    lastRows = live.slice(0, state.size);
    renderCounts(counts);
    if (lastRows.length === 0) {
      renderPager();
      showState('empty', '조건에 맞는 발주가 없습니다.');
    } else {
      renderRows(lastRows);
      renderPager();
      showTable();
    }
  } catch (err) {
    renderPager();
    showState('error', `목록을 불러오지 못했습니다. (${mapDbError(err)})`);
  } finally {
    loading = false;
    $('btnSearch').disabled = false;
  }
}

function doSearch() {
  state.q = $('q').value.trim();
  state.from = $('fromDate').value;
  state.to = $('toDate').value;
  state.stage = $('stageSel').value;
  state.size = Number($('sizeSel').value);
  state.page = 1;
  load();
}

function resetFilters() {
  state = { q: '', from: '', to: '', stage: '', page: 1, size: 20 };
  load();
}

// ---- PDF 확인 모달 ----
function openPdfModal() {
  $('pdfInfo').textContent = `현재 조건 ${lastRows.length}건 표시 중 — 최대 200건 내보내기 (현재 페이지 / 조건 전체)`;
  $('pdfMsg').textContent = '';
  $('pdfModal').style.display = 'block';
}

function closePdfModal() {
  $('pdfModal').style.display = 'none';
}

async function runExport(scope) {
  $('pdfMsg').textContent = '조회 중…';
  try {
    const rows = await exportOrders({ ...state, scope, page: state.page, size: state.size });
    const live = (rows ?? []).filter((r) => !r.deleted_at);
    if (live.length === 0) {
      $('pdfMsg').textContent = '내보낼 발주가 없습니다.';
      return;
    }
    if (live.length >= 200 && scope === 'all') {
      $('pdfMsg').textContent = '200건에 도달했습니다. 기간·필터를 좁혀주세요.';
    }
    document.dispatchEvent(
      new CustomEvent('motion9:export-list', {
        detail: { rows: live, scope, filters: { ...state } },
      }),
    );
    // export.js 미응답 대비 (정상 시 export-done 또는 에러 문구가 먼저 표시됨)
    $('pdfMsg').textContent = '';
    setTimeout(() => {
      if (!$('pdfMsg').dataset.done && !$('pdfMsg').textContent) {
        $('pdfMsg').textContent = '다운로드 모듈이 응답하지 않습니다. 새로고침 후 다시 시도하세요.';
      }
    }, 500);
  } catch (err) {
    $('pdfMsg').textContent = mapDbError(err);
  }
}

async function init() {
  const access = await requireActive();
  if (!access) return;
  $('userLabel').textContent = `${access.display_name}(${access.role})`;
  const notice = takeNotice();
  if (notice) {
    $('noticeBar').textContent = notice;
    $('noticeBar').style.display = 'block';
  }

  readQuery();
  $('btnSearch').addEventListener('click', doSearch);
  $('q').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') doSearch();
  });
  $('btnReset').addEventListener('click', resetFilters);
  $('stageSel').addEventListener('change', doSearch);
  $('sizeSel').addEventListener('change', doSearch);
  $('btnLogout').addEventListener('click', signOut);
  document.querySelectorAll('.stage[data-stage]').forEach((card) => {
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => {
      const s = card.dataset.stage;
      state.stage = state.stage === s ? '' : s;
      state.page = 1;
      load();
    });
  });

  $('btnPdf').addEventListener('click', openPdfModal);
  $('btnPdfCancel').addEventListener('click', closePdfModal);
  $('btnPdfPage').addEventListener('click', () => runExport('page'));
  $('btnPdfAll').addEventListener('click', () => runExport('all'));
  document.addEventListener('motion9:export-done', () => {
    $('pdfMsg').dataset.done = '1';
    $('pdfMsg').textContent = '저장되었습니다.';
  });

  await load();
}

init();
