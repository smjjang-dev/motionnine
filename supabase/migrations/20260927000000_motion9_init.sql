-- ============================================================================
-- 모션나인 발주현황 · Supabase 초기 마이그레이션 (motion9_ 접두어)
-- 파일: supabase/migrations/20260927000000_motion9_init.sql
-- 기준: docs/모션나인_발주현황_기획설계서.md v1.1 (§6, §7, §8, §9)
-- 실행: Supabase Dashboard > SQL Editor에 전체 붙여넣기 (1회). 부분 실행 금지.
-- 원칙:
--   1) 모든 업무 테이블은 motion9_ 접두어 (기존 테이블과 충돌 방지).
--   2) 에러는 raise exception '<CODE>' 또는 '<CODE>: 상세' (P0001). 프런트는 ':' 앞부분으로 한글 매핑.
--   3) 금액·번호·권한·시각은 DB 확정. 프런트 계산값·작성자·시각을 신뢰하지 않음.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. 확장 · 스키마
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

create schema if not exists private;

-- ----------------------------------------------------------------------------
-- 1. 테이블: public.motion9_members (관리자 membership)
--    기획 §6.2. auth.users의 비밀번호·토큰을 복제하지 않음.
-- ----------------------------------------------------------------------------
create table if not exists public.motion9_members (
  user_id       uuid         primary key references auth.users (id) on delete restrict,
  display_name  varchar(100) not null check (char_length(btrim(display_name)) between 1 and 100),
  role          text         not null default 'admin' check (role in ('owner', 'admin')),
  status        text         not null default 'pending'
                check (status in ('pending', 'active', 'suspended', 'rejected')),
  created_at    timestamptz  not null default now(),
  updated_at    timestamptz  not null default now(),
  approved_at   timestamptz  null,
  approved_by   uuid         null references public.motion9_members (user_id) on delete restrict
);
create index if not exists ix_motion9_members_status on public.motion9_members (status);

-- ----------------------------------------------------------------------------
-- 2. 테이블: private.motion9_settings (단일 설정행, 정원 3~5)
-- ----------------------------------------------------------------------------
create table if not exists private.motion9_settings (
  id                 smallint    primary key check (id = 1),
  max_active_admins  smallint    not null default 5 check (max_active_admins between 3 and 5),
  updated_at         timestamptz not null default now(),
  updated_by         uuid        null references public.motion9_members (user_id) on delete restrict
);

-- ----------------------------------------------------------------------------
-- 3. 테이블: private.motion9_daily_counters (KST 날짜별 마지막 일련번호)
-- ----------------------------------------------------------------------------
create table if not exists private.motion9_daily_counters (
  number_date date    primary key,
  last_value  integer not null check (last_value between 1 and 99999)
);

