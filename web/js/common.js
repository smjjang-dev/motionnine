// 모션나인 와이어프레임 — common.js
// 역할: PC/모바일 미리보기 토글 (전 페이지 공통). 실구현이 아님.
(function () {
  var wrap = document.getElementById('wrap');
  var btnPc = document.getElementById('btnPc');
  var btnMo = document.getElementById('btnMo');
  function setOn(btn) {
    document.querySelectorAll('.toggle button').forEach(function (x) { x.classList.remove('on'); });
    if (btn) btn.classList.add('on');
  }
  if (btnPc) btnPc.addEventListener('click', function (e) {
    if (wrap) wrap.classList.remove('mobile-mode');
    setOn(e.currentTarget);
  });
  if (btnMo) btnMo.addEventListener('click', function (e) {
    if (wrap) wrap.classList.add('mobile-mode');
    setOn(e.currentTarget);
  });
})();
