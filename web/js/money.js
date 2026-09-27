// web/js/money.js
// 표시용 금액 포맷 + 합계 불변조건 검증 전용.
// §7.1 계산식의 유일한 구현은 web/js/order-form.js 미리보기와 DB private.motion9_calc.
// 계산식을 여기에 중복하지 말 것 (00번 09-6 — 중복 시 §7.1 단일 소스 주석 유지).
export function fmtKRW(n) {
  if (n === null || n === undefined || n === '') return '-';
  return Number(n).toLocaleString('ko-KR');
}

// supply + vat === total (DB CHECK와 동일식). 불일치 시 저장 차단용.
export function checkInvariant(supply, vat, total) {
  if ([supply, vat, total].some((v) => v === null || v === undefined)) return false;
  return Number(supply) + Number(vat) === Number(total);
}

export function stageName(stage) {
  return stage === 1 ? '접수' : stage === 2 ? '준비' : stage === 3 ? '발송' : stage === 9 ? '완료' : '알 수 없음';
}

export function stagePill(stage) {
  return stage === 1 ? 'p1' : stage === 2 ? 'p2' : stage === 3 ? 'p3' : stage === 9 ? 'p9' : 'p1';
}
