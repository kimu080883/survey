const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const context={window:{},Blob:class{},document:{},URL:{},setTimeout};
vm.createContext(context);
for(const file of ['admin-analytics.js','fleet-utilization.js']){
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context,{filename:file});
}
const app=context.window.FleetAdmin;
const master={departments:[{id:'A',name:'第一工事部'},{id:'B',name:'第二工事部'}],employees:[],vehicles:[
  {id:'1',no:'001',active:true,ownerDepartmentId:'A'},
  {id:'2',no:'002',active:true,ownerDepartmentId:'B'},
  {id:'3',no:'003',active:true,ownerDepartmentId:''}
]};
const report=(vehicleId,date,startTime,endTime)=>({vehicleId,date,startTime,endTime,employeeId:'E',employeeName:'テスト',vehicleNo:vehicleId,vehicleName:'',distance:2});
const data=app.build('2026-09',[
  report('1','2026-09-01','09:00','12:00'),
  report('1','2026-09-01','11:00','13:00'),
  report('2','2026-09-02','23:00','01:00'),
  report('3','2026-09-03','','')
],master,{businessDays:20});
assert.equal(data.vehicleRows[0].usageHours,4,'同じ車両の重複時刻は合算しない');
assert.equal(data.vehicleRows[1].usageHours,2,'日付をまたぐ使用を計算する');
assert.equal(data.vehicleRows[0].operatingDays,1,'同じ車両・同じ日付は1日');
assert.equal(data.vehicleRows[1].operatingDays,1,'夜間の日報はその日付に計上');
assert.equal(data.vehicleRows[2].utilizationRate,5,'時刻未入力でも稼働日率は計算できる');
assert.equal(data.totals.capacityDays,60,'全車の分母は保有台数×営業日数');
assert.equal(data.totals.operatingDays,3);
assert.equal(data.totals.utilizationRate,5);
assert.equal(data.totals.missingTimeReports,1);
assert.equal(data.departmentRows.find(r=>r.departmentId==='A').utilizationRate,5);
assert.equal(data.departmentRows.find(r=>r.departmentId==='B').utilizationRate,5);
assert.equal(data.totals.unassignedVehicles,1);
assert.equal(app.businessWeekdays('2026-09'),22);
assert.equal(app.build('2026-09',[],master,{businessDays:0}).totals.utilizationRate,null);
console.log('fleet utilization: OK');
