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
],master,{businessDays:20,hoursPerDay:8});
assert.equal(data.vehicleRows[0].usageHours,4,'同じ車両の重複時刻は合算しない');
assert.equal(data.vehicleRows[1].usageHours,2,'日付をまたぐ使用を計算する');
assert.equal(data.vehicleRows[2].utilizationRate,null,'時刻未入力は算出しない');
assert.equal(data.totals.capacityHours,480,'全車の分母は保有台数×営業日×基準時間');
assert.equal(data.totals.utilizationRate,null,'未入力がある月は全体も未算出');
assert.equal(data.departmentRows.find(r=>r.departmentId==='A').utilizationRate,2.5);
assert.equal(data.departmentRows.find(r=>r.departmentId==='B').utilizationRate,1.3);
assert.equal(data.totals.unassignedVehicles,1);
assert.equal(app.businessWeekdays('2026-09'),22);
console.log('fleet utilization: OK');
