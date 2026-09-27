// web/js/order-detail.js — W-06 페이지 컨트롤러
// 계산 내역은 DB 반환값 그대로 표시, 재계산 금지.
// 다운로드 버튼은 'motion9:export-detail' 이벤트 발행 — 실제 파일 생성은 10번 export.js.
import { requireActive } from './auth.js';
import { getOrder, getAuditLogs, mapDbError } from './order-api.js';
import { fmtKRW, stageName, stagePill } from './money.js';
import { toKST, toKSTFull } from './datetime.js';

const $ = (id) => document.getElementById(id);
const NOT_FOUND = '발주를 찾을 수 없습니다.';

const ACTION_KO = {
  create: '생성',
  update: '수정',
  stage_change: '단계 변경',
  delete: '삭제',
  restore: '복원',
};

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function kv(dt, dd) {
  const wrap = $('detKv');
  wrap.appendChild(el('dt', null, dt));
  wrap.appendChild(el('dd', null, dd));
}

function renderRow(r) {
  $('detTitle').textContent = `발주 상세 ${r.order_no}`;
  document.title = `${r.order_no} — 모션나인 발주 상세`;
  const pill = $('detPill');
  pill.textContent = stageName(r.shipping_stage);
  pill.className = `pill ${stagePill(r.shipping_stage)}`;
  $('linkEdit').href = `order-form.html?id=${r.id}`;
  $('linkDelete').href = `order-form.html?id=${r.id}#delete`;

  $('detKv').replaceChildren();
  kv('거래처', r.client_name);
  kv('주문자', r.orderer_name);
  kv('연락처 / 이메일', `${r.orderer_phone} / ${r.orderer_email ?? '-'}`);
  kv('제품 / 코드', `${r.product_name} / ${r.product_code}`);
  kv('옵션', r.option_text ?? '-');
  kv('수량 / MOQ / 단가', `${fmtKRW(r.quantity)}개 / ${r.moq == null ? '-' : `${fmtKRW(r.moq)}개`} / ${fmtKRW(r.unit_price)}원`);
  kv(
    '세금·배송',
    `부가세 별도 ${r.vat_exclusive ? 'Y(별도)' : 'N(VAT포함)'} · 배송비 포함 ${r.shipping_included ? 'Y' : 'N'} · 배송비 ${fmtKRW(r.shipping_fee)}원${r.shipping_included ? '(참고값)' : ''}`,
  );
  kv('발주일 / 번호날짜', `${toKSTFull(r.ordered_at)} KST / ${r.number_date} (다를 수 있음)`);
  kv('등록', `${toKSTFull(r.created_at)} ${r.created_by_name}`);
  kv('최종 수정', `${toKSTFull(r.updated_at)} ${r.updated_by_name} (v${r.version})`);

  // DB 확정값 그대로 (합계 불변조건 표시는 Phase 0 money.checkInvariant와 동일식)
  $('c-ps').textContent = fmtKRW(r.product_supply_amount);
  $('c-pv').textContent = fmtKRW(r.product_vat_amount);
  $('c-f').textContent = `${fmtKRW(r.shipping_charge_amount)} (${fmtKRW(r.shipping_supply_amount)}+${fmtKRW(r.shipping_vat_amount)})`;
  $('c-sum').textContent = `${fmtKRW(r.supply_amount)} / ${fmtKRW(r.vat_amount)} / ${fmtKRW(r.total_amount)}`;
}

function renderAudit(logs) {
  const tl = $('auditList');
  tl.replaceChildren();
  if (logs.length === 0) {
    tl.appendChild(el('div', null, '이력이 없습니다.'));
    return;
  }
  for (const l of logs) {
    const line = el('div');
    const head = el('b', null, toKST(l.created_at));
    line.appendChild(head);
    let body = ` ${l.actor_name} · ${ACTION_KO[l.action] ?? l.action}`;
    const bv = l.before_data?.version;
    const av = l.after_data?.version;
    if (bv != null && av != null && bv !== av) body += ` · v${bv}→v${av}`;
    if (l.reason) body += ` · 사유: ${l.reason}`;
    line.appendChild(document.createTextNode(body));
    tl.appendChild(line);
  }
}

function requestExport(format, row) {
  document.dispatchEvent(new CustomEvent('motion9:export-detail', { detail: { format, row } }));
  setTimeout(() => {
    if (!$('dlMsg').dataset.done) $('dlMsg').textContent = '다운로드 모듈 연결 후(10번 단계) 저장됩니다.';
  }, 300);
}

async function init() {
  const access = await requireActive();
  if (!access) return;
  const id = new URLSearchParams(location.search).get('id');
  if (!id) {
    $('detMsg').textContent = `${NOT_FOUND} 목록으로 돌아가세요.`;
    $('detBody').style.display = 'none';
    return;
  }
  try {
    const row = await getOrder(id);
    if (!row) {
      // 없는 건·권한 없음 공통 문구 (구분 불가)
      $('detMsg').textContent = NOT_FOUND;
      $('detBody').style.display = 'none';
      return;
    }
    if (row.deleted_at) {
      if (access.role !== 'owner') {
        $('detMsg').textContent = NOT_FOUND;
        $('detBody').style.display = 'none';
        return;
      }
      $('detMsg').textContent = `삭제된 발주입니다. (사유: ${row.delete_reason ?? '-'}) 복원은 삭제 내역에서 하세요.`;
      const a = document.createElement('a');
      a.href = 'trash.html';
      a.className = 'btn sm';
      a.textContent = '삭제 내역으로';
      $('detMsg').appendChild(document.createElement('br'));
      $('detMsg').appendChild(a);
    }
    renderRow(row);
    const logs = await getAuditLogs(id);
    renderAudit(logs);
    $('btnPng').addEventListener('click', () => requestExport('png', row));
    $('btnPdf').addEventListener('click', () => requestExport('pdf', row));
    document.addEventListener('motion9:export-done', () => {
      $('dlMsg').dataset.done = '1';
      $('dlMsg').textContent = '저장되었습니다.';
    });
  } catch (err) {
    $('detMsg').textContent = mapDbError(err);
    $('detBody').style.display = 'none';
  }
}

init();
