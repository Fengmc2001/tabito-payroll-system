import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {createRecord,currentMonth} from '../app/lib/payroll.ts';

const fixture=JSON.parse(readFileSync('.local/permissions-qa-accounts.json','utf8'));
const base=process.env.PAYROLL_TEST_BASE_URL;
if(!base || fixture.base!==base || !['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Use an isolated localhost database and its permission fixtures.');
let checks=0;
const equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
async function req(path,actor,method='GET',body,status=200){
  const response=await fetch(base+path,{method,headers:{origin:base,...(actor?.cookie?{cookie:actor.cookie}:{}),...(body && !(body instanceof FormData)?{'content-type':'application/json'}:{})},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();equal(Array.isArray(status)?status.includes(response.status):response.status===status,true,`${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  return {...data,httpStatus:response.status,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
const [admin,r1,r2,owner,other,grantee]=fixture.accounts;
for(const actor of fixture.accounts)Object.assign(actor,await req('/api/users/login',null,'POST',{email:actor.email,passwordDigest:createHash('sha256').update(actor.password).digest('hex')}));
const managed=async actor=>(await req('/api/admin/users',admin)).users.find(user=>user.id===actor.id);
async function access(actor,values){const user=await managed(actor);await req('/api/admin/users/'+actor.id+'/access',admin,'PATCH',{...user.access,...values,expectedUpdatedAt:user.updatedAt});}
async function role(actor,values){const user=await managed(actor);await req('/api/admin/users/'+actor.id,admin,'PATCH',{...values,expectedUpdatedAt:user.updatedAt});}
for(const [actor,name] of [[admin,'表格管理员'],[r1,'审核员阿惟'],[r2,'审核员泠泠'],[owner,'授课老师A'],[other,'授课老师B'],[grantee,'额外授权账号']]){
  const {account}=await req('/api/users',actor);
  await req('/api/users/'+actor.id,actor,'PATCH',{expectedProfileVersion:account.profileVersion,profile:{...account.profile,lastNameCn:name.slice(0,1),firstNameCn:name.slice(1)}});actor.name=name;
}
await access(admin,{reviewerUserId:null});
for(const reviewer of [r1,r2]){await role(reviewer,{role:'reviewer',status:'active',workManager:true});await access(reviewer,{reviewerUserId:null,subjectUserIds:[]});}
await role(other,{role:'employee',status:'active',workManager:true});await access(other,{reviewerUserId:r2.id,subjectUserIds:[]});
await access(grantee,{subjectUserIds:[owner.id],features:{summary:true,employees:false,audit:false}});
const month=currentMonth();
function pdf(){
  const stream='BT /F1 16 Tf 40 80 Td (Table preview attachment - test only) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 130] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let output='%PDF-1.4\n';const offsets=[0];
  objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(output));output+=`${i+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(output);output+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return output;
}
const file=new FormData();file.set('file',new File([pdf()],'table-preview.pdf',{type:'application/pdf'}));
const proof=(await req('/api/uploads',owner,'POST',file,201)).file.key;
const created=[];
async function make(actor,leader,overrides={}){
  const record={...createRecord(actor.id),id:'salary-table-'+randomUUID(),workDate:month+'-14',checkUserId:leader.id,checkUser:leader.name,departmentKey:'dept-teaching',departmentLabel:'教学部',applyType:1,rate:3000,startTime:'10:00',endTime:'12:00',restHours:0.25,workContent:'表格试用 · 数学授课',memo:'独立本地试用数据',...overrides};
  const result=(await req('/api/staff/payroll/records',admin,'POST',{targetUserId:actor.id,record,submit:true},201)).record;created.push(result);return result;
}
const first=await make(owner,r1,{attachments:[proof],workContent:'表格试用 · 工作内容很长，用于检查单行截断和完整详情。'.repeat(22),memo:'完整备注。\n核对本月课时、人数和交通凭证。'.repeat(8)});
const differentReviewer=await make(owner,r2,{currency:'CNY',rate:150,workContent:'表格试用 · 人民币授课'});
const otherOwner=await make(other,r2);
const list=async actor=>(await req('/api/review/salary-records',actor)).items;
const adminRows=await list(admin),firstListed=adminRows.find(item=>item.record.id===first.id);
equal(Boolean(firstListed.submittedAt),true,'submission timestamp supplied');
const initialHistory=await req('/api/salary-records/'+first.id+'/history',admin);
equal(firstListed.submittedAt,initialHistory.history.find(h=>h.action==='salary.proxy_submit').createdAt,'timestamp comes from submit history');
equal((await list(r1)).some(item=>item.record.id===differentReviewer.id),false,'assigned reviewer cannot see other income');
equal((await list(r1)).some(item=>item.record.id===first.id),true,'assigned reviewer sees assigned wage');
equal((await list(grantee)).some(item=>item.record.id===differentReviewer.id),true,'full grantee sees employee wage regardless of assignee');
equal((await list(grantee)).some(item=>item.record.id===otherOwner.id),false,'full grantee cannot see other employees');
await req('/api/review/salary-records',other,'GET',undefined,403);
await req('/api/salary-records/'+first.id+'/history',other,'GET',undefined,403);
for(const [actor,status] of [[admin,200],[r1,200],[grantee,200],[r2,403],[other,403]]){
  const response=await fetch(base+'/api/files?key='+encodeURIComponent(proof),{headers:{cookie:actor.cookie}});equal(response.status,status,'attachment scope unchanged');
}
const decide=(record,actor,decision='approve',auditMemo='',status=200)=>req('/api/review/salary-records/'+record.id,actor,'PATCH',{decision,auditMemo,expectedUpdatedAt:record.updatedAt},status);
await decide(first,other,'approve','',403);
await decide(first,r1,'reject','   ',400);await decide(first,r1,'reject','x'.repeat(1001),400);
equal((await req('/api/salary-records/'+first.id+'/history',admin)).record.status,2,'invalid rejection does not mutate');
await decide(first,r1,'reject','  请补充完整授课记录。  ');
const rejected=await req('/api/salary-records/'+first.id+'/history',admin);
equal(rejected.record.auditMemo,'请补充完整授课记录。','trimmed reason persisted');
equal(rejected.history.filter(h=>h.action==='salary.reject').length,1,'one rejection history');
await decide(first,r1,'reject','重复点击',409);
equal((await list(admin)).find(item=>item.record.id===first.id).submittedAt,firstListed.submittedAt,'decision does not change submission time');
await decide(differentReviewer,grantee);
const race=await make(owner,r1,{workContent:'表格试用 · 并发检查'});
const racing=await Promise.all([decide(race,admin,'approve','',[200,409]),decide(race,grantee,'reject','并发驳回',[200,409])]);
equal(racing.map(r=>r.httpStatus).sort(),[200,409],'exactly one concurrent decision wins');
const raceHistory=await req('/api/salary-records/'+race.id+'/history',admin);
equal(raceHistory.history.filter(h=>['salary.approve','salary.reject'].includes(h.action)).length,1,'concurrent loser adds no approval history');
const stale=await make(owner,r1,{workContent:'表格试用 · 版本冲突'});
await req('/api/review/salary-records/'+stale.id+'/assign',admin,'PATCH',{reviewerUserId:r2.id,expectedUpdatedAt:stale.updatedAt});
await decide(stale,admin,'reject','旧弹窗不得覆盖新分配',409);
equal((await req('/api/salary-records/'+stale.id+'/history',admin)).record.reviewerUserId,r2.id,'stale request preserves reassignment');
for(let index=0;index<32;index++){
  const record=await make(index<26?owner:other,index%3===0?r2:r1,{workDate:`${month}-${String(1+index%27).padStart(2,'0')}`,currency:index%4===0?'CNY':'JPY',rate:index%4===0?180:3000,workContent:`表格试用 ${String(index+1).padStart(2,'0')} · ${index%2?'数学':'日语'}课程`,includeTravel:index%2===0,travelStart:index%2===0?'新宿':'',travelEnd:index%2===0?'中野':'',travelFee:index%2===0?220:0,attachments:index<3?[proof]:[]});
  if(index%5===0)await decide(record,admin);
  else if(index%7===0)await decide(record,admin,'reject','请核对课程时长。');
}
const longPending=await make(owner,r1,{workDate:month+'-28',attachments:[proof],workContent:'表格试用 · 长内容待审。'.repeat(65),memo:'完整备注与附件需要在展开区查看。'.repeat(20)});
await make(owner,r1,{workDate:month.slice(0,4)+'-01-10',workContent:'表格试用 · 其他月份筛选'});
const self=await make(r1,r1,{workContent:'表格试用 · 未授权自审，管理员处理'});
equal(self.reviewerUserId,null,'self-review grant logic unchanged');await decide(self,r1,'approve','',403);
const rows=await list(admin);
equal(rows.filter(item=>item.record.workDate.startsWith(month)&&item.user.id===owner.id).length>20,true,'multi-page fixture ready');
writeFileSync('.local/review-table-preview.json',JSON.stringify({base,month,accounts:fixture.accounts.map(({id,name,email,password})=>({id,name,email,password})),recordIds:created.map(r=>r.id),longPendingId:longPending.id,proof},null,2),{mode:0o600});
console.log(JSON.stringify({result:'PASS',checks,base,month,previewRecords:created.length}));
