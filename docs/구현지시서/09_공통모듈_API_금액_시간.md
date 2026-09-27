# 09 공용 모듈 — 구현 지시서 (config·supabase-client·auth·order-api·money·datetime)

기획 §9.2 권장 파일과 현행 `web/js/` 3종을 연결하는 신규 모듈 명세. 전부 ES Modules.

## 1. 파일 목록 (생성 위치: `web/js/`)

| 파일 | 역할 | 비고 |
|---|---|---|
| `config.js` | Supabase URL·publishable key, 시연/개발 구분 | 비밀값 금지, 최종 번들 공개 정보임을 주석 |
| `supabase-client.js` | SDK 초기화 단일 인스턴스 | `service_role` 사용 금지 |
| `auth.js` | 로그인·가입·재설정·콜백·가드·로그아웃 | W-01/02/03에서 import |
| `order-api.js` | RPC 래퍼 + 에러 한글 매핑 | 전 화면에서 import |
| `money.js` | 금액 포맷·불변조건 검증 | `order-form.js` 미리보기와 분리 (표시용) |
| `datetime.js` | KST 변환·필터 경계·표시 포맷 | 단말 TZ 암묵 변환 금지 |
| `order-list.js` | W-04 쿼리스트링·집계·페이지 렌더 | 신규 |
| `order-detail.js` | W-06 단건·이력 렌더 | 신규 |
| `admin.js` | W-07/08 owner RPC 호출 | 신규 |
| `export.js` | W-06/04 다운로드 생성 | 10번 지시서 |

현행 유지: `common.js` (토글), `tabs.js` (W-02), `order-form.js` (§7.1 미리보기 — **식 변경 금지**).

## 2. `auth.js` 함수 시그니처

```js
signInEmail(email, password) -> get_my_access 분기
signInWithGoogle() // PKCE, 콜백은 auth/callback에서 handleCallback()
signUp(name, email, password) / resendConfirm(email) / resetPassword(email)
handleCallback() // code 교환 + 에러 → login.html 복귀
requireActive()  // 업무 페이지 가드 → pending.html 리다이렉트
requireOwner()   // admin/trash 가드 → ACCESS_DENIED 화면
signOut()        // 세션·메모리·캐시 정리
```

## 3. `order-api.js` 함수 시그니처

```js
getMyAccess() / getServerTime()
searchOrders({q, from, to, stage, page, size})
getOrder(id) / createOrder(payload, requestId)
updateOrder(id, version, payload, reason)
changeStage(id, version, stage, reason)
deleteOrder(id, version, reason) / restoreOrder(id, version)
adminList() / manageMember(action, target) / updateLimit(n)
exportOrders({q, from, to, stage, scope}) // 최대 200건 스냅샷
```

- 공통: `page_size = min(size, 50)`, 허용 정렬만 전송, RPC 에러 → 00번 6번 한글 매핑.
- `payload` 허용 필드만: client_name/orderer_name/orderer_phone/orderer_email/product_name/product_code/option_text/quantity/moq/unit_price/vat_exclusive/shipping_fee/shipping_included/shipping_stage/ordered_at (+reason 별도). 번호·작성자·계산·감사 필드 전송 금지.

## 4. `money.js` / `datetime.js`

```js
// money.js
fmtKRW(n) // toLocaleString('ko-KR')
checkInvariant(supply, vat, total) // supply+vat===total
// datetime.js
toKST(iso) -> 'MM/DD HH:mm' / 'YYYY-MM-DD HH:mm'
kstDayRange(from, to) -> {gte: 'YYYY-MM-DDT00:00:00+09:00', lt: 종료일+1일}
nowKSTInput(serverTime) -> datetime-local 초기값
```

- `datetime-local` 파싱 시 `+09:00` 부착 후 `new Date()` — 단말 TZ 사용 금지.

## 5. 수용 기준

- [ ] 모든 업무 호출 전 `requireActive()` 통과 (토큰만으로 우회 불가).
- [ ] `supply+vat=total` 불일치 시 저장 차단 + 경고.
- [ ] KST 종료일 23:59:59 포함 조회 확인.

## 6. 체크리스트

- [ ] `config.js`에 실 키를 커밋하지 않고 배포 시 주입 (대시보드 환경변수 또는 배포 전 수동 교체 + `.gitignore`).
- [ ] `order-form.js`와 `money.js` 간 식 중복 시 §7.1 단일 소스 주석 명시.
