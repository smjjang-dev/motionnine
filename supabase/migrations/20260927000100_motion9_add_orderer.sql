-- ============================================================================
-- 모션나인 발주현황 · 추가 마이그레이션 01: 주문자 3종 컬럼
-- 파일: supabase/migrations/20260927000100_motion9_add_orderer.sql
--
-- 언제 실행하나:
--   A) 00_init을 아직 실행하지 않았다면 → 이 파일 실행 불필요. 00만 실행하면 됨
--      (00 파일에 주문자 3종이 이미 포함되어 있음).
--   B) 00_init을 이미 실행했다면 → 이 파일 실행 후, 00 파일 전체를 한 번 더 실행
--      (00의 CREATE OR REPLACE 함수·정책·권한이 주문자 대응 버전으로 교체됨.
--       CREATE TABLE IF NOT EXISTS / ON CONFLICT DO NOTHING으로冪等하므로 안전).
-- ============================================================================

-- 1. 컬럼 추가 (기존 행이 있으면 아래 2절 backfill 후 NOT NULL 적용)
alter table public.motion9_orders
  add column if not exists orderer_name varchar(100),
  add column if not exists orderer_phone varchar(20),
  add column if not exists orderer_email varchar(200);

-- 2. 기존 행 backfill (필요 시. 신규 구축이면 영향 없음)
-- update public.motion9_orders set orderer_name = '미기재' where orderer_name is null;
-- update public.motion9_orders set orderer_phone = '010-0000-0000' where orderer_phone is null;

-- 3. 제약 (이름 중복 생성 방지용 DO 블록)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'motion9_orders_orderer_name_chk') then
    alter table public.motion9_orders add constraint motion9_orders_orderer_name_chk
      check (char_length(btrim(orderer_name)) between 1 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'motion9_orders_orderer_phone_chk') then
    alter table public.motion9_orders add constraint motion9_orders_orderer_phone_chk
      check (orderer_phone ~ '^01[0-9]-?[0-9]{3,4}-?[0-9]{4}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'motion9_orders_orderer_email_chk') then
    alter table public.motion9_orders add constraint motion9_orders_orderer_email_chk
      check (orderer_email is null
        or (char_length(orderer_email) <= 200 and orderer_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'));
  end if;
end $$;

alter table public.motion9_orders alter column orderer_name set not null;
alter table public.motion9_orders alter column orderer_phone set not null;

-- 4. 검색 인덱스
create index if not exists ix_motion9_orders_orderer_trgm
  on public.motion9_orders using gin (orderer_name gin_trgm_ops);
create index if not exists ix_motion9_orders_phone_trgm
  on public.motion9_orders using gin (orderer_phone gin_trgm_ops);

-- 5. 구(舊) 시그니처 RPC 제거 (00 재실행 시 신·구 공존 방지. 없으면 무시됨)
drop function if exists
  public.motion9_create_order(text, text, text, text, int, int, numeric, boolean, numeric, boolean, smallint, timestamptz, uuid);
drop function if exists
  public.motion9_update_order(uuid, int, text, text, text, text, int, int, numeric, boolean, numeric, boolean, smallint, timestamptz, text);

-- 6. 검증
-- select column_name, data_type, is_nullable from information_schema.columns
--  where table_schema = 'public' and table_name = 'motion9_orders'
--    and column_name in ('orderer_name', 'orderer_phone', 'orderer_email');
