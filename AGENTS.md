# AGENTS.md — motionnine (모션나인 발주관리 웹서비스)

이 파일은 opencode·Claude Code 등 이 저장소에서 작업하는 모든 코딩 에이전트를 위한 유일한 원본
안내 문서다. `CLAUDE.md`는 이 파일을 그대로 불러오는 1줄짜리 파일이므로, 내용을 고칠 때는 항상
여기(`AGENTS.md`)에서 고친다 — 두 파일이 서로 다른 내용을 담지 않도록 유지한다.

## AI 작업 범위 원칙

1. 사용자가 요청하지 않은 파일은 읽거나 수정하지 않는다.
2. 전체 프로젝트 검색은 필요한 경우에만 수행한다.
3. 먼저 관련 파일을 식별한 후 해당 파일만 분석한다.
4. 단순 작업은 최소한의 컨텍스트만 사용한다.
5. 대규모 리팩터링은 단계별로 수행한다.
6. 수정 전에 계획을 간단히 제시한다.
7. 요청 범위를 벗어난 개선 작업을 하지 않는다.
8. 테스트는 변경된 영역을 우선적으로 수행한다.
9. 이미 확인한 내용을 반복해서 분석하지 않는다.
10. 기존 문서 전체를 불필요하게 읽지 않는다.

## 프로젝트 개요

"모션나인 발주관리 웹서비스" — 모션나인 발주관리를 웹/모바일로 관리하는 서비스이다. 관리자만 접속해서 사용하는 시스템으로
발주현황 관리와 발주명세서를 이미지 또는 PDF 파일로 다운로드 서비스.

## 개발 원칙

- 기존 기능을 임의로 삭제하지 않는다.
- 기존 데이터 호환성을 유지한다.
- UI 변경 전 현재 동작을 확인한다.
- 수정 전 반드시 관련 코드를 분석한다.
- 테스트 가능한 형태로 구현한다.
- 한 번에 너무 많은 파일을 수정하지 않는다.

## 작업 방식

요구사항 분석
→ Plan
→ 구현
→ 테스트
→ Review
→ Commit
→ Push
순서로 진행한다.

## 컴파일 또는 빌드

DEBUG 빌드에서만 AUTH_TRACE가 출력되도록 변경하고
RELEASE 빌드에서는 인증 상세 로그를 제거한다.
토큰/refresh token/Authorization header는 어떤 로그에도 출력하지 않는다.


구현 전 저장소: 기획 문서 + 정적 와이어프레임 + Supabase SQL만 존재. 실행 중인 앱은 아직 없음.
`package.json`, 빌드/테스트/린트, CI, `opencode.json` 없음. 도구 체인을 임의로 만들지 말 것.

## 구성 (정본 우선순위)

- `docs/모션나인_발주현황_기획설계서.md` — 최상위 명세 (업무 규칙, 금액, 발주번호, RLS/RPC). 문서 충돌 시 이 파일을 우선하고, 다음은 `docs/DB설계/motion9_DB설계서.md`.
- `docs/구현지시서/README.md` + `00_공통_기준.md` → `01..11` — 구현 순서. 화면 작업 전 `00`을 먼저 읽을 것.
- `web/html/*.html` (진입점: `index.html`) + `web/css/*.css` + `web/js/*.js` — 클릭용 와이어프레임이며 모든 버튼은 더미. `wireframe/index.html`은 구버전 단일 파일, 현재 기준은 `web/`.
- `supabase/migrations/` — 유일하게 실행 가능한 백엔드 코드. CLI가 아닌 Dashboard SQL Editor로 적용.

## 실행 / 검증 방법 (CLI 없음)

- 화면 미리보기: `web/html/index.html`을 브라우저에서 직접 열기 (서버·CDN 불필요, 오프라인 가능). PC/모바일 전환은 `btnPc/btnMo` → `#wrap.mobile-mode`.
- DB: 파일 전체를 Supabase Dashboard → SQL Editor에 붙여넣어 1회 실행. 부분 실행 금지.
  - 신규 프로젝트: `20260927000000_motion9_init.sql`만 실행 (주문자 컬럼 포함됨).
  - 주문자 변경 전 `00`을 이미 적용한 경우: `20260927000100_motion9_add_orderer.sql` 실행 후, `00` 전체를 다시 실행 (`CREATE OR REPLACE` / `IF NOT EXISTS`라 멱등하며 주문자 대응 함수로 교체됨).
  - 검증: `select * from private.motion9_settings;` → 1행 (5); `motion9_%` RPC 존재; `Table Editor`에서 `motion9` 필터 → 테이블 6개.
  - 최초 owner: 로그인 후 `Authentication > Users`에서 Auth UUID 복사, `select * from public.motion9_bootstrap_owner('<Auth-UUID>', '대표관리자');` 실행.
- 배포 (수동, `docs/구현지시서/11_*` 기준): Supabase 프로젝트 생성 → 마이그레이션 → Auth (Confirm email ON + Custom SMTP + Google provider 콜백 `https://<ref>.supabase.co/auth/v1/callback`) → Cloudflare Pages에 `web/` 정적 배포 → Site URL + allowlist → owner 초기화 → 나머지 승인.

## DB 규칙 (깨뜨리면 안 됨)

