-- 月次の稼働日率を営業日数のみで計算する。既存 v1 適用後に実行。
alter table public.fleet_month_settings drop column if exists hours_per_day;
comment on table public.fleet_month_settings is
  '管理者の月次営業日数。未設定月はアプリ側で土日を除いた日数を使用する。';
