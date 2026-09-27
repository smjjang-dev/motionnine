// web/js/order-save.js — W-05 저장 컨트롤러 (등록·수정·삭제)
// 금액 미리보기는 web/js/order-form.js 전담(§7.1, 식 변경 금지). 이 모듈은 검증·저장만.
// 모드: order-form.html(등록) / order-form.html?id={uuid}(수정).
import { requireActive } from './auth.js';
import {
  getOrder, getServerTime, createOrder, updateOrder, changeStage, deleteOrder, mapDbError,
} from './order-api.js';
import { parseKSTInput, serverInputToLocal } from './datetime.js';

const $ = (id) => document.getElementById(id);
const PHONE_RE = /^01[0-9]-?[0-9]{3,4}-?[0-9]{4}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ADJ = new Set(['1>2', '2>3', '3>9']);

let mode = 'create'; // 'create' | 'edit'
let editId = null;
let editVersion = null;
let oldRow = null;
let requestId = null;
let dirty = false;
let saving = false;

function newRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const h = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
  return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`;
}

function setErr(field, msg) {
  const e = $(`e-${field}`);
  if (e) {
    e.textContent = msg || '';
    e.style.display = msg ? 'block' : 'none';
  }
}

function clearErrs() {
  document.querySelectorAll('.f-err[id^="e-"]').forEach((e) => {
    e.textContent = '';
    e.style.display = 'none';
  });
  $('formMsg').textContent = '';
}

function val(id) {
  return $(id).value.trim();
}

function num(id) {
  const v = $(id).value.trim();
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

// 화면 1차 검증 (DB CHECK 미러 — 최종 판정은 DB)
function validate() {
  clearErrs();
  let first = null;
  const fail = (field, msg) => {
    setErr(field, msg);
    if (!first) first = field;
  };
  const p = collect();
  if (!p.client_name || p.client_name.length > 100) fail('client', '거래처명을 1~100자로 입력하세요.');
  if (!p.orderer_name || p.orderer_name.length > 100) fail('orderer', '주문자를 1~100자로 입력하세요.');
  if (!PHONE_RE.test(val('f-phone'))) fail('phone', '휴대폰 번호 형식을 확인하세요. (예: 010-1234-5678)');
  if (p.orderer_email && (p.orderer_email.length > 200 || !EMAIL_RE.test(p.orderer_email))) {
    fail('email', '이메일 형식을 확인하세요.');
  }
  if (!p.product_name || p.product_name.length > 200) fail('product', '제품명을 1~200자로 입력하세요.');
  if (!p.product_code || p.product_code.length > 100) fail('code', '제품코드를 1~100자로 입력하세요.');
  if (p.option_text && p.option_text.length > 500) fail('option', '옵션이 500자를 초과했습니다.');
  const q = num('f-qty');
  if (!Number.isInteger(q) || q < 1 || q > 1000000) fail('qty', '수량은 1~1,000,000 정수입니다.');
  const moq = num('f-moq');
  if ($('f-moq').value.trim() !== '' && (!Number.isInteger(moq) || moq < 1 || moq > 1000000)) {
    fail('moq', 'MOQ 범위를 확인하세요.');
  } else if (Number.isInteger(moq) && Number.isInteger(q) && q < moq) {
    fail('moq', '수량이 MOQ보다 적습니다.');
  }
  const price = num('f-price');
  if ($('f-price').value.trim() === '' || !(price >= 0 && price <= 1000000000)) {
    fail('price', '단가를 0~10억원으로 입력하세요.');
  }
  const fee = num('f-fee');
  if ($('f-fee').value.trim() === '' || !(fee >= 0 && fee <= 1000000000)) {
    fail('fee', '배송비를 0~10억원으로 입력하세요.');
  }
  if (!['1', '2', '3', '9'].includes($('f-stage').value)) fail('stage', '발송단계가 올바르지 않습니다.');

  // 사유 규칙: 역행·건너뛰기·완료(9) 후 금액 변경은 사유 필수
  if (mode === 'edit' && oldRow) {
    const reason = val('f-reason');
    const stageChanged = String(oldRow.shipping_stage) !== $('f-stage').value;
    const amtChanged =
      Number(oldRow.quantity) !== q ||
      Number(oldRow.unit_price) !== price ||
      oldRow.vat_exclusive !== ($('f-vat').value === 'Y') ||
      Number(oldRow.shipping_fee) !== fee ||
      oldRow.shipping_included !== ($('f-ship').value === 'Y');
    const jump = stageChanged && !ADJ.has(`${oldRow.shipping_stage}>${$('f-stage').value}`);
    if ((jump || (Number(oldRow.shipping_stage) === 9 && amtChanged)) && !reason) {
      fail('reason', '단계 역행·건너뛰기 또는 완료 후 금액 변경에는 사유가 필요합니다.');
    }
    if (Number(oldRow.shipping_stage) === 9 && amtChanged && reason) {
      // eslint-disable-next-line no-alert
      if (!window.confirm('완료 상태의 금액을 변경합니다. 계속할까요?')) return { ok: false, cancelled: true };
    }
  }
  if (first) {
    $(`f-${first}`)?.focus();
    return { ok: false };
  }
  return { ok: true, payload: p };
}

function collect() {
  const orderedRaw = $('f-ordered').value;
  return {
    client_name: val('f-client'),
    orderer_name: val('f-orderer'),
    orderer_phone: val('f-phone'),
    orderer_email: val('f-email') || null,
    product_name: val('f-product'),
    product_code: val('f-code'),
    option_text: val('f-option') || null,
    quantity: Number($('f-qty').value),
    moq: $('f-moq').value.trim() === '' ? null : Number($('f-moq').value),
    unit_price: Number($('f-price').value),
    vat_exclusive: $('f-vat').value === 'Y',
    shipping_fee: Number($('f-fee').value),
    shipping_included: $('f-ship').value === 'Y',
    shipping_stage: Number($('f-stage').value),
    ordered_at: orderedRaw ? parseKSTInput(orderedRaw) : null,
  };
}

function fill(row) {
  $('f-client').value = row.client_name ?? '';
  $('f-orderer').value = row.orderer_name ?? '';
  $('f-phone').value = row.orderer_phone ?? '';
  $('f-email').value = row.orderer_email ?? '';
  if (row.ordered_at) {
    const d = new Date(row.ordered_at);
    const pad = (n) => String(n).padStart(2, '0');
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    // UTC 필드로 KST 시각을 datetime-local 형식으로 (서버값 표시용)
    $('f-ordered').value = `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}T${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`;
  }
  $('f-product').value = row.product_name ?? '';
  $('f-code').value = row.product_code ?? '';
  $('f-option').value = row.option_text ?? '';
  $('f-qty').value = row.quantity ?? '';
  $('f-moq').value = row.moq ?? '';
  $('f-price').value = row.unit_price ?? '';
  $('f-vat').value = row.vat_exclusive ? 'Y' : 'N';
  $('f-ship').value = row.shipping_included ? 'Y' : 'N';
  $('f-fee').value = row.shipping_fee ?? '';
  $('f-stage').value = String(row.shipping_stage);
  // 미리보기 재계산 트리거 (order-form.js가 input 이벤트 구독)
  for (const id of ['f-qty', 'f-price', 'f-vat', 'f-ship', 'f-fee']) {
    $(id).dispatchEvent(new Event('input', { bubbles: true }));
  }
}

async function doSave() {
  if (saving) return;
  const v = validate();
  if (!v.ok) return;
  saving = true;
  const btn = $('btnSave');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = '저장 중…';
  try {
    if (mode === 'create') {
      const row = await createOrder(v.payload, requestId);
      dirty = false;
      location.href = `order-detail.html?id=${row.id}`;
    } else {
      const onlyStage =
        v.payload.client_name === oldRow.client_name &&
        v.payload.orderer_name === oldRow.orderer_name &&
        v.payload.orderer_phone === oldRow.orderer_phone &&
        (v.payload.orderer_email ?? '') === (oldRow.orderer_email ?? '') &&
        v.payload.product_name === oldRow.product_name &&
        v.payload.product_code === oldRow.product_code &&
        (v.payload.option_text ?? '') === (oldRow.option_text ?? '') &&
        v.payload.quantity === Number(oldRow.quantity) &&
        (v.payload.moq ?? -1) === (oldRow.moq ?? -1) &&
        v.payload.unit_price === Number(oldRow.unit_price) &&
        v.payload.vat_exclusive === oldRow.vat_exclusive &&
        v.payload.shipping_fee === Number(oldRow.shipping_fee) &&
        v.payload.shipping_included === oldRow.shipping_included;
      const reason = val('f-reason') || null;
      const orderedRaw = $('f-ordered').value;
      const orderedChanged =
        orderedRaw !== '' && new Date(parseKSTInput(orderedRaw)).getTime() !== new Date(oldRow.ordered_at).getTime();
      const row = onlyStage && !orderedChanged
        ? await changeStage(editId, editVersion, v.payload.shipping_stage, reason)
        : await updateOrder(editId, editVersion, v.payload, reason);
      dirty = false;
      location.href = `order-detail.html?id=${row.id}`;
    }
  } catch (err) {
    const msg = mapDbError(err);
    $('formMsg').textContent = msg;
    if (/VERSION_CONFLICT|VERSION_CONFLICT/.test(err.message) || msg.includes('먼저 수정')) {
      $('formMsg').textContent += ' [새로고침 후 다시 시도하세요.]';
    }
  } finally {
    saving = false;
    btn.disabled = false;
    btn.textContent = label;
  }
}

function openDelete() {
  if (!oldRow) return;
  $('delInfo').textContent = `${oldRow.order_no} · ${oldRow.client_name} · ${oldRow.orderer_name} · ${oldRow.product_name}를 논리 삭제할까요? 삭제 후 일반 목록에서 제외되며, owner가 복원할 수 있습니다.`;
  $('delReason').value = '';
  $('delMsg').textContent = '';
  $('delModal').style.display = 'block';
}

async function doDelete() {
  const reason = $('delReason').value.trim();
  if (!reason) {
    $('delMsg').textContent = '삭제 사유를 입력하세요.';
    return;
  }
  const btn = $('btnDelConfirm');
  btn.disabled = true;
  try {
    await deleteOrder(editId, editVersion, reason);
    dirty = false;
    location.href = 'orders.html';
  } catch (err) {
    $('delMsg').textContent = mapDbError(err);
    btn.disabled = false;
  }
}

async function init() {
  const access = await requireActive();
  if (!access) return;
  const params = new URLSearchParams(location.search);
  editId = params.get('id');

  document.querySelectorAll('.form input, .form select, .form textarea').forEach((e) => {
    e.addEventListener('input', () => {
      dirty = true;
    });
  });
  window.addEventListener('beforeunload', (ev) => {
    if (dirty && !saving) {
      ev.preventDefault();
      ev.returnValue = '';
    }
  });

  $('btnSave').addEventListener('click', doSave);
  $('btnDelete').addEventListener('click', openDelete);
  $('btnDelCancel').addEventListener('click', () => {
    $('delModal').style.display = 'none';
  });
  $('btnDelConfirm').addEventListener('click', doDelete);

  if (editId) {
    mode = 'edit';
    $('formTitle').textContent = '발주 수정';
    $('btnDelete').style.display = '';
    const row = await getOrder(editId).catch(() => null);
    if (!row) {
      $('formMsg').textContent = '발주를 찾을 수 없습니다.';
      $('btnSave').disabled = true;
      return;
    }
    if (row.deleted_at) {
      $('formMsg').textContent = '삭제된 발주는 수정할 수 없습니다. 복원 후 수정하세요.';
      $('btnSave').disabled = true;
      return;
    }
    oldRow = row;
    editVersion = row.version;
    $('orderNoLabel').value = `${row.order_no} (v${row.version})`;
    fill(row);
  } else {
    requestId = newRequestId();
    $('reqLabel').textContent = `요청ID: ${requestId.slice(0, 8)}… (중복등록 방지 §8.1)`;
    try {
      const t = await getServerTime();
      if (t && t.kst_input) $('f-ordered').value = serverInputToLocal(t.kst_input);
    } catch {
      // 서버 시각 실패 시 빈칸 — 저장 시 DB now() 적용
    }
  }
}

init();
