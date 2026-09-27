// web/js/datetime.js
// 전부 KST 기준. 단말 TZ 암묵 변환 금지 — Intl timeZone 고정 + '+09:00' 명시.
// DB 저장(timestamptz)·API(ISO 8601 with TZ)와 화면 표시 사이의 유일한 변환 계층.
const KST = 'Asia/Seoul';

function parts(iso) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: KST,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  if (p.hour === '24') p.hour = '00';
  return p;
}

// 'MM/DD HH:mm' — 목록·카드·이력 표시용
export function toKST(iso) {
  if (!iso) return '-';
  const p = parts(iso);
  return `${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

// 'YYYY-MM-DD HH:mm' — 상세 표시용
export function toKSTFull(iso) {
  if (!iso) return '-';
  const p = parts(iso);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

// KST 날짜 'YYYY-MM-DD' — date input·필터용
export function toKSTDate(iso) {
  if (!iso) return '';
  const p = parts(iso);
  return `${p.year}-${p.month}-${p.day}`;
}

// datetime-local 값('YYYY-MM-DDTHH:mm', KST 의미) → ISO '+09:00' 명시
export function parseKSTInput(v) {
  if (!v) return null;
  return `${v}:00+09:00`;
}

// get_server_time()의 kst_input 그대로 datetime-local 초기값으로 사용
export function serverInputToLocal(kstInput) {
  return kstInput ?? '';
}

// 날짜 필터 KST 경계: 시작일 00:00+09 이상 ~ (종료일+1일) 00:00+09 미만
export function kstDayRange(fromDate, toDate) {
  const gte = fromDate ? `${fromDate}T00:00:00+09:00` : null;
  let lt = null;
  if (toDate) {
    const d = new Date(`${toDate}T00:00:00+09:00`);
    d.setDate(d.getDate() + 1);
    lt = d.toISOString();
  }
  return { gte, lt };
}
