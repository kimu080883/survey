-- 管理者用の車両稼働率。既存の日報・車両ID・距離は変更しない。
alter table public.vehicles
  add column if not exists owner_department_id text references public.departments(id);

create table if not exists public.fleet_month_settings (
  month date primary key,
  business_days integer not null check (business_days between 0 and 31),
  hours_per_day numeric(5,2) not null check (hours_per_day > 0 and hours_per_day <= 24),
  updated_at timestamptz not null default now(),
  constraint fleet_month_settings_first_day check (extract(day from month) = 1)
);

alter table public.fleet_month_settings enable row level security;

create policy vehicles_admin_read on public.vehicles for select
  to authenticated using ((select public.is_admin()));
create policy vehicles_admin_update on public.vehicles for update
  to authenticated using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy fleet_month_settings_admin_read on public.fleet_month_settings for select
  to authenticated using ((select public.is_admin()));
create policy fleet_month_settings_admin_insert on public.fleet_month_settings for insert
  to authenticated with check ((select public.is_admin()));
create policy fleet_month_settings_admin_update on public.fleet_month_settings for update
  to authenticated using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- 公開クライアントに強い更新権限を与えず、保有部署の列だけ変更を許可する。
grant select on public.fleet_month_settings to authenticated;
grant insert (month,business_days,hours_per_day),update (business_days,hours_per_day)
  on public.fleet_month_settings to authenticated;
grant update (owner_department_id) on public.vehicles to authenticated;
grant select (owner_department_id) on public.vehicles to anon,authenticated;

comment on column public.vehicles.owner_department_id is
  '管理者のみ更新可能。部署別稼働率は車両の現在の保有部署で分類する。';
comment on table public.fleet_month_settings is
  '管理者の月次集計設定。未設定月はアプリ側で土日を除いた営業日と8時間を使用する。';
