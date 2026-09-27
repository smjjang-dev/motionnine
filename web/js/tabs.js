// 모션나인 와이어프레임 — tabs.js
// 역할: W-02 가입/인증 4상태 탭 전환 (더미, signup.html 전용)
(function () {
  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      var scope = b.closest('.mock') || document;
      scope.querySelectorAll('.tabs button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      scope.querySelectorAll('.tabpane').forEach(function (t) { t.classList.remove('on'); });
      var pane = document.getElementById(b.dataset.t);
      if (pane) pane.classList.add('on');
    });
  });
})();
