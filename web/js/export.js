// web/js/export.js — 10번 다운로드 생성 모듈 (부수효과: 이벤트 리스너 등록)
// 'motion9:export-list' (W-04) · 'motion9:export-detail' (W-06) 수신 → PNG/PDF 저장 후
// 'motion9:export-done' 발행. vendor 전역(html2canvas·jspdf) 필요.
// 초기 PDF는 이미지 기반 — 본문 검색 미지원, HTML 상세가 원본임을 화면에 안내済.
import { fmtKRW, stageName } from './money.js';
import { toKSTFull, toKSTDate } from './datetime.js';

const A4W = 794; // 고정폭 A4 비율 출력 DOM (모바일 화면 캡처 금지)
const DETAIL_CHUNK = 12; // 이력 페이지당 항목 수 (거대 단일 캔버스 금지)
const LIST_CHUNK = 25; // 목록 페이지당 행 수

function needVendor() {
  const h2c = window.html2canvas;
  const Pdf = window.jspdf && window.jspdf.jsPDF;
  if (!h2c || !Pdf) throw new Error('VENDOR_MISSING: web/vendor 출력 라이브러리 로드가 필요합니다.');
  return { h2c, Pdf };
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// 출력용 루트 (화면 밖에 배치, 렌더 후 제거)
function root() {
  let r = document.getElementById('print-root');
  if (!r) {
    r = el('div');
    r.id = 'print-root';
    document.body.appendChild(r);
  }
  r.replaceChildren();
  return r;
}

function kvRow(dl, k, v) {
  dl.appendChild(el('dt', null, k));
  dl.appendChild(el('dd', null, v));
}

function nowKST() {
  return toKSTFull(new Date().toISOString());
}

function outStamp() {
  return el('p', 'xp-stamp', `출력시각(KST): ${nowKST()} · 모션나인 발주관리`);
}

// ---- 상세 명세서 DOM (§10.1 포함 항목, 로그인 이메일·UUID·권한 제외) ----
function buildDetail(r) {
  const pages = [];
  const p1 = el('section', 'xp-page');
  p1.appendChild(el('h1', 'xp-title', '모션나인 발주 명세서'));
  p1.appendChild(el('p', 'xp-no', `발주번호: ${r.order_no}`));
  const dl = el('dl', 'xp-kv');
  kvRow(dl, '거래처', r.client_name);
  kvRow(dl, '주문자', r.orderer_name);
  kvRow(dl, '주문자 연락처', r.orderer_phone);
  kvRow(dl, '주문자 이메일', r.orderer_email ?? '-');
  kvRow(dl, '발주일', `${toKSTFull(r.ordered_at)} KST`);
  kvRow(dl, '제품명', r.product_name);
  kvRow(dl, '제품코드', r.product_code);
  kvRow(dl, '옵션', r.option_text ?? '-');
  kvRow(dl, '수량 / MOQ / 단가', `${fmtKRW(r.quantity)}개 / ${r.moq == null ? '-' : `${fmtKRW(r.moq)}개`} / ${fmtKRW(r.unit_price)}원`);
  kvRow(
    dl,
    '세금·배송 조건',
    `부가세 별도 ${r.vat_exclusive ? 'Y(별도)' : 'N(포함)'} · 배송비 포함 ${r.shipping_included ? 'Y' : 'N'} · 배송비 ${fmtKRW(r.shipping_fee)}원`,
  );
  kvRow(dl, '발송단계', stageName(r.shipping_stage));
  p1.appendChild(dl);
  const calc = el('table', 'xp-calc');
  const rows = [
    ['상품 공급가액', fmtKRW(r.product_supply_amount)],
    ['상품 VAT', fmtKRW(r.product_vat_amount)],
    ['추가 배송 청구액 (공급가+VAT)', `${fmtKRW(r.shipping_charge_amount)} (${fmtKRW(r.shipping_supply_amount)}+${fmtKRW(r.shipping_vat_amount)})`],
    ['공급가 합계 / VAT 합계 / 최종 청구액', `${fmtKRW(r.supply_amount)} / ${fmtKRW(r.vat_amount)} / ${fmtKRW(r.total_amount)}`],
  ];
  for (const [k, v] of rows) {
    const tr = document.createElement('tr');
    tr.appendChild(el('td', null, k));
    tr.appendChild(el('td', 'num', v));
    calc.appendChild(tr);
  }
  p1.appendChild(calc);
  const meta = el('dl', 'xp-kv');
  kvRow(meta, '최초 등록', `${toKSTFull(r.created_at)} ${r.created_by_name}`);
  kvRow(meta, '최종 수정', `${toKSTFull(r.updated_at)} ${r.updated_by_name} (v${r.version})`);
  p1.appendChild(meta);
  p1.appendChild(outStamp());
  pages.push(p1);
  return pages;
}

function buildHistory(logs) {
  const pages = [];
  const labels = { create: '생성', update: '수정', stage_change: '단계 변경', delete: '삭제', restore: '복원' };
  for (let i = 0; i < logs.length; i += DETAIL_CHUNK) {
    const sec = el('section', 'xp-page');
    sec.appendChild(el('h2', 'xp-h2', `변경 이력 (${i + 1}–${Math.min(i + DETAIL_CHUNK, logs.length)} / ${logs.length})`));
    const ul = el('ul', 'xp-list');
    for (const l of logs.slice(i, i + DETAIL_CHUNK)) {
      ul.appendChild(
        el('li', null, `${toKSTFull(l.created_at)} · ${l.actor_name} · ${labels[l.action] ?? l.action}${l.reason ? ` · 사유: ${l.reason}` : ''}`),
      );
    }
    sec.appendChild(ul);
    sec.appendChild(outStamp());
    pages.push(sec);
  }
  return pages;
}

// ---- 목록 DOM (§10.3) ----
function buildList(rows, filters, scope) {
  const pages = [];
  const cond = [
    filters.q ? `검색:${filters.q}` : '검색:없음',
    filters.from || filters.to ? `기간:${filters.from || '~'}~${filters.to || ''}` : '기간:전체',
    filters.stage ? `단계:${stageName(Number(filters.stage))}` : '단계:전체',
    `범위:${scope === 'all' ? '조건 전체' : '현재 페이지'}`,
  ].join(' · ');
  for (let i = 0; i < rows.length; i += LIST_CHUNK) {
    const sec = el('section', 'xp-page');
    sec.appendChild(el('h1', 'xp-title', '모션나인 발주 목록'));
    sec.appendChild(el('p', 'xp-cond', cond));
    const t = el('table', 'xp-calc');
    const head = document.createElement('tr');
    for (const h of ['발주번호', '발주일', '거래처', '주문자', '제품/코드', '수량', '합계', '단계']) {
      head.appendChild(el('th', null, h));
    }
    t.appendChild(head);
    for (const r of rows.slice(i, i + LIST_CHUNK)) {
      const tr = document.createElement('tr');
      for (const v of [
        r.order_no,
        toKSTFull(r.ordered_at),
        r.client_name,
        r.orderer_name,
        `${r.product_name}/${r.product_code}`,
        fmtKRW(r.quantity),
        fmtKRW(r.total_amount),
        stageName(r.shipping_stage),
      ]) {
        tr.appendChild(el('td', null, v));
      }
      t.appendChild(tr);
    }
    sec.appendChild(t);
    sec.appendChild(el('p', 'xp-stamp', `${i + 1}–${Math.min(i + LIST_CHUNK, rows.length)} / ${rows.length}건 · 출력시각(KST): ${nowKST()}`));
    pages.push(sec);
  }
  return pages;
}

// ---- 렌더·저장 ----
async function waitAssets(r) {
  try {
    await document.fonts.ready;
  } catch {
    // 폰트 API 미지원 환경은 진행
  }
  const imgs = [...r.querySelectorAll('img')];
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise((resolve) => {
          if (img.complete) return resolve();
          img.onload = () => resolve();
          img.onerror = () => resolve();
        }),
    ),
  );
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('RENDER_FAILED: 이미지 생성에 실패했습니다.'))), 'image/png');
  });
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function pagesToImages(h2c, pages) {
  const out = [];
  for (const sec of pages) {
    const canvas = await h2c(sec, { backgroundColor: '#ffffff', scale: 2 });
    out.push(canvas);
  }
  return out;
}

