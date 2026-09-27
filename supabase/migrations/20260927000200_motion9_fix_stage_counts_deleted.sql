-- ============================================================================
-- 모션나인 발주현황 · 추가 마이그레이션 02: 단계별 건수 삭제건 제외
-- 파일: supabase/migrations/20260927000200_motion9_fix_stage_counts_deleted.sql
--
-- 배경:
--   motion9_stage_counts()가 deleted_at 조건 없이 전체 발주를 집계해,
--   삭제(논리삭제)된 발주까지 발주목록 화면의 단계별 건수 카드에 그대로
--   남아 목록(실제 표시 건수 0)과 집계 숫자가 어긋나는 문제가 실운영
--   검증 중 발견됨. motion9_search_orders는 owner가 삭제건도 조회할 수
--   있어야 해서 의도적으로 클라이언트에서 deleted_at을 거르지만, 집계
--   RPC는 클라이언트에서 후처리할 방법이 없으므로 함수 자체에서 제외한다.
--
-- 언제 실행하나:
--   00_init을 이미 실행한 기존 프로젝트 → 이 파일만 실행하면 됨
--   (CREATE OR REPLACE FUNCTION이라 시그니처 변경 없이 멱등하게 교체됨).
--   신규 프로젝트는 00_init 파일 자체에 이미 반영되어 있어 이 파일 불필요.
-- ============================================================================

create or replace function public.motion9_stage_counts(p_q text, p_from date, p_to date)
returns table (stage smallint, cnt bigint)
language plpgsql stable security invoker set search_path = public, private, extensions as $$
declare
  v_gte timestamptz; v_lt timestamptz; v_pat text;
begin
  if auth.uid() is null then
    raise exception 'ACCESS_DENIED';
  end if;
  if p_from is not null then
    v_gte := ((p_from) || ' 00:00:00+09')::timestamptz;
  end if;
  if p_to is not null then
    v_lt := ((p_to + 1) || ' 00:00:00+09')::timestamptz;
  end if;
  if nullif(btrim(coalesce(p_q, '')), '') is not null then
    v_pat := '%' || private.motion9_escape_like(btrim(p_q)) || '%';
  end if;
  return query
  select o.shipping_stage, count(*)::bigint from public.motion9_orders o
  where o.deleted_at is null
    and (v_gte is null or o.ordered_at >= v_gte)
    and (v_lt is null or o.ordered_at < v_lt)
    and (v_pat is null or o.client_name ilike v_pat escape '\'
       or o.orderer_name ilike v_pat escape '\'
       or o.orderer_phone ilike v_pat escape '\'
       or o.product_name ilike v_pat escape '\'
       or o.product_code ilike v_pat escape '\'
       or o.order_no ilike v_pat escape '\')
  group by o.shipping_stage;
end $$;

-- 검증 (주석 해제 후 실행)
-- select shipping_stage, count(*) filter (where deleted_at is null) as live,
--        count(*) filter (where deleted_at is not null) as deleted
--   from public.motion9_orders group by shipping_stage order by shipping_stage;
-- select * from public.motion9_stage_counts(null, null, null); -- live 값과 일치해야 함
