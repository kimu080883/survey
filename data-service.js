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

window.FleetData = {
  service: CFG.mode === "api" ? new RestDataService() : new DemoDataService(),
  summarizeReports,
  appError
};
})();
