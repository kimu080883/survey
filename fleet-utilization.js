(function(){
"use strict";
const base=window.FleetAdmin;
const round=(n,d=2)=>Math.round(n*10**d)/10**d;

function weekdays(month){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return 0;
  const [year,m]=month.split("-").map(Number),last=new Date(Date.UTC(year,m,0)).getUTCDate();
  let count=0;
  for(let day=1;day<=last;day++){
    const weekday=new Date(Date.UTC(year,m-1,day)).getUTCDay();
    if(weekday!==0&&weekday!==6)count++;
  }
  return count;
}
function minute(value){
  const raw=String(value||"");
  if(!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(raw))return null;
  const [h,m,s=0]=raw.split(":").map(Number);
  return h*60+m+s/60;
}
function duration(reports){
  // Intervals for one vehicle on one report date are merged so concurrent reports are counted once.
  const days=new Map();let missing=0;
  reports.forEach(r=>{
    const start=minute(r.startTime),end=minute(r.endTime);
    if(start==null||end==null||start===end){missing++;return;}
    const key=r.vehicleId+"|"+r.date;
    if(!days.has(key))days.set(key,[]);
    days.get(key).push([start,end<start?end+1440:end]);
  });
  let total=0;
  days.forEach(intervals=>{
    intervals.sort((a,b)=>a[0]-b[0]);
    let from=-1,to=-1;
    intervals.forEach(([start,end])=>{
      if(start>to){if(from>=0)total+=to-from;from=start;to=end;}
      else to=Math.max(to,end);
    });
    if(from>=0)total+=to-from;
  });
  return {hours:round(total/60),missing};
}
function rate(hours,missing,capacity){return capacity>0&&missing===0?round(hours/capacity*100,1):null;}
function build(month,reports,master,config){
  const result=base.build(month,reports,master);
  const businessDays=config&&config.businessDays!=null?Number(config.businessDays):weekdays(month);
  const hoursPerDay=config&&config.hoursPerDay!=null?Number(config.hoursPerDay):8;
  const byId=new Map((master.vehicles||[]).map(v=>[v.id,v]));
  const groups=new Map((master.departments||[]).map(d=>[d.id,{departmentId:d.id,departmentName:d.name,vehicleCount:0,hours:0,capacity:0,missing:0,operatingDays:0}]));
  groups.set("",{departmentId:"",departmentName:"未割当",vehicleCount:0,hours:0,capacity:0,missing:0,operatingDays:0});
  result.vehicleRows.forEach(row=>{
    const vehicle=byId.get(row.vehicleId),mine=reports.filter(r=>r.vehicleId===row.vehicleId);
    const used=duration(mine);
    row.ownerDepartmentId=vehicle&&vehicle.ownerDepartmentId||"";
    row.active=Boolean(vehicle&&vehicle.active!==false);
    row.usageHours=used.hours;
    row.missingTimeReports=used.missing;
    row.capacityHours=row.active?businessDays*hoursPerDay:0;
    row.utilizationRate=rate(row.usageHours,row.missingTimeReports,row.capacityHours);
    if(row.active){
      const group=groups.get(row.ownerDepartmentId)||groups.get("");
      group.vehicleCount++;group.hours+=row.usageHours;group.capacity+=row.capacityHours;
      group.missing+=row.missingTimeReports;group.operatingDays+=row.operatingDays;
    }
  });
  result.departmentRows=[...groups.values()].map(g=>({
    ...g,hours:round(g.hours),utilizationRate:rate(g.hours,g.missing,g.capacity)
  }));
  const eligible=result.vehicleRows.filter(v=>v.active);
  const totalHours=round(eligible.reduce((n,v)=>n+v.usageHours,0));
  const missing=eligible.reduce((n,v)=>n+v.missingTimeReports,0);
  const capacity=eligible.length*businessDays*hoursPerDay;
  Object.assign(result,{businessDays,hoursPerDay});
  Object.assign(result.totals,{registeredVehicles:eligible.length,usageHours:totalHours,
    capacityHours:capacity,missingTimeReports:missing,utilizationRate:rate(totalHours,missing,capacity),
    unassignedVehicles:groups.get("").vehicleCount});
  return result;
}
function escape(v){return String(v==null?"":v).replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
function cell(v){return '<Cell><Data ss:Type="'+(typeof v==="number"&&Number.isFinite(v)?"Number":"String")+'">'+escape(v)+'</Data></Cell>';}
function sheet(name,rows){return '<Worksheet ss:Name="'+escape(name)+'"><Table>'+rows.map(r=>'<Row>'+r.map(cell).join("")+'</Row>').join("")+'</Table></Worksheet>';}
function exportExcel(d){
  const pct=v=>v==null?"時刻未入力または分母なし":v;
  const company=[["対象月","営業日数","1日あたり基準時間(h)","保有台数","使用時間(h)","利用可能時間(h)","稼働率(%)","時刻未入力件数","保有部署未割当台数"],
    [d.month,d.businessDays,d.hoursPerDay,d.totals.registeredVehicles,d.totals.usageHours,d.totals.capacityHours,pct(d.totals.utilizationRate),d.totals.missingTimeReports,d.totals.unassignedVehicles]];
  const dept=[["保有部署","保有台数","使用時間(h)","利用可能時間(h)","稼働率(%)","時刻未入力件数","延べ稼働日数"]].concat(d.departmentRows.map(r=>[r.departmentName,r.vehicleCount,r.hours,r.capacity,pct(r.utilizationRate),r.missing,r.operatingDays]));
  const vehicles=[["車両番号","車名","保有部署","稼働対象","使用時間(h)","利用可能時間(h)","稼働率(%)","時刻未入力件数","稼働日数","日報件数","月間距離"]].concat(d.vehicleRows.map(r=>[r.vehicleNo,r.vehicleName,d.departmentRows.find(x=>x.departmentId===r.ownerDepartmentId)?.departmentName||"未割当",r.active?"対象":"対象外",r.usageHours,r.capacityHours,pct(r.utilizationRate),r.missingTimeReports,r.operatingDays,r.reportCount,r.totalDistance]));
  const byDriver=[["運転者","所属","運転日数","日報件数","走行距離","使用車両"]].concat(d.driverRows.map(r=>[r.employeeName,r.departmentName,r.operatingDays,r.reportCount,r.totalDistance,r.vehicles]));
  const alcohol=[["日付","運転者","所属","車両","前時刻","前数値","前確認者","後時刻","後数値","後確認者","判定"]].concat(d.alcoholRows.map(r=>[r.date,r.employeeName,r.departmentName,r.vehicleNo,r.preTime,r.preValue,r.preChecker,r.postTime,r.postValue,r.postChecker,r.status]));
  const detail=[["日付","車両番号","社員ID","運転者","所属","開始距離","終了距離","走行距離","開始時刻","終了時刻","目的地","保存日時"]].concat(d.reports.map(r=>[r.date,r.vehicleNo,r.employeeId,r.employeeName,r.departmentName,r.startOdometer,r.endOdometer,r.distance,r.startTime,r.endTime,r.destination,r.savedAt]));
  const xml='<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">'+sheet("全社稼働率",company)+sheet("部署別稼働率",dept)+sheet("車両別稼働率",vehicles)+sheet("運転者別月次集計",byDriver)+sheet("アルコール確認一覧",alcohol)+sheet("日報明細",detail)+"</Workbook>";
  const blob=new Blob(["\ufeff"+xml],{type:"application/vnd.ms-excel;charset=utf-8"}),a=document.createElement("a");
  a.href=URL.createObjectURL(blob);a.download="運転日報管理_"+d.month+".xls";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
window.FleetAdmin={...base,build,exportExcel,businessWeekdays:weekdays,duration};
})();
