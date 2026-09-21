(function(){
"use strict";

const CFG = window.APP_CONFIG;
const clone = value => JSON.parse(JSON.stringify(value));
const asNumber = value => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const appError = (code, message, detail) => {
  const err = new Error(message);
  err.code = code;
  if(detail !== undefined) err.detail = detail;
  return err;
};
const monthOf = date => String(date || "").slice(0, 7);
const normalizeMaster = data => ({
  employees: (data.employees || []).map((v, i) => typeof v === "string"
    ? {id: "emp-" + (i + 1), name: v, active: true}
    : {id: String(v.id), name: String(v.name), active: v.active !== false}),
  vehicles: (data.vehicles || []).map((v, i) => ({
    id: String(v.id || ("veh-" + (i + 1))),
    no: String(v.no || ""),
    name: String(v.name || ""),
    active: v.active !== false,
    initialOdometer: asNumber(v.initialOdometer)
  }))
});

function summarizeReports(reports, month){
  const active = reports
    .filter(r => !r.voided && (!month || monthOf(r.date) === month))
    .sort((a,b) => (a.date + a.savedAt).localeCompare(b.date + b.savedAt));
  const byVehicle = new Map();
  for(const r of active){
    if(!byVehicle.has(r.vehicleId)){
      byVehicle.set(r.vehicleId, {
        vehicleId:r.vehicleId, vehicleNo:r.vehicleNo, vehicleName:r.vehicleName,
        month, openingOdometer:r.startOdometer, closingOdometer:r.endOdometer,
        totalDistance:0, reportCount:0, driverIds:new Set(), anomalyCount:0
      });
    }
    const g = byVehicle.get(r.vehicleId);
    g.closingOdometer = r.endOdometer;
    g.totalDistance += Number(r.distance || 0);
    g.reportCount += 1;
    g.driverIds.add(r.employeeId);
    if(r.correctionReason) g.anomalyCount += 1;
  }
  return [...byVehicle.values()].map(g => ({
    ...g,
    driverCount:g.driverIds.size,
    driverIds:undefined,
    totalDistance:Math.round(g.totalDistance * 10) / 10
  }));
}

class DemoDataService {
  constructor(){
    this.REPORTS = "fleet_v4_reports";
    this.STATES = "fleet_v4_vehicle_states";
  }
  _read(key, fallback){
    try{
      const value = JSON.parse(localStorage.getItem(key));
      return value == null ? fallback : value;
    }catch(_){ return fallback; }
  }
  _write(key, value){ localStorage.setItem(key, JSON.stringify(value)); }
  async getMaster(){
    const res = await fetch(CFG.masterDataUrl + "?v=" + Date.now(), {cache:"no-store"});
    if(!res.ok) throw appError("MASTER_FETCH_FAILED", "マスタデータを取得できませんでした");
    return normalizeMaster(await res.json());
  }
  async getVehicleState(vehicleId){
    const states = this._read(this.STATES, {});
    const s = states[vehicleId];
    return s ? clone(s) : {vehicleId, latestOdometer:null, revision:0, lastReportId:null, updatedAt:null};
  }
  async _saveAtomic(report, expectedRevision){
    const states = this._read(this.STATES, {});
    const reports = this._read(this.REPORTS, []);
    const current = states[report.vehicleId] || {
      vehicleId:report.vehicleId, latestOdometer:null, revision:0, lastReportId:null
    };
    if(Number(expectedRevision) !== Number(current.revision)){
      throw appError("REVISION_CONFLICT",
        "別の日報が先に保存されました。最新距離を再取得してください", current);
    }
    const start = asNumber(report.startOdometer);
    const end = asNumber(report.endOdometer);
    if(start === null || end === null) throw appError("INVALID_ODOMETER", "距離を入力してください");
    if(end < start) throw appError("INVALID_ODOMETER", "終了距離は開始距離以上にしてください");
    if(current.latestOdometer !== null && Number(current.latestOdometer) !== start && !report.correctionReason){
      throw appError("MILEAGE_MISMATCH", "前回終了距離と異なるため、修正理由が必要です", current);
    }
    const now = new Date().toISOString();
    const saved = {
      ...clone(report),
      id: report.id || (crypto.randomUUID ? crypto.randomUUID() : "r-" + Date.now()),
      startOdometer:start,
      endOdometer:end,
      distance:Math.round((end - start) * 10) / 10,
      vehicleRevision:Number(current.revision) + 1,
      savedAt:now,
      voided:false
    };
    reports.push(saved);
    states[report.vehicleId] = {
      vehicleId:report.vehicleId,
      latestOdometer:end,
      revision:saved.vehicleRevision,
      lastReportId:saved.id,
      lastDriverName:saved.employeeName,
      lastUsedDate:saved.date,
      updatedAt:now
    };
    this._write(this.REPORTS, reports);
    this._write(this.STATES, states);
    return clone(saved);
  }
  async saveReport(report, options){
    const expectedRevision = options && options.expectedRevision != null
      ? options.expectedRevision : 0;
    if(navigator.locks && navigator.locks.request){
      return navigator.locks.request("fleet-v4-write", () => this._saveAtomic(report, expectedRevision));
    }
    return this._saveAtomic(report, expectedRevision);
  }
  async listReports(filters){
    let rows = this._read(this.REPORTS, []);
    if(filters && filters.month) rows = rows.filter(r => monthOf(r.date) === filters.month);
    if(filters && filters.vehicleId) rows = rows.filter(r => r.vehicleId === filters.vehicleId);
    return clone(rows.sort((a,b) => (b.date + b.savedAt).localeCompare(a.date + a.savedAt)));
  }
  async monthlySummary(month){
    return summarizeReports(this._read(this.REPORTS, []), month);
  }
  async resetDemo(){
    localStorage.removeItem(this.REPORTS);
    localStorage.removeItem(this.STATES);
  }
}

class SupabaseDataService {
  constructor(){
    this.base = String(CFG.supabaseUrl || "").replace(/\/$/, "") + "/rest/v1";
    this.key = String(CFG.supabasePublishableKey || "");
    this.masterCache = null;
  }
  async _request(path, options){
    if(!CFG.supabaseUrl || !this.key){
      throw appError("API_NOT_CONFIGURED", "Supabaseの接続先が設定されていません");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CFG.requestTimeoutMs || 12000);
    try{
      const opts = options || {};
      const res = await fetch(this.base + path, {
        method:opts.method || "GET",
        body:opts.body,
        signal:controller.signal,
        cache:"no-store",
        headers:{
          "apikey":this.key,
          "Content-Type":"application/json",
          ...(opts.headers || {})
        }
      });
      const text = await res.text();
      let body = null;
      try{ body = text ? JSON.parse(text) : null; }catch(_){ body = text; }
      if(!res.ok){
        const raw = body && (body.message || body.error_description || body.hint) || "通信に失敗しました";
        if(String(raw).includes("ODO_CONFLICT")){
          throw appError("REVISION_CONFLICT",
            "別の日報が先に保存されました。最新距離を再取得してください", raw);
        }
        if(String(raw).includes("CORRECTION_REASON_REQUIRED")){
          throw appError("MILEAGE_MISMATCH", "前回終了距離と異なるため、修正理由が必要です", raw);
        }
        if(String(raw).includes("END_ODOMETER_TOO_SMALL")){
          throw appError("INVALID_ODOMETER", "終了距離は開始距離以上にしてください", raw);
        }
        throw appError("API_ERROR", String(raw), body);
      }
      return body;
    }catch(err){
      if(err.name === "AbortError") throw appError("TIMEOUT", "通信がタイムアウトしました");
      throw err;
    }finally{
      clearTimeout(timer);
    }
  }
  _toMonthRange(month){
    const start = new Date(month + "-01T00:00:00Z");
    const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    return {start:month + "-01", next:next.toISOString().slice(0, 10)};
  }
  async getMaster(force){
    if(this.masterCache && !force && Date.now() - this.masterCache.at < 60000){
      return clone(this.masterCache.value);
    }
    const [employees, vehicles] = await Promise.all([
      this._request("/employees?select=id,name,active,display_order&active=eq.true&order=display_order.asc"),
      this._request("/vehicles?select=id,vehicle_no,vehicle_name,active,current_odometer,revision,display_order&active=eq.true&order=display_order.asc")
    ]);
    const value = normalizeMaster({
      employees:(employees || []).map(v => ({id:v.id, name:v.name, active:v.active})),
      vehicles:(vehicles || []).map(v => ({
        id:v.id, no:v.vehicle_no, name:v.vehicle_name,
        active:v.active, initialOdometer:v.current_odometer
      }))
    });
    this.masterCache = {at:Date.now(), value};
    return clone(value);
  }
  async getVehicleState(vehicleId){
    const rows = await this._request("/rpc/get_vehicle_state", {
      method:"POST",
      body:JSON.stringify({p_vehicle_id:String(vehicleId)})
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if(!row) throw appError("INVALID_VEHICLE", "車両データが見つかりません");
    return {
      vehicleId:row.vehicle_id,
      latestOdometer:asNumber(row.current_odometer),
      revision:Number(row.revision || 0),
      lastReportId:null,
      updatedAt:row.last_report_at || null
    };
  }
  _mapReport(row, master, source){
    const emp = master.employees.find(v => v.id === row.employee_id);
    const veh = master.vehicles.find(v => v.id === row.vehicle_id);
    return {
      id:row.id,
      clientRequestId:row.client_request_id,
      date:row.report_date,
      employeeId:row.employee_id,
      employeeName:source && source.employeeName || emp && emp.name || row.employee_id,
      vehicleId:row.vehicle_id,
      vehicleNo:source && source.vehicleNo || veh && veh.no || row.vehicle_id,
      vehicleName:source && source.vehicleName || veh && veh.name || "",
      startOdometer:asNumber(row.start_odometer),
      endOdometer:asNumber(row.end_odometer),
      distance:asNumber(row.distance),
      correctionReason:row.start_correction_reason || "",
      route:row.route || "",
      purpose:row.purpose || "",
      preAlcohol:asNumber(row.pre_alcohol),
      postAlcohol:asNumber(row.post_alcohol),
      notes:row.notes || "",
      vehicleRevision:Number(row.vehicle_revision || 0),
      savedAt:row.created_at,
      voided:false
    };
  }
  async saveReport(report, options){
    if(!report.clientRequestId){
      report.clientRequestId = report.id ||
        (crypto.randomUUID ? crypto.randomUUID() : "00000000-0000-4000-8000-" + String(Date.now()).padStart(12, "0").slice(-12));
    }
    const payload = {
      p_employee_id:String(report.employeeId),
      p_vehicle_id:String(report.vehicleId),
      p_report_date:String(report.date),
      p_start_odometer:asNumber(report.startOdometer),
      p_end_odometer:asNumber(report.endOdometer),
      p_expected_revision:Number(options && options.expectedRevision || 0),
      p_start_correction_reason:report.correctionReason || null,
      p_route:report.route || null,
      p_purpose:report.purpose || null,
      p_pre_alcohol:asNumber(report.preAlcohol),
      p_post_alcohol:asNumber(report.postAlcohol),
      p_notes:report.notes || null,
      p_client_request_id:report.clientRequestId
    };
    const row = await this._request("/rpc/submit_driving_report", {
      method:"POST",
      body:JSON.stringify(payload),
      headers:{"Prefer":"return=representation"}
    });
    const master = await this.getMaster();
    return this._mapReport(Array.isArray(row) ? row[0] : row, master, report);
  }
  async listReports(filters){
    const q = new URLSearchParams();
    q.set("select", "id,client_request_id,report_date,employee_id,vehicle_id,start_odometer,end_odometer,distance,start_correction_reason,route,purpose,pre_alcohol,post_alcohol,notes,vehicle_revision,created_at");
    q.set("order", "report_date.desc,created_at.desc");
    if(filters && filters.month){
      const range = this._toMonthRange(filters.month);
      q.append("report_date", "gte." + range.start);
      q.append("report_date", "lt." + range.next);
    }
    if(filters && filters.vehicleId) q.set("vehicle_id", "eq." + filters.vehicleId);
    const [rows, master] = await Promise.all([
      this._request("/driving_reports?" + q.toString()),
      this.getMaster()
    ]);
    return (rows || []).map(row => this._mapReport(row, master));
  }
  async monthlySummary(month){
    const rows = await this._request("/rpc/get_monthly_vehicle_summary", {
      method:"POST",
      body:JSON.stringify({p_month:String(month) + "-01"})
    });
    return (rows || []).map(row => ({
      vehicleId:row.vehicle_id,
      vehicleNo:row.vehicle_no,
      vehicleName:row.vehicle_name,
      month,
      openingOdometer:asNumber(row.month_start_odometer),
      closingOdometer:asNumber(row.month_end_odometer),
      totalDistance:asNumber(row.total_distance) || 0,
      reportCount:Number(row.report_count || 0),
      driverCount:Number(row.driver_count || 0),
      anomalyCount:0
    }));
  }
  async resetDemo(){
    throw appError("NOT_DEMO", "中央データベースはこの画面から初期化できません");
  }
}

class RestDataService {
  constructor(){ this.base = String(CFG.apiBaseUrl || "").replace(/\/$/, ""); }
  async _request(path, options){
    if(!this.base) throw appError("API_NOT_CONFIGURED", "本番APIの接続先が設定されていません");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CFG.requestTimeoutMs || 12000);
    try{
      const res = await fetch(this.base + path, {
        credentials:CFG.authMode === "cookie" ? "include" : "same-origin",
        ...options,
        signal:controller.signal,
        headers:{"Content-Type":"application/json", ...(options && options.headers || {})}
      });
      const body = await res.json().catch(() => ({}));
      if(!res.ok) throw appError(body.code || "API_ERROR", body.message || "通信に失敗しました", body.detail);
      return body;
    }catch(err){
      if(err.name === "AbortError") throw appError("TIMEOUT", "通信がタイムアウトしました");
      throw err;
    }finally{ clearTimeout(timer); }
  }
  async getMaster(){ return normalizeMaster(await this._request("/masters", {method:"GET"})); }
  async getVehicleState(vehicleId){
    return this._request("/vehicles/" + encodeURIComponent(vehicleId) + "/state", {method:"GET"});
  }
  async saveReport(report, options){
    return this._request("/reports", {
      method:"POST",
      headers:{"If-Match":String(options.expectedRevision)},
      body:JSON.stringify(report)
    });
  }
  async listReports(filters){
    const q = new URLSearchParams();
    if(filters && filters.month) q.set("month", filters.month);
    if(filters && filters.vehicleId) q.set("vehicleId", filters.vehicleId);
    return this._request("/reports?" + q.toString(), {method:"GET"});
  }
  async monthlySummary(month){
    return this._request("/reports/monthly-summary?month=" + encodeURIComponent(month), {method:"GET"});
  }
  async resetDemo(){ throw appError("NOT_DEMO", "本番データはこの画面から初期化できません"); }
}

let service;
if(CFG.mode === "supabase") service = new SupabaseDataService();
else if(CFG.mode === "api") service = new RestDataService();
else service = new DemoDataService();

window.FleetData = {service, summarizeReports, appError};
})();