- 업무 객체는 전부 `motion9_` 접두어 (테이블·RPC·정책·트리거·인덱스, 충돌 방지). 신규 객체도 접두어 유지.
- 쓰기는 `motion9_*` RPC로만 (`create/update/change_stage/delete/restore/manage_member/update_limit/export/search/stage_counts/get_my_access/get_server_time`). `authenticated`는 public 테이블 SELECT 전용, 직접 INSERT/UPDATE/DELETE 정책 없음. `private.*`은 정책 없음 (RPC 소유자 권한으로만 접근). RLS를 우회하는 뷰나 범용 JSON-patch RPC 추가 금지.
- 에러 계약: 함수는 `'<CODE>'` 또는 `'<CODE>: ...'` 형태로 raise (P0001). 프런트는 `:` 앞부분으로 매핑: `ACCESS_DENIED, VALIDATION_ERROR, MOQ_NOT_MET, ADMIN_LIMIT_REACHED, LAST_OWNER_REQUIRED, VERSION_CONFLICT, ORDER_NOT_FOUND, DAILY_SEQUENCE_EXHAUSTED, REQUEST_ID_CONFLICT`. DB 내부 오류 노출 금지.
- 발주번호: `YYYYMMDD-NNNNN`, 단일 `clock_timestamp()` → KST 날짜 → `motion9_daily_counters` UPSERT (1~99999). 소급 수정·삭제·복원에도 번호 불변. 클라이언트 `max+1` 계산 금지. 신규 폼마다 `client_request_id` UUID를 새로 발급.
- 낙관적 잠금: 모든 변경은 `id + version` 전달, 불일치 → `VERSION_CONFLICT`. 삭제는 논리삭제 + 멱등, `restore`는 `owner` 전용.
- 권한 판정은 JWT role이 아닌 DB membership 실시간 조회 (`motion9_get_my_access()`). 중지된 계정은 다음 요청부터 차단.

## 프런트 규칙 (와이어프레임 → 구현)

- 스택: HTML5 + Vanilla JS ES Modules + CSS만. 프레임워크 금지. 신규 JS는 `web/js/`에 추가하고 `../js/xxx.js` 상대경로로 로드. 페이지 이동도 상대 링크 (`orders.html`, `order-form.html` …). 매 페이지 `.topbar` + `.topnav a.active` 유지, `noindex` 유지.
- 와이어프레임 ID 그대로 유지: 화면 `W-01..W-08`, 입력 `f-qty/f-price/f-vat/f-ship/f-fee`, 요약 `s-a/s-ps/s-pv/s-f/s-sv/s-t`. 명세상 신규 모듈: `config, supabase-client, auth, order-api, money, datetime, export, admin`.
- `service_role`, OAuth 시크릿, SMTP 비밀번호를 `web/`·문서·git에 넣지 말 것. 브라우저에는 Supabase URL + publishable/anon key만. 사용자 데이터 출력은 `textContent`로, `innerHTML` 금지. CSP + 버전 고정 자체호스팅 라이브러리.
- 검색: 6개 컬럼 OR (`client, orderer_name, orderer_phone, product, code, order_no`), `ILIKE` + `%_\` 이스케이프, 서버 검색만. 페이지 크기 ≤50 (기본 20), 정렬 고정 `ordered_at DESC, id DESC`. 단계별 건수는 검색어·기간은 적용하되 단계 필터는 제외. Export RPC 스냅샷 최대 200행, page/all 구분 표시.
- 날짜: 전부 KST. 날짜 필터 = `시작일 00:00+09 <= ordered_at < (종료일+1일) 00:00+09`. `datetime-local`은 `+09:00` 명시 변환, 단말 TZ 암묵 변환 금지. 폼 기본값 = `motion9_get_server_time()` KST, 미입력 제출 시 DB `now()`.

## 금액 공식 (§7.1 — JS 미리보기 = DB `private.motion9_calc`와 동일해야 함)

`Q=수량, P=단가, A=Q*P, R=0.10, F=배송비(VAT포함)`, 원 단위 `round` (0.5 올림), 단가별이 아닌 합계 기준 1회 계산. VAT Y=별도 (`공급가=A, VAT=round(A*R)`), N=포함 (`청구액=A, 공급가=round(A/1.1), VAT=A-공급가`). 포함 Y → 추가 배송비 0/0/0 (F는 참고값, 가산 안 함), N → (`청구액=F, 공급가=round(F/1.1), VAT=F-공급가`). 합계: `공급가+VAT=최종` (DB CHECK). 검산 (Q10/P10000/F3000): N+Y=100,000 · N+N=103,000 · Y+Y=110,000 · Y+N=113,000. 불일치 시 DB값이 정답. 기본값: `단계=1, 배송비=3000, VAT N, 포함 Y, KST now`.

## 유효성 검사 요약 (최종 판정은 DB)

`client/product/code/orderer_name/orderer_phone/qty/unit_price` 필수, 공백만 입력 불가. `orderer_phone ~ ^01[0-9]-?[0-9]{3,4}-?[0-9]{4}$`. `orderer_email` 빈값→NULL, 아니면 간단 이메일 검사. `qty` 정수 1~100만, `moq` 입력 시 `qty>=moq` 아니면 `MOQ_NOT_MET`. 금액 0~10억, `vat_rate=0.1000` 고정. 비인접 단계 점프·역행·완료(9) 후 금액 변경은 사유 필수. 삭제는 사유 1~500자 필수.
