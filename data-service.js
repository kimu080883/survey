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
  departments: (data.departments || []).map((v, i) => ({
    id:String(v.id || ("dept-" + (i + 1))),
    name:String(v.name || ""),
    active:v.active !== false
  })),
  employees: (data.employees || []).map((v, i) => typeof v === "string"
    ? {id: "emp-" + (i + 1), name: v, departmentId:"", department:"", active: true}
    : {
      id:String(v.id), name:String(v.name),
      departmentId:String(v.departmentId || v.current_department_id || ""),
      department:String(v.department || ""),
      active:v.active !== false
    }),
  vehicles: (data.vehicles || []).map((v, i) => ({
    id: String(v.id || ("veh-" + (i + 1))),
    no: String(v.no || ""),
    name: String(v.name || ""),
    active: v.active !== false,
    ownerDepartmentId: String(v.ownerDepartmentId || v.owner_department_id || ""),
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
    this.authBase = String(CFG.supabaseUrl || "").replace(/\/$/, "") + "/auth/v1";
    this.key = String(CFG.supabasePublishableKey || "");
    this.masterCache = null;
    this.sessionKey = "fleet_admin_session_v1";
    this.session = this._readSession();
  }
  _readSession(){try{return JSON.parse(sessionStorage.getItem(this.sessionKey))||null;}catch(_){return null;}}
  _saveSession(value){this.session=value||null;if(value)sessionStorage.setItem(this.sessionKey,JSON.stringify(value));else sessionStorage.removeItem(this.sessionKey);}
  async consumeAuthRedirect(){
    const raw=String(location.hash||"").replace(/^#/,"");
    if(!raw||!raw.includes("access_token="))return null;
    const p=new URLSearchParams(raw),access=p.get("access_token"),refresh=p.get("refresh_token");
    if(!access)return null;
    const expiresIn=Number(p.get("expires_in")||3600);
    this._saveSession({access_token:access,refresh_token:refresh||"",expires_at:Math.floor(Date.now()/1000)+expiresIn,user:{email:""}});
    history.replaceState(null,"",location.pathname+location.search);
    try{
      const ok=await this._request("/rpc/is_admin",{method:"POST",body:"{}",auth:true});
      if(ok!==true){this._saveSession(null);throw appError("NOT_ADMIN","この招待には管理者権限がありません");}
      return{email:"管理者",needsPassword:true,authType:p.get("type")||"invite"};
    }catch(err){this._saveSession(null);throw err;}
  }
  async _authRequest(path,payload){
    const res=await fetch(this.authBase+path,{method:"POST",cache:"no-store",headers:{"apikey":this.key,"Content-Type":"application/json"},body:JSON.stringify(payload||{})});
    const text=await res.text();let body=null;try{body=text?JSON.parse(text):null;}catch(_){body=text;}
    if(!res.ok)throw appError("AUTH_ERROR",String(body&&(body.msg||body.message||body.error_description)||"認証に失敗しました"),body);
    return body;
  }
  async _ensureToken(){
    if(!this.session||!this.session.access_token)throw appError("ADMIN_LOGIN_REQUIRED","管理者ログインが必要です");
    if(Number(this.session.expires_at||0)*1000>Date.now()+60000)return this.session.access_token;
    if(!this.session.refresh_token)throw appError("ADMIN_LOGIN_REQUIRED","管理者セッションの有効期限が切れました");
    const refreshed=await this._authRequest("/token?grant_type=refresh_token",{refresh_token:this.session.refresh_token});this._saveSession(refreshed);return refreshed.access_token;
  }
  async loginAdmin(email,password){
    const session=await this._authRequest("/token?grant_type=password",{email:String(email||"").trim(),password:String(password||"")});this._saveSession(session);
    try{const ok=await this._request("/rpc/is_admin",{method:"POST",body:"{}",auth:true});if(ok!==true){await this.logoutAdmin();throw appError("NOT_ADMIN","このアカウントには管理者権限がありません");}return{email:session.user&&session.user.email||email};}
    catch(err){if(err.code!=="NOT_ADMIN")this._saveSession(null);throw err;}
  }
  async logoutAdmin(){if(this.session&&this.session.access_token){try{await fetch(this.authBase+"/logout",{method:"POST",headers:{"apikey":this.key,"Authorization":"Bearer "+this.session.access_token}});}catch(_){}}this._saveSession(null);}
  async restoreAdmin(){if(!this.session)return null;try{const ok=await this._request("/rpc/is_admin",{method:"POST",body:"{}",auth:true});if(ok!==true){this._saveSession(null);return null;}return{email:this.session.user&&this.session.user.email||"管理者"};}catch(_){this._saveSession(null);return null;}}
  async changeAdminPassword(password){
    const token=await this._ensureToken();
    const res=await fetch(this.authBase+"/user",{method:"PUT",headers:{"apikey":this.key,"Authorization":"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({password:String(password||"")})});
    const body=await res.json().catch(()=>null);if(!res.ok)throw appError("AUTH_ERROR",String(body&&(body.msg||body.message)||"パスワードを変更できませんでした"),body);return true;
  }
  async _request(path, options){
    if(!CFG.supabaseUrl || !this.key){
      throw appError("API_NOT_CONFIGURED", "Supabaseの接続先が設定されていません");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CFG.requestTimeoutMs || 12000);
    try{
      const opts = options || {};
      const token = opts.auth ? await this._ensureToken() : null;
      const res = await fetch(this.base + path, {
        method:opts.method || "GET",
        body:opts.body,
        signal:controller.signal,
        cache:"no-store",
        headers:{
          "apikey":this.key,
          "Content-Type":"application/json",
          ...(token ? {"Authorization":"Bearer "+token} : {}),
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
    const [departments, employees, vehicles] = await Promise.all([
      this._request("/departments?select=id,name,active,display_order&active=eq.true&order=display_order.asc"),
      this._request("/employees?select=id,name,department,current_department_id,active,display_order&active=eq.true&order=display_order.asc"),
      this._request("/vehicles?select=id,vehicle_no,vehicle_name,owner_department_id,active,current_odometer,revision,display_order&active=eq.true&order=display_order.asc")
    ]);
    const value = normalizeMaster({
      departments:(departments || []).map(v => ({id:v.id, name:v.name, active:v.active})),
      employees:(employees || []).map(v => ({
        id:v.id, name:v.name, departmentId:v.current_department_id,
        department:v.department, active:v.active
      })),
      vehicles:(vehicles || []).map(v => ({
        id:v.id, no:v.vehicle_no, name:v.vehicle_name,
        active:v.active, initialOdometer:v.current_odometer, ownerDepartmentId:v.owner_department_id
      }))
    });
    this.masterCache = {at:Date.now(), value};
    return clone(value);
  }
  async getVehicleState(vehicleId){
    const rows = await this._request("/rpc/get_vehicle_input_state", {
      method:"POST",
      body:JSON.stringify({p_vehicle_id:String(vehicleId)})
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if(!row) throw appError("INVALID_VEHICLE", "車両データが見つかりません");
    return {
      vehicleId:row.vehicle_id,
      latestOdometer:asNumber(row.current_odometer),
      revision:Number(row.revision || 0),
      lastReportId:null,lastDriverName:null,lastUsedDate:null,updatedAt:null
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
      departmentId:row.department_id || source && source.departmentId || emp && emp.departmentId || "",
      departmentName:row.department_name || source && source.departmentName || emp && emp.department || "",
      vehicleId:row.vehicle_id,
      vehicleNo:source && source.vehicleNo || veh && veh.no || row.vehicle_id,
      vehicleName:source && source.vehicleName || veh && veh.name || "",
      startOdometer:asNumber(row.start_odometer),
      endOdometer:asNumber(row.end_odometer),
      distance:asNumber(row.distance),
      correctionReason:row.start_correction_reason || "",
      destination:row.destination || source && source.destination || row.route || "",
      startTime:row.start_time || source && source.startTime || "",
      endTime:row.end_time || source && source.endTime || "",
      alcoholPre:row.alcohol_pre || source && source.alcoholPre || null,
      alcoholPost:row.alcohol_post || source && source.alcoholPost || null,
      etc:row.etc || source && source.etc || "なし",
      highway:row.highway || source && source.highway || "なし",
      parking:row.parking || source && source.parking || "なし",
      memo:row.notes || source && source.memo || "",
      clientVersion:row.client_version || source && source.clientVersion || "",
      route:row.route || "",
      purpose:row.purpose || "",
      preAlcohol:asNumber(row.pre_alcohol != null ? row.pre_alcohol : row.alcohol_pre && row.alcohol_pre.value),
      postAlcohol:asNumber(row.post_alcohol != null ? row.post_alcohol : row.alcohol_post && row.alcohol_post.value),
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
      p_destination:report.destination || null,
      p_start_time:report.startTime || null,
      p_end_time:report.endTime || null,
      p_alcohol_pre:report.alcoholPre || null,
      p_alcohol_post:report.alcoholPost || null,
      p_etc:report.etc || "なし",
      p_highway:report.highway || "なし",
      p_parking:report.parking || "なし",
      p_client_version:report.clientVersion || CFG.appVersion || null,
      p_route:report.route || null,
      p_purpose:report.purpose || null,
      p_pre_alcohol:asNumber(report.preAlcohol != null ? report.preAlcohol : report.alcoholPre && report.alcoholPre.value),
      p_post_alcohol:asNumber(report.postAlcohol != null ? report.postAlcohol : report.alcoholPost && report.alcoholPost.value),
      p_notes:report.memo || report.notes || null,
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
    q.set("select", "id,client_request_id,report_date,employee_id,department_id,department_name,vehicle_id,start_odometer,end_odometer,distance,start_correction_reason,destination,start_time,end_time,alcohol_pre,alcohol_post,etc,highway,parking,client_version,route,purpose,pre_alcohol,post_alcohol,notes,vehicle_revision,created_at");
    q.set("order", "report_date.desc,created_at.desc");
    if(filters && filters.month){
      const range = this._toMonthRange(filters.month);
      q.append("report_date", "gte." + range.start);
      q.append("report_date", "lt." + range.next);
    }
    if(filters && filters.vehicleId) q.set("vehicle_id", "eq." + filters.vehicleId);
    const [rows, master] = await Promise.all([
      this._request("/driving_reports?" + q.toString(),{auth:true}),
      this.getMaster()
    ]);
    return (rows || []).map(row => this._mapReport(row, master));
  }
  async getFleetAdministration(month){
    const [vehicles, settings] = await Promise.all([
      this._request("/vehicles?select=id,vehicle_no,vehicle_name,owner_department_id,active&order=display_order.asc", {auth:true}),
      this._request("/fleet_month_settings?select=business_days&month=eq." + encodeURIComponent(month + "-01"), {auth:true})
    ]);
    return {vehicles:(vehicles || []).map(v => ({
      id:v.id,no:v.vehicle_no,name:v.vehicle_name,active:v.active,ownerDepartmentId:v.owner_department_id || ""
    })),settings:settings && settings[0] || null};
  }
  async saveFleetMonthSettings(month,businessDays){
    return this._request("/fleet_month_settings?on_conflict=month",{
      method:"POST",auth:true,headers:{"Prefer":"resolution=merge-duplicates,return=representation"},
      body:JSON.stringify({month:month+"-01",business_days:businessDays})
    });
  }
  async monthlySummary(month){
    const rows = await this._request("/rpc/get_monthly_vehicle_summary", {
      method:"POST",
      body:JSON.stringify({p_month:String(month) + "-01"}),auth:true
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