async function savePng(canvases, base) {
  for (let i = 0; i < canvases.length; i += 1) {
    const blob = await canvasBlob(canvases[i]);
    const name = canvases.length === 1 ? `${base}.png` : `${base}_${String(i + 1).padStart(2, '0')}.png`;
    download(blob, name);
  }
}

async function savePdf(Pdf, canvases, base) {
  const pdf = new Pdf({ unit: 'mm', format: 'a4' });
  canvases.forEach((canvas, i) => {
    if (i > 0) pdf.addPage();
    const img = canvas.toDataURL('image/png');
    const w = 210;
    const h = (canvas.height * w) / canvas.width;
    // A4 높이(297mm) 초과 시 축소 배치 (표 중간 절단은 print.css avoid로 완화)
    const hh = Math.min(h, 297);
    pdf.addImage(img, 'PNG', 0, 0, w, hh);
  });
  pdf.save(`${base}.pdf`);
}

async function runDetail({ format, row }) {
  const { h2c, Pdf } = needVendor();
  const r = root();
  // 이력은 상세 화면에서 별도 조회가 필요 — 없으면 본문만 출력
  const pages = buildDetail(row);
  r.append(...pages);
  await waitAssets(r);
  const canvases = await pagesToImages(h2c, [...r.children]);
  const base = `모션나인_발주명세서_${row.order_no}`;
  if (format === 'png') await savePng(canvases, base);
  else await savePdf(Pdf, canvases, base);
  r.replaceChildren();
  document.dispatchEvent(new CustomEvent('motion9:export-done'));
}

async function runList({ rows: rowsIn, scope, filters }) {
  const { h2c, Pdf } = needVendor();
  const r = root();
  const pages = buildList(rowsIn, filters, scope);
  r.append(...pages);
  await waitAssets(r);
  const canvases = await pagesToImages(h2c, [...r.children]);
  const base = `모션나인_발주목록_${toKSTDate(new Date().toISOString()).replaceAll('-', '')}`;
  await savePdf(Pdf, canvases, base);
  r.replaceChildren();
  document.dispatchEvent(new CustomEvent('motion9:export-done'));
}

document.addEventListener('motion9:export-detail', (ev) => {
  runDetail(ev.detail).catch((err) => {
    const m = document.getElementById('dlMsg');
    if (m) m.textContent = err.message || '다운로드에 실패했습니다.';
  });
});

document.addEventListener('motion9:export-list', (ev) => {
  runList(ev.detail).catch((err) => {
    const m = document.getElementById('pdfMsg');
    if (m) {
      m.dataset.done = '1';
      m.textContent = err.message || '다운로드에 실패했습니다.';
    }
  });
});
