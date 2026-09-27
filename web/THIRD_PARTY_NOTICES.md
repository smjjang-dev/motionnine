# THIRD_PARTY_NOTICES.md — web/vendor 자체호스팅 라이브러리 고지

버전 고정·자체호스팅(00번 §3). 아래 파일은 `web/vendor/`에 포함되며 각 라이선스를 따른다.

## @supabase/supabase-js 2.117.2 (UMD: web/vendor/supabase-js.min.js)

- 용도: Supabase Auth·PostgREST RPC 호출 (`web/js/supabase-client.js`가 `window.supabase.createClient` 사용)
- 출처: https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js
- 라이선스: Apache License 2.0 — https://github.com/supabase/supabase-js/blob/master/LICENSE

## html2canvas 1.4.1 (web/vendor/html2canvas.min.js)

- 용도: 출력 DOM → PNG 렌더링 (`web/js/export.js`가 `window.html2canvas` 사용)
- 출처: https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js
- 라이선스: MIT — https://github.com/niklasvh/html2canvas/blob/master/LICENSE

## jsPDF 4.2.1 (UMD: web/vendor/jspdf.umd.min.js)

- 용도: 렌더링 이미지 → A4 PDF 조립 (`web/js/export.js`가 `window.jspdf.jsPDF` 사용)
- 출처: https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js
- 라이선스: MIT — https://github.com/parallax/jsPDF/blob/master/LICENSE

업데이트 시 위 3개 파일을 같은 경로에 덮어쓰고 본 문서의 버전을 함께 갱신할 것.
