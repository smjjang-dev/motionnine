// web/js/order-api.js
// motion9_* RPC 래퍼 + 에러 한글 매핑. 전 화면에서 import. 시그니처는 09번 §3 그대로.
// 원칙: 번호·작성자·계산·감사 필드는 절대 전송하지 않음 (서버가 거부·무시).
// 직접 테이블 SELECT는 getOrder(단건)·getAuditLogs(이력)만 RLS 경계 안에서 사용.
import { getClient } from './supabase-client.js';

export const ERR_KO = {
  ACCESS_DENIED: '권한이 없습니다. 로그인 상태를 확인하세요.',
  VALIDATION_ERROR: '입력값을 확인하세요.',
  MOQ_NOT_MET: '수량이 MOQ보다 적습니다.',
  ADMIN_LIMIT_REACHED: '활성 정원이 찼습니다.',
  LAST_OWNER_REQUIRED: '마지막 대표 관리자는 변경할 수 없습니다.',
  VERSION_CONFLICT: '다른 관리자가 먼저 수정했습니다. 새 데이터를 불러오세요.',
  ORDER_NOT_FOUND: '발주를 찾을 수 없습니다.',
  DAILY_SEQUENCE_EXHAUSTED: '오늘 발주번호가 소진되었습니다. 내일 다시 시도하세요.',
  REQUEST_ID_CONFLICT: '이미 사용된 요청입니다. 입력 변경 후 새 요청으로 저장하세요.',
};

// DB raise '<CODE>' 또는 '<CODE>: 상세' → ':' 앞 코드로 한글 매핑. DB 원문 노출 금지.
export function mapDbError(err) {
  const raw = err && err.message ? err.message : String(err ?? '');
  const code = raw.split(':')[0].trim();
  if (ERR_KO[code]) return ERR_KO[code];
  return '요청을 처리하지 못했습니다. 다시 시도하세요.';
}

async function rpc(name, args) {
  const { data, error } = await getClient().rpc(name, args);
  if (error) throw new Error(error.message, { cause: error });
  return data;
}

export async function getMyAccess() {
  const data = await rpc('motion9_get_my_access');
  return (data && data[0]) || null;
}

export async function getServerTime() {
  const data = await rpc('motion9_get_server_time');
  return data && data[0];
}

// 목록·검색. size는 1~50 강제, 정렬은 서버 고정(ordered_at DESC, id DESC).
export async function searchOrders({ q = '', from = null, to = null, stage = null, page = 1, size = 20 } = {}) {
  const pStage = stage === null || stage === undefined || stage === '' ? null : Number(stage);
  return rpc('motion9_search_orders', {
    p_q: q || null,
    p_from: from || null,
    p_to: to || null,
    p_stage: pStage,
    p_page: Math.max(1, Number(page) || 1),
    p_size: Math.min(50, Math.max(1, Number(size) || 20)),
  });
}

// 단계별 건수 — 검색어·기간만 적용, 단계 필터는 제외 (§5.2)
export async function getStageCounts({ q = '', from = null, to = null } = {}) {
  return rpc('motion9_stage_counts', { p_q: q || null, p_from: from || null, p_to: to || null });
}

// 단건 조회 (RLS). 없는 건·권한 없음은 null → 호출 측에서 ORDER_NOT_FOUND 문구.
export async function getOrder(id) {
  const { data, error } = await getClient().from('motion9_orders').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message, { cause: error });
  return data ?? null;
}

// 변경 이력 (RLS, 생성 시각 내림차순). 감사 로그는 수정·삭제 불가.
export async function getAuditLogs(orderId) {
  const { data, error } = await getClient()
    .from('motion9_order_audit_logs')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });
  if (error) throw new Error(error.message, { cause: error });
  return data ?? [];
}

// payload 허용 필드만 (스네이크→DB 파라미터 매핑). ordered_at은 ISO(+09:00) 또는 null.
export function toCreateParams(p) {
  return {
    p_client_name: p.client_name,
    p_orderer_name: p.orderer_name,
    p_orderer_phone: p.orderer_phone,
    p_orderer_email: p.orderer_email || null,
    p_product_name: p.product_name,
    p_product_code: p.product_code,
    p_option_text: p.option_text || null,
    p_quantity: Number(p.quantity),
    p_moq: p.moq === null || p.moq === undefined || p.moq === '' ? null : Number(p.moq),
    p_unit_price: Number(p.unit_price),
    p_vat_exclusive: p.vat_exclusive === true,
    p_shipping_fee: Number(p.shipping_fee),
    p_shipping_included: p.shipping_included !== false,
    p_shipping_stage: Number(p.shipping_stage),
    p_ordered_at: p.ordered_at || null,
  };
}

export async function createOrder(payload, requestId) {
  return rpc('motion9_create_order', { ...toCreateParams(payload), p_request_id: requestId });
}

export async function updateOrder(id, version, payload, reason) {
  return rpc('motion9_update_order', {
    p_id: id,
    p_version: version,
    ...toCreateParams(payload),
    p_reason: reason || null,
  });
}

export async function changeStage(id, version, stage, reason) {
  return rpc('motion9_change_stage', {
    p_id: id,
    p_version: version,
    p_stage: Number(stage),
    p_reason: reason || null,
  });
}

export async function deleteOrder(id, version, reason) {
  return rpc('motion9_delete_order', { p_id: id, p_version: version, p_reason: reason });
}

export async function restoreOrder(id, version) {
  return rpc('motion9_restore_order', { p_id: id, p_version: version });
}

// 내보내기 스냅샷 (최대 200건, 단일 조회). scope: 'page' | 'all'
export async function exportOrders({ q = '', from = null, to = null, stage = null, scope = 'page', page = 1, size = 20 } = {}) {
  return rpc('motion9_export_orders', {
    p_q: q || null,
    p_from: from || null,
    p_to: to || null,
    p_stage: stage === null || stage === undefined || stage === '' ? null : Number(stage),
    p_scope: scope,
    p_page: Math.max(1, Number(page) || 1),
    p_size: Math.min(50, Math.max(1, Number(size) || 20)),
  });
}

// owner 전용
export async function adminList() {
  return rpc('motion9_admin_list');
}

export async function manageMember(action, target, role = null) {
  return rpc('motion9_manage_member', { p_target: target, p_action: action, p_role: role });
}

export async function updateLimit(n) {
  return rpc('motion9_update_limit', { p_max: Number(n) });
}