-- ----------------------------------------------------------------------------
-- 4. 테이블: public.motion9_orders (발주 원본 + 계산 확정 + 추적)
--    기획 §6.3, §6.4, §6.6. 계산 필드는 RPC 내부에서만 설정.
-- ----------------------------------------------------------------------------
create table if not exists public.motion9_orders (
  -- 식별
  id               uuid         primary key default gen_random_uuid(),
  order_no         varchar(14)  not null unique check (order_no ~ '^[0-9]{8}-[0-9]{5}$'),
  number_date      date         not null references private.motion9_daily_counters (number_date) on delete restrict,
  daily_sequence   integer      not null check (daily_sequence between 1 and 99999),
  -- 입력
  client_name      varchar(100) not null check (char_length(btrim(client_name)) between 1 and 100),
  orderer_name     varchar(100) not null check (char_length(btrim(orderer_name)) between 1 and 100),
  orderer_phone    varchar(20)  not null check (orderer_phone ~ '^01[0-9]-?[0-9]{3,4}-?[0-9]{4}$'),
  orderer_email    varchar(200) null check (orderer_email is null
    or (char_length(orderer_email) <= 200 and orderer_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  product_name     varchar(200) not null check (char_length(btrim(product_name)) between 1 and 200),
  product_code     varchar(100) not null check (char_length(btrim(product_code)) between 1 and 100),
  option_text      varchar(500) null check (option_text is null or char_length(option_text) <= 500),
  quantity         integer      not null check (quantity between 1 and 1000000),
  moq              integer      null check (moq is null or (moq between 1 and 1000000)),
  unit_price       numeric(12,0) not null check (unit_price >= 0 and unit_price <= 1000000000),
  vat_exclusive    boolean      not null default false,
  vat_rate         numeric(5,4) not null default 0.1000 check (vat_rate = 0.1000),
  shipping_fee     numeric(12,0) not null default 3000 check (shipping_fee >= 0 and shipping_fee <= 1000000000),
  shipping_included boolean     not null default true,
  shipping_stage   smallint     not null default 1 check (shipping_stage in (1, 2, 3, 9)),
  ordered_at       timestamptz  not null default now(),
  calculation_version smallint  not null default 1 check (calculation_version = 1),
  -- 계산 확정 (DB 내부 전용)
  product_input_amount   numeric(18,0) not null check (product_input_amount >= 0),
  product_supply_amount  numeric(18,0) not null check (product_supply_amount >= 0),
  product_vat_amount     numeric(18,0) not null check (product_vat_amount >= 0),
  shipping_charge_amount numeric(18,0) not null check (shipping_charge_amount >= 0),
  shipping_supply_amount numeric(18,0) not null check (shipping_supply_amount >= 0),
  shipping_vat_amount    numeric(18,0) not null check (shipping_vat_amount >= 0),
  supply_amount    numeric(18,0) not null check (supply_amount >= 0),
  vat_amount       numeric(18,0) not null check (vat_amount >= 0),
  total_amount     numeric(18,0) not null check (total_amount >= 0),
  -- 추적
  created_at       timestamptz  not null default now(),
  created_by       uuid         not null references public.motion9_members (user_id) on delete restrict,
  created_by_name  varchar(100) not null,
  updated_at       timestamptz  not null default now(),
  updated_by       uuid         not null references public.motion9_members (user_id) on delete restrict,
  updated_by_name  varchar(100) not null,
  version          integer      not null default 1 check (version >= 1),
  client_request_id uuid       not null,
  deleted_at       timestamptz  null,
  deleted_by       uuid         null references public.motion9_members (user_id) on delete restrict,
  delete_reason    varchar(500) null,
  -- 복합 규칙
  unique (number_date, daily_sequence),
  unique (created_by, client_request_id),
  check (moq is null or quantity >= moq),
  check (order_no = to_char(number_date, 'YYYYMMDD') || '-' || lpad(daily_sequence::text, 5, '0')),
  check (supply_amount = product_supply_amount + shipping_supply_amount),
  check (vat_amount = product_vat_amount + shipping_vat_amount),
  check (total_amount = supply_amount + vat_amount),
  check (shipping_charge_amount = shipping_supply_amount + shipping_vat_amount),
  check ((shipping_included and shipping_charge_amount = 0
          and shipping_supply_amount = 0 and shipping_vat_amount = 0)
         or (not shipping_included)),
  check ((deleted_at is null and deleted_by is null and delete_reason is null)
         or (deleted_at is not null and deleted_by is not null
             and char_length(btrim(delete_reason)) between 1 and 500))
);

-- 목록·필터 인덱스 (§6.6)
create index if not exists ix_motion9_orders_list
  on public.motion9_orders (ordered_at desc, id desc) where deleted_at is null;
create index if not exists ix_motion9_orders_stage
  on public.motion9_orders (shipping_stage, ordered_at desc, id desc) where deleted_at is null;
-- 부분일치 검색용 trigram (데이터 증가 대비, §6.6)
create index if not exists ix_motion9_orders_client_trgm
  on public.motion9_orders using gin (client_name gin_trgm_ops);
create index if not exists ix_motion9_orders_product_trgm
  on public.motion9_orders using gin (product_name gin_trgm_ops);
create index if not exists ix_motion9_orders_code_trgm
  on public.motion9_orders using gin (product_code gin_trgm_ops);
create index if not exists ix_motion9_orders_no_trgm
  on public.motion9_orders using gin (order_no gin_trgm_ops);
create index if not exists ix_motion9_orders_orderer_trgm
  on public.motion9_orders using gin (orderer_name gin_trgm_ops);
create index if not exists ix_motion9_orders_phone_trgm
  on public.motion9_orders using gin (orderer_phone gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- 5. 테이블: public.motion9_order_audit_logs (발주 이력, 앱 수정·삭제 불가)
-- ----------------------------------------------------------------------------
create table if not exists public.motion9_order_audit_logs (
  id          bigint      generated always as identity primary key,
  order_id    uuid        not null references public.motion9_orders (id) on delete restrict,
  action      text        not null check (action in ('create', 'update', 'stage_change', 'delete', 'restore')),
  before_data jsonb       null,
  after_data  jsonb       null,
  reason      varchar(500) null check (reason is null or char_length(reason) <= 500),
  actor_id    uuid        not null references public.motion9_members (user_id) on delete restrict,
  actor_name  varchar(100) not null,
  created_at  timestamptz not null default now()
);
create index if not exists ix_motion9_oalog_order
  on public.motion9_order_audit_logs (order_id, created_at desc, id desc);
create index if not exists ix_motion9_oalog_actor
  on public.motion9_order_audit_logs (actor_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 6. 테이블: private.motion9_admin_audit_logs (관리자 변경 이력)
-- ----------------------------------------------------------------------------
create table if not exists private.motion9_admin_audit_logs (
  id             bigint      generated always as identity primary key,
  target_user_id uuid        null references public.motion9_members (user_id) on delete restrict,
  action         text        not null check (action in
    ('bootstrap', 'approve', 'suspend', 'reactivate', 'reject', 'change_role', 'change_limit')),
  before_data    jsonb       null,
  after_data     jsonb       null,
  actor_id       uuid        null references public.motion9_members (user_id) on delete restrict,
  created_at     timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 7. 내부 헬퍼 함수 (private, 직접 호출 차단 — 아래 12절에서 EXECUTE 회수)
-- ----------------------------------------------------------------------------

-- 7-1. 활성 관리자 여부 (RLS 정책용, 재귀 방지: DEFINER로 RLS 우회 읽기)
create or replace function private.motion9_is_active_admin()
returns boolean language sql stable security definer set search_path = public, private, extensions as $$
  select exists (
    select 1 from public.motion9_members m
    where m.user_id = auth.uid() and m.status = 'active'
  );
$$;

-- 7-2. 활성 owner 여부
create or replace function private.motion9_is_owner()
returns boolean language sql stable security definer set search_path = public, private, extensions as $$
  select exists (
    select 1 from public.motion9_members m
    where m.user_id = auth.uid() and m.status = 'active' and m.role = 'owner'
  );
$$;

-- 7-3. 금액 계산 (§7.1). DB 확정값의 유일한 계산식.
create or replace function private.motion9_calc(
  p_qty int, p_price numeric, p_vat_excl boolean, p_fee numeric, p_incl boolean,
  out o_input numeric, out o_p_supply numeric, out o_p_vat numeric,
  out o_f_charge numeric, out o_f_supply numeric, out o_f_vat numeric,
  out o_supply numeric, out o_vat numeric, out o_total numeric
) language plpgsql immutable as $$
begin
  o_input := p_qty::numeric * p_price;
  if p_vat_excl then
    o_p_supply := o_input;
    o_p_vat    := round(o_input * 0.10);
  else
    o_p_supply := round(o_input / 1.1);
    o_p_vat    := o_input - o_p_supply;
  end if;
  if p_incl then
    o_f_charge := 0; o_f_supply := 0; o_f_vat := 0;
  else
    o_f_charge := p_fee;
    o_f_supply := round(p_fee / 1.1);
    o_f_vat    := p_fee - o_f_supply;
  end if;
  o_supply := o_p_supply + o_f_supply;
  o_vat    := o_p_vat + o_f_vat;
  o_total  := o_supply + o_vat;
end $$;

-- 7-4. LIKE 특수문자 escape (% _ \)
create or replace function private.motion9_escape_like(p text)
returns text language sql immutable as $$
  select replace(replace(replace(coalesce(p, ''), '\', '\\'), '%', '\%'), '_', '\_');
$$;

-- 7-5. updated_at 자동 갱신 트리거
create or replace function private.motion9_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_motion9_members_touch on public.motion9_members;
create trigger trg_motion9_members_touch
  before update on public.motion9_members
  for each row execute function private.motion9_touch_updated_at();

-- 7-6. Auth 사용자 생성 → pending 멤버 자동 생성 (가입 메타데이터 신뢰 금지, §4.2)
create or replace function private.motion9_handle_new_user()
returns trigger language plpgsql security definer set search_path = public, private, extensions as $$
declare
  v_name text;
begin
  v_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
  if v_name is null then
    v_name := '관리자-' || substr(new.id::text, 1, 8);
  end if;
  insert into public.motion9_members (user_id, display_name, role, status)
  values (new.id, v_name, 'admin', 'pending')
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists trg_motion9_new_user on auth.users;
create trigger trg_motion9_new_user
  after insert on auth.users
  for each row execute function private.motion9_handle_new_user();

-- ----------------------------------------------------------------------------
-- 8. RLS (공개 스키마 3종 + private 전체). 직접 쓰기는 RPC로만.
-- ----------------------------------------------------------------------------
alter table public.motion9_members enable row level security;
alter table public.motion9_orders enable row level security;
alter table public.motion9_order_audit_logs enable row level security;
alter table private.motion9_settings enable row level security;
alter table private.motion9_daily_counters enable row level security;
alter table private.motion9_admin_audit_logs enable row level security;

-- members: 본인 상태 조회 or 활성 owner의 관리 조회. 직접 INSERT/UPDATE/DELETE 정책 없음.
drop policy if exists motion9_members_select on public.motion9_members;
create policy motion9_members_select on public.motion9_members
  for select to authenticated
  using (user_id = auth.uid() or private.motion9_is_owner());

-- orders: 활성 관리자 + 미삭제. 삭제건은 활성 owner만.
drop policy if exists motion9_orders_select on public.motion9_orders;
create policy motion9_orders_select on public.motion9_orders
  for select to authenticated
  using (private.motion9_is_active_admin()
         and (deleted_at is null or private.motion9_is_owner()));
-- (INSERT/UPDATE/DELETE 정책 없음 → 브라우저 직접 쓰기 차단)

-- order audit: 활성 관리자이며 해당 발주 조회 가능. (발주 가시성은 orders 정책과 동일 조건)
drop policy if exists motion9_oalog_select on public.motion9_order_audit_logs;
create policy motion9_oalog_select on public.motion9_order_audit_logs
  for select to authenticated
  using (
    private.motion9_is_active_admin()
    and exists (
      select 1 from public.motion9_orders o
      where o.id = public.motion9_order_audit_logs.order_id
        and (o.deleted_at is null or private.motion9_is_owner())
    )
  );
-- (INSERT/UPDATE/DELETE 정책 없음 → 트리거·RPC 내부(소유자 권한)만 기록)

-- private 3종: 정책 없음 → 브라우저 직접 접근 전면 차단 (RPC 소유자 권한만 접근)

-- ----------------------------------------------------------------------------
-- 9. 공개 RPC
-- ----------------------------------------------------------------------------

-- 9-1. 내 접근 상태 (본인 UUID·상태만)
create or replace function public.motion9_get_my_access()
returns table (user_id uuid, display_name varchar(100), role text, status text)
language sql stable security invoker set search_path = public, private, extensions as $$
  select m.user_id, m.display_name, m.role, m.status
  from public.motion9_members m
  where m.user_id = auth.uid();
$$;

-- 9-2. 서버 시각 (인증 사용자용, KST 포함)
create or replace function public.motion9_get_server_time()
returns table (now_utc timestamptz, now_kst timestamptz, kst_date date, kst_input text)
language plpgsql stable security invoker set search_path = public, private, extensions as $$
begin
  if auth.uid() is null then
    raise exception 'ACCESS_DENIED';
  end if;
  return query select
    now(),
    (now() at time zone 'Asia/Seoul')::timestamptz,
    ((now() at time zone 'Asia/Seoul'))::date,
    to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI');
end $$;

-- 9-3. 목록·검색 (INVOKER + RLS, size 최대 50, 정렬 고정)
create or replace function public.motion9_search_orders(
  p_q text, p_from date, p_to date, p_stage smallint, p_page int, p_size int
)
returns setof public.motion9_orders
language plpgsql stable security invoker set search_path = public, private, extensions as $$
declare
  v_size int := least(greatest(coalesce(p_size, 20), 1), 50);
  v_page int := greatest(coalesce(p_page, 1), 1);
  v_gte  timestamptz;
  v_lt   timestamptz;
  v_pat  text;
begin
  if auth.uid() is null then
    raise exception 'ACCESS_DENIED';
  end if;
  if p_stage is not null and p_stage not in (1, 2, 3, 9) then
    raise exception 'VALIDATION_ERROR: 발송단계가 올바르지 않습니다.';
  end if;
  -- KST 날짜 경계: 시작일 00:00+09 이상, 종료일+1일 00:00+09 미만
  if p_to is not null then
    v_lt := ((p_to + 1) || ' 00:00:00+09')::timestamptz;
  end if;
  if p_from is not null then
    v_gte := ((p_from) || ' 00:00:00+09')::timestamptz;
  end if;
  if nullif(btrim(coalesce(p_q, '')), '') is not null then
    v_pat := '%' || private.motion9_escape_like(btrim(p_q)) || '%';
  end if;
  return query
  select o.* from public.motion9_orders o
  where (v_gte is null or o.ordered_at >= v_gte)
    and (v_lt is null or o.ordered_at < v_lt)
    and (p_stage is null or o.shipping_stage = p_stage)
    and (v_pat is null or o.client_name ilike v_pat escape '\'
       or o.orderer_name ilike v_pat escape '\'
       or o.orderer_phone ilike v_pat escape '\'
       or o.product_name ilike v_pat escape '\'
       or o.product_code ilike v_pat escape '\'
       or o.order_no ilike v_pat escape '\')
  order by o.ordered_at desc, o.id desc
  limit v_size offset (v_page - 1) * v_size;
end $$;

-- 9-4. 단계별 건수 (검색어·기간 적용, 단계 필터 제외 — §5.2)
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
  where (v_gte is null or o.ordered_at >= v_gte)
    and (v_lt is null or o.ordered_at < v_lt)
    and (v_pat is null or o.client_name ilike v_pat escape '\'
       or o.orderer_name ilike v_pat escape '\'
       or o.orderer_phone ilike v_pat escape '\'
       or o.product_name ilike v_pat escape '\'
       or o.product_code ilike v_pat escape '\'
       or o.order_no ilike v_pat escape '\')
  group by o.shipping_stage;
end $$;

-- 9-5. 등록 (§8.1 의사코드 그대로: 잠금→중복검사→시각확정→카운터→계산→INSERT→감사)
create or replace function public.motion9_create_order(
  p_client_name text, p_orderer_name text, p_orderer_phone text, p_orderer_email text,
  p_product_name text, p_product_code text, p_option_text text,
  p_quantity int, p_moq int, p_unit_price numeric,
  p_vat_exclusive boolean, p_shipping_fee numeric, p_shipping_included boolean,
  p_shipping_stage smallint, p_ordered_at timestamptz, p_request_id uuid
)
returns public.motion9_orders
language plpgsql security definer set search_path = public, private, extensions as $$
declare
  v_uid   uuid := auth.uid();
  v_now   timestamptz;
  v_kdate date;
  v_ord   timestamptz;
  v_seq   int;
  v_no    varchar(14);
  v_actor varchar(100);
  v_c text; v_pn text; v_pc text; v_opt text;
  v_on text; v_op text; v_oe text;
  v_in numeric; v_ps numeric; v_pv numeric; v_fc numeric; v_fs numeric; v_fv numeric;
  v_s numeric; v_v numeric; v_t numeric;
  v_row public.motion9_orders%rowtype;
  v_dup public.motion9_orders%rowtype;
begin
  if v_uid is null or not private.motion9_is_active_admin() then
    raise exception 'ACCESS_DENIED';
  end if;
  if p_request_id is null then
    raise exception 'VALIDATION_ERROR: 요청 ID가 필요합니다.';
  end if;
  -- 입력 검증 (DB가 최종 판정)
  v_c  := btrim(coalesce(p_client_name, ''));
  v_pn := btrim(coalesce(p_product_name, ''));
  v_pc := btrim(coalesce(p_product_code, ''));
  v_opt := nullif(btrim(coalesce(p_option_text, '')), '');
  v_on := btrim(coalesce(p_orderer_name, ''));
  v_op := btrim(coalesce(p_orderer_phone, ''));
  v_oe := nullif(btrim(coalesce(p_orderer_email, '')), '');
  if char_length(v_c) not between 1 and 100 then raise exception 'VALIDATION_ERROR: 거래처명을 입력하세요.'; end if;
  if char_length(v_on) not between 1 and 100 then raise exception 'VALIDATION_ERROR: 주문자를 입력하세요.'; end if;
  if v_op !~ '^01[0-9]-?[0-9]{3,4}-?[0-9]{4}$' then raise exception 'VALIDATION_ERROR: 휴대폰 번호 형식을 확인하세요. (예: 010-1234-5678)'; end if;
  if v_oe is not null and (char_length(v_oe) > 200 or v_oe !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'VALIDATION_ERROR: 이메일 형식을 확인하세요.'; end if;
  if char_length(v_pn) not between 1 and 200 then raise exception 'VALIDATION_ERROR: 제품명을 입력하세요.'; end if;
  if char_length(v_pc) not between 1 and 100 then raise exception 'VALIDATION_ERROR: 제품코드를 입력하세요.'; end if;
  if v_opt is not null and char_length(v_opt) > 500 then raise exception 'VALIDATION_ERROR: 옵션이 500자를 초과했습니다.'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 1000000 then raise exception 'VALIDATION_ERROR: 수량은 1~1,000,000 정수입니다.'; end if;
  if p_moq is not null and (p_moq < 1 or p_moq > 1000000) then raise exception 'VALIDATION_ERROR: MOQ 범위를 확인하세요.'; end if;
  if p_moq is not null and p_quantity < p_moq then raise exception 'MOQ_NOT_MET: 수량이 MOQ보다 적습니다.'; end if;
  if p_unit_price is null or p_unit_price < 0 or p_unit_price > 1000000000 then raise exception 'VALIDATION_ERROR: 단금 범위를 확인하세요.'; end if;
  if p_shipping_fee is null or p_shipping_fee < 0 or p_shipping_fee > 1000000000 then raise exception 'VALIDATION_ERROR: 배송비 범위를 확인하세요.'; end if;
  if p_shipping_stage is null or p_shipping_stage not in (1, 2, 3, 9) then raise exception 'VALIDATION_ERROR: 발송단계가 올바르지 않습니다.'; end if;

  -- (uid, request_id) 트랜잭션 잠금 — 연타·재전송 직렬화
  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':' || p_request_id::text)::bigint);

  -- 중복 요청 검사: 같은 내용 재시도면 기존 반환, 다른 내용이면 충돌
  select * into v_dup from public.motion9_orders o
  where o.created_by = v_uid and o.client_request_id = p_request_id;
  if found then
    if v_dup.client_name is not distinct from v_c
       and v_dup.orderer_name is not distinct from v_on
       and v_dup.orderer_phone is not distinct from v_op
       and v_dup.orderer_email is not distinct from v_oe
       and v_dup.product_name is not distinct from v_pn
       and v_dup.product_code is not distinct from v_pc
       and v_dup.option_text is not distinct from v_opt
       and v_dup.quantity is not distinct from p_quantity
       and v_dup.moq is not distinct from p_moq
       and v_dup.unit_price is not distinct from p_unit_price
       and v_dup.vat_exclusive is not distinct from coalesce(p_vat_exclusive, false)
       and v_dup.shipping_fee is not distinct from p_shipping_fee
       and v_dup.shipping_included is not distinct from coalesce(p_shipping_included, true)
       and v_dup.shipping_stage is not distinct from p_shipping_stage then
      return v_dup;
    else
      raise exception 'REQUEST_ID_CONFLICT: 이미 사용된 요청입니다. 입력 변경 후 새 요청으로 저장하세요.';
    end if;
  end if;

  v_now := clock_timestamp();
  v_kdate := (v_now at time zone 'Asia/Seoul')::date;
  v_ord := coalesce(p_ordered_at, v_now);

  -- 일자 카운터 UPSERT (행 잠금 직렬화)
  insert into private.motion9_daily_counters (number_date, last_value)
  values (v_kdate, 1)
  on conflict (number_date) do update set last_value = private.motion9_daily_counters.last_value + 1
  returning last_value into v_seq;
  if v_seq < 1 or v_seq > 99999 then
    raise exception 'DAILY_SEQUENCE_EXHAUSTED: 오늘 발주번호가 소진되었습니다.';
  end if;
  v_no := to_char(v_kdate, 'YYYYMMDD') || '-' || lpad(v_seq::text, 5, '0');

  -- 금액 확정 (DB 계산이 정답)
  select * into v_in, v_ps, v_pv, v_fc, v_fs, v_fv, v_s, v_v, v_t
  from private.motion9_calc(p_quantity, p_unit_price,
    coalesce(p_vat_exclusive, false), p_shipping_fee, coalesce(p_shipping_included, true));

  select m.display_name into v_actor from public.motion9_members m where m.user_id = v_uid;

  insert into public.motion9_orders (
    order_no, number_date, daily_sequence,
    client_name, orderer_name, orderer_phone, orderer_email,
    product_name, product_code, option_text,
    quantity, moq, unit_price, vat_exclusive, vat_rate,
    shipping_fee, shipping_included, shipping_stage, ordered_at, calculation_version,
    product_input_amount, product_supply_amount, product_vat_amount,
    shipping_charge_amount, shipping_supply_amount, shipping_vat_amount,
    supply_amount, vat_amount, total_amount,
    created_at, created_by, created_by_name, updated_at, updated_by, updated_by_name,
    version, client_request_id
  ) values (
    v_no, v_kdate, v_seq,
    v_c, v_on, v_op, v_oe, v_pn, v_pc, v_opt,
    p_quantity, p_moq, p_unit_price, coalesce(p_vat_exclusive, false), 0.1000,
    p_shipping_fee, coalesce(p_shipping_included, true), p_shipping_stage, v_ord, 1,
    v_in, v_ps, v_pv, v_fc, v_fs, v_fv, v_s, v_v, v_t,
    v_now, v_uid, v_actor, v_now, v_uid, v_actor,
    1, p_request_id
  ) returning * into v_row;

  insert into public.motion9_order_audit_logs
    (order_id, action, before_data, after_data, reason, actor_id, actor_name)
  values (v_row.id, 'create', null, to_jsonb(v_row), null, v_uid, v_actor);

  return v_row;
end $$;

-- 9-6. 수정 (id + version 원자 UPDATE, 감사 create/update/stage_change)
create or replace function public.motion9_update_order(
  p_id uuid, p_version int,
  p_client_name text, p_orderer_name text, p_orderer_phone text, p_orderer_email text,
  p_product_name text, p_product_code text, p_option_text text,
  p_quantity int, p_moq int, p_unit_price numeric,
  p_vat_exclusive boolean, p_shipping_fee numeric, p_shipping_included boolean,
  p_shipping_stage smallint, p_ordered_at timestamptz, p_reason text
)
returns public.motion9_orders
language plpgsql security definer set search_path = public, private, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_old public.motion9_orders%rowtype;
  v_new public.motion9_orders%rowtype;
  v_actor varchar(100);
  v_c text; v_pn text; v_pc text; v_opt text; v_rsn text;
  v_on text; v_op text; v_oe text;
  v_in numeric; v_ps numeric; v_pv numeric; v_fc numeric; v_fs numeric; v_fv numeric;
  v_s numeric; v_v numeric; v_t numeric;
  v_act text := 'update';
  v_amt_changed boolean;
begin
  if v_uid is null or not private.motion9_is_active_admin() then
    raise exception 'ACCESS_DENIED';
  end if;
  select * into v_old from public.motion9_orders o where o.id = p_id for update;
  if not found or (v_old.deleted_at is not null and not private.motion9_is_owner()) then
    raise exception 'ORDER_NOT_FOUND: 발주를 찾을 수 없습니다.';
  end if;
  if v_old.deleted_at is not null then
    raise exception 'VALIDATION_ERROR: 삭제된 발주는 수정할 수 없습니다. 복원 후 수정하세요.';
  end if;
  if v_old.version is distinct from p_version then
    raise exception 'VERSION_CONFLICT: 다른 관리자가 먼저 수정했습니다. 새 데이터를 불러오세요.';
  end if;

  v_c  := btrim(coalesce(p_client_name, ''));
  v_pn := btrim(coalesce(p_product_name, ''));
  v_pc := btrim(coalesce(p_product_code, ''));
  v_opt := nullif(btrim(coalesce(p_option_text, '')), '');
  v_rsn := nullif(btrim(coalesce(p_reason, '')), '');
  v_on := btrim(coalesce(p_orderer_name, ''));
  v_op := btrim(coalesce(p_orderer_phone, ''));
  v_oe := nullif(btrim(coalesce(p_orderer_email, '')), '');
  if char_length(v_c) not between 1 and 100 then raise exception 'VALIDATION_ERROR: 거래처명을 입력하세요.'; end if;
  if char_length(v_on) not between 1 and 100 then raise exception 'VALIDATION_ERROR: 주문자를 입력하세요.'; end if;
  if v_op !~ '^01[0-9]-?[0-9]{3,4}-?[0-9]{4}$' then raise exception 'VALIDATION_ERROR: 휴대폰 번호 형식을 확인하세요. (예: 010-1234-5678)'; end if;
  if v_oe is not null and (char_length(v_oe) > 200 or v_oe !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'VALIDATION_ERROR: 이메일 형식을 확인하세요.'; end if;
  if char_length(v_pn) not between 1 and 200 then raise exception 'VALIDATION_ERROR: 제품명을 입력하세요.'; end if;
  if char_length(v_pc) not between 1 and 100 then raise exception 'VALIDATION_ERROR: 제품코드를 입력하세요.'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 1000000 then raise exception 'VALIDATION_ERROR: 수량은 1~1,000,000 정수입니다.'; end if;
  if p_moq is not null and (p_moq < 1 or p_moq > 1000000) then raise exception 'VALIDATION_ERROR: MOQ 범위를 확인하세요.'; end if;
  if p_moq is not null and p_quantity < p_moq then raise exception 'MOQ_NOT_MET: 수량이 MOQ보다 적습니다.'; end if;
  if p_unit_price is null or p_unit_price < 0 or p_unit_price > 1000000000 then raise exception 'VALIDATION_ERROR: 단가 범위를 확인하세요.'; end if;
  if p_shipping_fee is null or p_shipping_fee < 0 or p_shipping_fee > 1000000000 then raise exception 'VALIDATION_ERROR: 배송비 범위를 확인하세요.'; end if;
  if p_shipping_stage is null or p_shipping_stage not in (1, 2, 3, 9) then raise exception 'VALIDATION_ERROR: 발송단계가 올바르지 않습니다.'; end if;

  -- 사유 규칙: 역행·건너뛰기·완료(9) 상태에서의 금액 변경은 사유 필수 (§8.3)
  v_amt_changed := (p_quantity is distinct from v_old.quantity
    or p_unit_price is distinct from v_old.unit_price
    or coalesce(p_vat_exclusive, false) is distinct from v_old.vat_exclusive
    or p_shipping_fee is distinct from v_old.shipping_fee
    or coalesce(p_shipping_included, true) is distinct from v_old.shipping_included);
  if (p_shipping_stage is distinct from v_old.shipping_stage
      and (v_old.shipping_stage, p_shipping_stage) not in ((1, 2), (2, 3), (3, 9)))
     or (v_old.shipping_stage = 9 and v_amt_changed) then
    if v_rsn is null then
      raise exception 'VALIDATION_ERROR: 단계 역행·건너뛰기 또는 완료 후 금액 변경에는 사유가 필요합니다.';
    end if;
  end if;

  select * into v_in, v_ps, v_pv, v_fc, v_fs, v_fv, v_s, v_v, v_t
  from private.motion9_calc(p_quantity, p_unit_price,
    coalesce(p_vat_exclusive, false), p_shipping_fee, coalesce(p_shipping_included, true));
  select m.display_name into v_actor from public.motion9_members m where m.user_id = v_uid;

  -- 단계만 변경됐으면 stage_change, 그 외는 update
  if p_shipping_stage is distinct from v_old.shipping_stage
     and v_c = v_old.client_name
     and v_on = v_old.orderer_name and v_op = v_old.orderer_phone
     and coalesce(v_oe, '') = coalesce(v_old.orderer_email, '')
     and v_pn = v_old.product_name and v_pc = v_old.product_code
     and coalesce(v_opt, '') = coalesce(v_old.option_text, '')
     and p_quantity = v_old.quantity and coalesce(p_moq, -1) = coalesce(v_old.moq, -1)
     and p_unit_price = v_old.unit_price
     and coalesce(p_vat_exclusive, false) = v_old.vat_exclusive
     and p_shipping_fee = v_old.shipping_fee
     and coalesce(p_shipping_included, true) = v_old.shipping_included then
    v_act := 'stage_change';
  end if;

  update public.motion9_orders o set
    client_name = v_c, orderer_name = v_on, orderer_phone = v_op, orderer_email = v_oe,
    product_name = v_pn, product_code = v_pc, option_text = v_opt,
    quantity = p_quantity, moq = p_moq, unit_price = p_unit_price,
    vat_exclusive = coalesce(p_vat_exclusive, false),
    shipping_fee = p_shipping_fee, shipping_included = coalesce(p_shipping_included, true),
    shipping_stage = p_shipping_stage,
    ordered_at = coalesce(p_ordered_at, v_old.ordered_at),
    product_input_amount = v_in, product_supply_amount = v_ps, product_vat_amount = v_pv,
    shipping_charge_amount = v_fc, shipping_supply_amount = v_fs, shipping_vat_amount = v_fv,
    supply_amount = v_s, vat_amount = v_v, total_amount = v_t,
    updated_at = v_now, updated_by = v_uid, updated_by_name = v_actor,
    version = v_old.version + 1
  where o.id = p_id and o.version = p_version
  returning * into v_new;
  if not found then
    raise exception 'VERSION_CONFLICT: 다른 관리자가 먼저 수정했습니다. 새 데이터를 불러오세요.';
  end if;

  insert into public.motion9_order_audit_logs
    (order_id, action, before_data, after_data, reason, actor_id, actor_name)
  values (p_id, v_act, to_jsonb(v_old), to_jsonb(v_new), v_rsn, v_uid, v_actor);

  return v_new;
end $$;

-- 9-7. 단계 변경 전용 (사유 규칙: 정방향 인접(1→2→3→9) 외에는 사유 필수)
create or replace function public.motion9_change_stage(
  p_id uuid, p_version int, p_stage smallint, p_reason text
)
returns public.motion9_orders
language plpgsql security definer set search_path = public, private, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_old public.motion9_orders%rowtype;
  v_new public.motion9_orders%rowtype;
  v_actor varchar(100);
  v_rsn text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null or not private.motion9_is_active_admin() then
    raise exception 'ACCESS_DENIED';
  end if;
  if p_stage is null or p_stage not in (1, 2, 3, 9) then
    raise exception 'VALIDATION_ERROR: 발송단계가 올바르지 않습니다.';
  end if;
  select * into v_old from public.motion9_orders o where o.id = p_id for update;
  if not found or (v_old.deleted_at is not null and not private.motion9_is_owner()) then
    raise exception 'ORDER_NOT_FOUND: 발주를 찾을 수 없습니다.';
  end if;
  if v_old.deleted_at is not null then
    raise exception 'VALIDATION_ERROR: 삭제된 발주입니다.';
  end if;
  if v_old.version is distinct from p_version then
    raise exception 'VERSION_CONFLICT: 다른 관리자가 먼저 수정했습니다. 새 데이터를 불러오세요.';
  end if;
  if p_stage is distinct from v_old.shipping_stage
     and (v_old.shipping_stage, p_stage) not in ((1, 2), (2, 3), (3, 9))
     and v_rsn is null then
    raise exception 'VALIDATION_ERROR: 단계 역행·건너뛰기에는 사유가 필요합니다.';
  end if;
  select m.display_name into v_actor from public.motion9_members m where m.user_id = v_uid;

  update public.motion9_orders o set
    shipping_stage = p_stage,
    updated_at = v_now, updated_by = v_uid, updated_by_name = v_actor,
    version = v_old.version + 1
  where o.id = p_id and o.version = p_version
  returning * into v_new;
  if not found then
    raise exception 'VERSION_CONFLICT: 다른 관리자가 먼저 수정했습니다. 새 데이터를 불러오세요.';
  end if;

  insert into public.motion9_order_audit_logs
    (order_id, action, before_data, after_data, reason, actor_id, actor_name)
  values (p_id, 'stage_change', to_jsonb(v_old), to_jsonb(v_new), v_rsn, v_uid, v_actor);
  return v_new;
end $$;

-- 9-8. 논리 삭제 (사유 필수, 반복 삭제는 기존 행 반환 — 멱등)
create or replace function public.motion9_delete_order(p_id uuid, p_version int, p_reason text)
returns public.motion9_orders
language plpgsql security definer set search_path = public, private, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_old public.motion9_orders%rowtype;
  v_new public.motion9_orders%rowtype;
  v_actor varchar(100);
  v_rsn text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null or not private.motion9_is_active_admin() then
    raise exception 'ACCESS_DENIED';
  end if;
  if v_rsn is null or char_length(v_rsn) > 500 then
    raise exception 'VALIDATION_ERROR: 삭제 사유를 입력하세요.';
  end if;
  select * into v_old from public.motion9_orders o where o.id = p_id for update;
  if not found or (v_old.deleted_at is not null and not private.motion9_is_owner()) then
    raise exception 'ORDER_NOT_FOUND: 발주를 찾을 수 없습니다.';
  end if;
  if v_old.deleted_at is not null then
    return v_old; -- 이미 삭제됨: 멱등 반환 (추가 감사 없음)
  end if;
  if v_old.version is distinct from p_version then
    raise exception 'VERSION_CONFLICT: 다른 관리자가 먼저 수정했습니다. 새 데이터를 불러오세요.';
  end if;
  select m.display_name into v_actor from public.motion9_members m where m.user_id = v_uid;

  update public.motion9_orders o set
    deleted_at = v_now, deleted_by = v_uid, delete_reason = v_rsn,
    updated_at = v_now, updated_by = v_uid, updated_by_name = v_actor,
    version = v_old.version + 1
  where o.id = p_id and o.version = p_version
  returning * into v_new;
  if not found then
    raise exception 'VERSION_CONFLICT: 다른 관리자가 먼저 수정했습니다. 새 데이터를 불러오세요.';
  end if;

  insert into public.motion9_order_audit_logs
    (order_id, action, before_data, after_data, reason, actor_id, actor_name)
  values (p_id, 'delete', to_jsonb(v_old), to_jsonb(v_new), v_rsn, v_uid, v_actor);
  return v_new;
end $$;

-- 9-9. 복원 (owner 전용, 번호·금액 유지)
create or replace function public.motion9_restore_order(p_id uuid, p_version int)
returns public.motion9_orders
language plpgsql security definer set search_path = public, private, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_old public.motion9_orders%rowtype;
  v_new public.motion9_orders%rowtype;
  v_actor varchar(100);
begin
  if v_uid is null or not private.motion9_is_owner() then
    raise exception 'ACCESS_DENIED: 대표 관리자만 복원할 수 있습니다.';
  end if;
  select * into v_old from public.motion9_orders o where o.id = p_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND: 발주를 찾을 수 없습니다.';
  end if;
  if v_old.deleted_at is null then
    raise exception 'VALIDATION_ERROR: 삭제된 발주가 아닙니다.';
  end if;
  if v_old.version is distinct from p_version then
    raise exception 'VERSION_CONFLICT: 다른 관리자가 먼저 수정했습니다. 새 데이터를 불러오세요.';
  end if;
  select m.display_name into v_actor from public.motion9_members m where m.user_id = v_uid;

  update public.motion9_orders o set
    deleted_at = null, deleted_by = null, delete_reason = null,
    updated_at = v_now, updated_by = v_uid, updated_by_name = v_actor,
    version = v_old.version + 1
  where o.id = p_id and o.version = p_version
  returning * into v_new;
  if not found then
    raise exception 'VERSION_CONFLICT: 다른 관리자가 먼저 수정했습니다. 새 데이터를 불러오세요.';
  end if;

  insert into public.motion9_order_audit_logs
    (order_id, action, before_data, after_data, reason, actor_id, actor_name)
  values (p_id, 'restore', to_jsonb(v_old), to_jsonb(v_new), null, v_uid, v_actor);
  return v_new;
end $$;

-- 9-10. 목록 내보내기 스냅샷 (최대 200건, §10.3)
create or replace function public.motion9_export_orders(
  p_q text, p_from date, p_to date, p_stage smallint,
  p_scope text, p_page int, p_size int
)
returns setof public.motion9_orders
language plpgsql stable security invoker set search_path = public, private, extensions as $$
declare
  v_size int := least(greatest(coalesce(p_size, 20), 1), 50);
  v_page int := greatest(coalesce(p_page, 1), 1);
  v_gte timestamptz; v_lt timestamptz; v_pat text;
begin
  if auth.uid() is null then
    raise exception 'ACCESS_DENIED';
  end if;
  if p_scope is null or p_scope not in ('page', 'all') then
    raise exception 'VALIDATION_ERROR: 내보내기 범위가 올바르지 않습니다.';
  end if;
  if p_from is not null then v_gte := ((p_from) || ' 00:00:00+09')::timestamptz; end if;
  if p_to is not null then v_lt := ((p_to + 1) || ' 00:00:00+09')::timestamptz; end if;
  if nullif(btrim(coalesce(p_q, '')), '') is not null then
    v_pat := '%' || private.motion9_escape_like(btrim(p_q)) || '%';
  end if;
  if p_scope = 'page' then
    return query select o.* from public.motion9_orders o
    where (v_gte is null or o.ordered_at >= v_gte)
      and (v_lt is null or o.ordered_at < v_lt)
      and (p_stage is null or o.shipping_stage = p_stage)
      and (v_pat is null or o.client_name ilike v_pat escape '\'
         or o.orderer_name ilike v_pat escape '\'
         or o.orderer_phone ilike v_pat escape '\'
         or o.product_name ilike v_pat escape '\'
         or o.product_code ilike v_pat escape '\'
         or o.order_no ilike v_pat escape '\')
    order by o.ordered_at desc, o.id desc
    limit v_size offset (v_page - 1) * v_size;
  else
    return query select o.* from public.motion9_orders o
    where (v_gte is null or o.ordered_at >= v_gte)
      and (v_lt is null or o.ordered_at < v_lt)
      and (p_stage is null or o.shipping_stage = p_stage)
      and (v_pat is null or o.client_name ilike v_pat escape '\'
         or o.orderer_name ilike v_pat escape '\'
         or o.orderer_phone ilike v_pat escape '\'
         or o.product_name ilike v_pat escape '\'
         or o.product_code ilike v_pat escape '\'
         or o.order_no ilike v_pat escape '\')
    order by o.ordered_at desc, o.id desc
    limit 200;
  end if;
end $$;

-- 9-11. 관리자 목록 (owner 전용, Auth 최소 정보만)
create or replace function public.motion9_admin_list()
returns table (
  user_id uuid, display_name varchar(100), role text, status text,
  created_at timestamptz, email text, email_confirmed_at timestamptz, last_sign_in_at timestamptz
)
language plpgsql stable security definer set search_path = public, private, extensions as $$
begin
  if auth.uid() is null or not private.motion9_is_owner() then
    raise exception 'ACCESS_DENIED: 대표 관리자만 조회할 수 있습니다.';
  end if;
  return query
  select m.user_id, m.display_name, m.role, m.status, m.created_at,
         u.email::text, u.email_confirmed_at, u.last_sign_in_at
  from public.motion9_members m
  left join auth.users u on u.id = m.user_id
  order by m.created_at, m.user_id;
end $$;

-- 9-12. 관리자 변경 (owner 전용, 설정행 잠금 + 정원 + 마지막 owner 보호 + 감사)
create or replace function public.motion9_manage_member(
  p_target uuid, p_action text, p_role text default null
)
returns public.motion9_members
language plpgsql security definer set search_path = public, private, extensions as $$
declare
  v_uid   uuid := auth.uid();
  v_now   timestamptz := clock_timestamp();
  v_actor varchar(100);
  v_old   public.motion9_members%rowtype;
  v_new   public.motion9_members%rowtype;
  v_max   smallint;
  v_active int;
  v_owners int;
  v_confirmed timestamptz;
begin
  if v_uid is null or not private.motion9_is_owner() then
    raise exception 'ACCESS_DENIED: 대표 관리자만 변경할 수 있습니다.';
  end if;
  if p_action is null or p_action not in
     ('approve', 'suspend', 'reactivate', 'reject', 'change_role') then
    raise exception 'VALIDATION_ERROR: 처리 동작이 올바르지 않습니다.';
  end if;

  -- 설정행 잠금 (동시 승인 정원 유지, §4.2)
  select s.max_active_admins into v_max from private.motion9_settings s where s.id = 1 for update;
  if not found then
    raise exception 'VALIDATION_ERROR: 관리자 설정이 초기화되지 않았습니다.';
  end if;

  select * into v_old from public.motion9_members m where m.user_id = p_target for update;
  if not found then
    raise exception 'VALIDATION_ERROR: 대상 계정을 찾을 수 없습니다.';
  end if;
  if p_target = v_uid and p_action in ('suspend', 'reject') then
    raise exception 'VALIDATION_ERROR: 본인 계정은 직접 중지할 수 없습니다.';
  end if;

  select count(*)::int into v_active from public.motion9_members m where m.status = 'active';
  select count(*)::int into v_owners from public.motion9_members m
  where m.status = 'active' and m.role = 'owner';
  select u.email_confirmed_at into v_confirmed from auth.users u where u.id = p_target;

  if p_action = 'approve' or p_action = 'reactivate' then
    if v_confirmed is null then
      raise exception 'VALIDATION_ERROR: 이메일 인증이 완료되지 않았습니다.';
    end if;
    if v_old.status = 'active' then
      raise exception 'VALIDATION_ERROR: 이미 활성 계정입니다.';
    end if;
    if v_active >= v_max then
      raise exception 'ADMIN_LIMIT_REACHED: 활성 정원(최대 %명)이 찼습니다.', v_max;
    end if;
    update public.motion9_members m set status = 'active',
      approved_at = v_now, approved_by = v_uid
    where m.user_id = p_target returning * into v_new;
  elsif p_action = 'suspend' or p_action = 'reject' then
    if v_old.role = 'owner' and v_old.status = 'active' and v_owners <= 1 then
      raise exception 'LAST_OWNER_REQUIRED: 마지막 대표 관리자는 중지할 수 없습니다.';
    end if;
    update public.motion9_members m set
      status = case when p_action = 'suspend' then 'suspended' else 'rejected' end
    where m.user_id = p_target returning * into v_new;
  elsif p_action = 'change_role' then
    if p_role is null or p_role not in ('owner', 'admin') then
      raise exception 'VALIDATION_ERROR: 역할이 올바르지 않습니다.';
    end if;
    if v_old.role = 'owner' and p_role = 'admin' and v_old.status = 'active' and v_owners <= 1 then
      raise exception 'LAST_OWNER_REQUIRED: 마지막 대표 관리자는 강등할 수 없습니다.';
    end if;
    update public.motion9_members m set role = p_role
    where m.user_id = p_target returning * into v_new;
  end if;

  select m.display_name into v_actor from public.motion9_members m where m.user_id = v_uid;
  insert into private.motion9_admin_audit_logs
    (target_user_id, action, before_data, after_data, actor_id)
  values (p_target, p_action, to_jsonb(v_old), to_jsonb(v_new), v_uid);
  return v_new;
end $$;

-- 9-13. 정원 변경 (owner 전용, 3~5, 활성 이하 축소 금지)
create or replace function public.motion9_update_limit(p_max int)
returns table (max_active_admins smallint, updated_at timestamptz)
language plpgsql security definer set search_path = public, private, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_active int;
  v_old_max smallint;
begin
  if v_uid is null or not private.motion9_is_owner() then
    raise exception 'ACCESS_DENIED: 대표 관리자만 변경할 수 있습니다.';
  end if;
  if p_max is null or p_max < 3 or p_max > 5 then
    raise exception 'VALIDATION_ERROR: 정원은 3~5명 범위에서만 변경할 수 있습니다.';
  end if;
  select count(*)::int into v_active from public.motion9_members m where m.status = 'active';
  if p_max < v_active then
    raise exception 'VALIDATION_ERROR: 현재 활성 %명보다 낮게 줄일 수 없습니다.', v_active;
  end if;
  select s.max_active_admins into v_old_max from private.motion9_settings s where s.id = 1;
  update private.motion9_settings s set max_active_admins = p_max, updated_at = now(), updated_by = v_uid
  where s.id = 1;
  insert into private.motion9_admin_audit_logs (target_user_id, action, before_data, after_data, actor_id)
  values (null, 'change_limit',
    jsonb_build_object('max_active_admins', v_old_max),
    jsonb_build_object('max_active_admins', p_max), v_uid);
  return query select s.max_active_admins, s.updated_at from private.motion9_settings s where s.id = 1;
end $$;

-- 9-14. 최초 owner 초기화 (SQL Editor에서 postgres 권한으로 1회 실행. 앱·anon에 EXECUTE 부여 금지)
create or replace function public.motion9_bootstrap_owner(p_user_id uuid, p_display_name text)
returns public.motion9_members
language plpgsql security definer set search_path = public, private, extensions as $$
declare
  v_row public.motion9_members%rowtype;
  v_name text := nullif(btrim(coalesce(p_display_name, '')), '');
begin
  if exists (select 1 from public.motion9_members m where m.role = 'owner' and m.status = 'active') then
    raise exception 'VALIDATION_ERROR: 이미 대표 관리자가 존재합니다.';
  end if;
  if p_user_id is null then
    raise exception 'VALIDATION_ERROR: Auth UUID가 필요합니다.';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'VALIDATION_ERROR: Auth 사용자를 찾을 수 없습니다.';
  end if;
  if v_name is null then v_name := '대표관리자'; end if;

  insert into private.motion9_settings (id, max_active_admins) values (1, 5)
  on conflict (id) do nothing;

  insert into public.motion9_members (user_id, display_name, role, status, approved_at, approved_by)
  values (p_user_id, v_name, 'owner', 'active', now(), null)
  on conflict (user_id) do update set
    display_name = excluded.display_name, role = 'owner', status = 'active', approved_at = now()
  returning * into v_row;

  insert into private.motion9_admin_audit_logs (target_user_id, action, before_data, after_data, actor_id)
  values (p_user_id, 'bootstrap', null, to_jsonb(v_row), null);
  return v_row;
end $$;

-- ----------------------------------------------------------------------------
-- 10. 초기 데이터: 정원 행
-- ----------------------------------------------------------------------------
insert into private.motion9_settings (id, max_active_admins) values (1, 5)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 11. 권한: 브라우저 직접 쓰기 차단 + RPC만 허용 (§6.7)
-- ----------------------------------------------------------------------------
-- 테이블: authenticated에 SELECT만 (INSERT/UPDATE/DELETE 부여 없음)
grant select on public.motion9_members to authenticated;
grant select on public.motion9_orders to authenticated;
grant select on public.motion9_order_audit_logs to authenticated;
-- private 테이블·함수: 기본 소유자만 (추가 GRANT 없음)

-- 내부 함수: PUBLIC 실행 회수
-- 단, RLS 정책·INVOKER RPC가 호출하는 3종은 authenticated에 EXECUTE 필요
-- (호출 권한 없이 DEFINER라도 실행 불가 → 회수 시 모든 조회가 42501로 막힘).
-- 3종 모두 인자 없는 호출자 판정·순수 문자열 함수라 직접 호출해도 안전.
revoke all on function private.motion9_is_active_admin() from public, anon, authenticated;
revoke all on function private.motion9_is_owner() from public, anon, authenticated;
revoke all on function private.motion9_calc(int, numeric, boolean, numeric, boolean) from public, anon, authenticated;
revoke all on function private.motion9_escape_like(text) from public, anon, authenticated;
revoke all on function private.motion9_touch_updated_at() from public, anon, authenticated;
revoke all on function private.motion9_handle_new_user() from public, anon, authenticated;
grant execute on function private.motion9_is_active_admin() to authenticated;
grant execute on function private.motion9_is_owner() to authenticated;
grant execute on function private.motion9_escape_like(text) to authenticated;
-- INVOKER 함수(escape_like) 호출 시 스키마 해결용. 테이블·미부여 함수 접근은 그대로 차단.
grant usage on schema private to authenticated;

-- 공개 RPC: 기본 PUBLIC EXECUTE 회수 후 authenticated에만 부여
revoke all on function public.motion9_get_my_access() from public, anon, authenticated;
revoke all on function public.motion9_get_server_time() from public, anon, authenticated;
revoke all on function public.motion9_search_orders(text, date, date, smallint, int, int) from public, anon, authenticated;
revoke all on function public.motion9_stage_counts(text, date, date) from public, anon, authenticated;
revoke all on function public.motion9_create_order(text, text, text, text, text, text, text, int, int, numeric, boolean, numeric, boolean, smallint, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.motion9_update_order(uuid, int, text, text, text, text, text, text, text, int, int, numeric, boolean, numeric, boolean, smallint, timestamptz, text) from public, anon, authenticated;
revoke all on function public.motion9_change_stage(uuid, int, smallint, text) from public, anon, authenticated;
revoke all on function public.motion9_delete_order(uuid, int, text) from public, anon, authenticated;
revoke all on function public.motion9_restore_order(uuid, int) from public, anon, authenticated;
revoke all on function public.motion9_export_orders(text, date, date, smallint, text, int, int) from public, anon, authenticated;
revoke all on function public.motion9_admin_list() from public, anon, authenticated;
revoke all on function public.motion9_manage_member(uuid, text, text) from public, anon, authenticated;
revoke all on function public.motion9_update_limit(int) from public, anon, authenticated;
revoke all on function public.motion9_bootstrap_owner(uuid, text) from public, anon, authenticated;

grant execute on function public.motion9_get_my_access() to authenticated;
grant execute on function public.motion9_get_server_time() to authenticated;
grant execute on function public.motion9_search_orders(text, date, date, smallint, int, int) to authenticated;
grant execute on function public.motion9_stage_counts(text, date, date) to authenticated;
grant execute on function public.motion9_create_order(text, text, text, text, text, text, text, int, int, numeric, boolean, numeric, boolean, smallint, timestamptz, uuid) to authenticated;
grant execute on function public.motion9_update_order(uuid, int, text, text, text, text, text, text, text, int, int, numeric, boolean, numeric, boolean, smallint, timestamptz, text) to authenticated;
grant execute on function public.motion9_change_stage(uuid, int, smallint, text) to authenticated;
grant execute on function public.motion9_delete_order(uuid, int, text) to authenticated;
grant execute on function public.motion9_restore_order(uuid, int) to authenticated;
grant execute on function public.motion9_export_orders(text, date, date, smallint, text, int, int) to authenticated;
grant execute on function public.motion9_admin_list() to authenticated;
grant execute on function public.motion9_manage_member(uuid, text, text) to authenticated;
grant execute on function public.motion9_update_limit(int) to authenticated;
-- motion9_bootstrap_owner는 GRANT 없음 (SQL Editor 전용)

-- ----------------------------------------------------------------------------
-- 12. 실행 후 검증 (주석 해제 후 1줄씩 실행)
-- ----------------------------------------------------------------------------
-- select * from private.motion9_settings;                                   -- 1행(5) 확인
-- select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname like 'motion9\_%' order by 1;  -- RPC 14개 확인
-- select * from public.motion9_daily_counters;                              -- 빈 상태 정상
-- -- 최초 owner 초기화 (Auth UUID 확인 후 1회만):
-- -- select * from public.motion9_bootstrap_owner('00000000-0000-0000-0000-000000000000', '대표관리자');
