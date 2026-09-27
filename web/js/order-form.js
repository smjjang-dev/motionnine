// 모션나인 와이어프레임 — order-form.js
// 역할: W-05 금액 미리보기. 기획설계서 §7.1 계산식 그대로 (DB 확정 전 미리보기용).
// Q=수량, P=단가, A=Q×P, R=0.10, F=배송비(VAT포함). 원 단위 반올림.
(function () {
  function $(id) { return document.getElementById(id); }
  var q = $('f-qty'), p = $('f-price'), v = $('f-vat'), s = $('f-ship'), f = $('f-fee');
  if (!q || !p || !v || !s || !f) return;
  function r(x) { return Math.round(x); }
  function fm(n) { return Number(n).toLocaleString('ko-KR'); }
  function set(id, val) { var e = $(id); if (e) e.textContent = val; }
  function calc() {
    var Q = +q.value || 0, P = +p.value || 0, F = +f.value || 0, A = Q * P;
    var ps, pv;
    if (v.value === 'Y') { ps = A; pv = r(A * 0.10); }
    else { ps = r(A / 1.1); pv = A - ps; }
    var fc = 0, ss = 0, sv = 0;
    if (s.value === 'N') { fc = F; ss = r(F / 1.1); sv = F - ss; }
    var st = ps + ss, vt = pv + sv, t = st + vt;
    set('s-a', fm(A)); set('s-ps', fm(ps)); set('s-pv', fm(pv));
    set('s-f', fm(fc)); set('s-sv', fm(ss) + ' / ' + fm(sv)); set('s-t', fm(t));
  }
  [q, p, v, s, f].forEach(function (e) { e.addEventListener('input', calc); e.addEventListener('change', calc); });
  calc();
})();
