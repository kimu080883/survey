-- 車両の保有部署はBoxのマスターExcelで管理し、承認済みの取込でのみ変更する。
revoke update (owner_department_id) on public.vehicles from authenticated;
drop policy if exists vehicles_admin_update on public.vehicles;
