import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRecord } from '../app/lib/payroll.ts';
const base = process.env.PAYROLL_TEST_BASE_URL || 'http://127.0.0.1:3505';
if (!['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname)) throw new Error('Permission fixtures run on localhost only.');
const password = process.env.PAYROLL_TEST_ADMIN_PASSWORD || 'Permissions-Local-2026!';
const secret = process.env.PAYROLL_TEST_BOOTSTRAP_SECRET;
if (!secret) throw new Error('PAYROLL_TEST_BOOTSTRAP_SECRET is required.');
const unique = randomUUID().slice(0,8);
const month = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'}).slice(0,7);
let checks = 0;
function ok(value,label) { assert.ok(value,label); checks++; }
async function req(path, session, method='GET', body, expected=200) {
  if (method === 'PATCH' && /^\/api\/review\/salary-records\/[^/]+$/.test(path) && expected === 200 && body && !body.expectedUpdatedAt) {
    body = {...body,expectedUpdatedAt:(await req('/api/salary-records/'+path.split('/').pop()+'/history',session)).data.record.updatedAt};
  }
  const headers = {origin:new URL(base).origin};
  if(session?.cookie) headers.cookie=session.cookie;
  if(body && !(body instanceof FormData)) headers['content-type']='application/json';
  const response=await fetch(base+path,{method,headers,body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  assert.equal(response.status,expected,method+' '+path+' '+JSON.stringify(data));checks++;
  return {data,cookie:response.headers.get('set-cookie')?.split(';')[0],status:response.status};
}
const digest=(p)=>createHash('sha256').update(p).digest('hex');
const bootstrap=(await req('/api/bootstrap-status')).data.bootstrap;
const auth=await req(bootstrap.bootstrapRequired?'/api/users':'/api/users/login',null,'POST',{
  email:'TabitoAdimin01@tabitoedu.com',passwordDigest:digest(password),bootstrapSecret:secret
},bootstrap.bootstrapRequired?201:200);
const admin={account:auth.data.account,cookie:auth.cookie,email:auth.data.account.email,password};
async function profile(s,name) {
  const snap=(await req('/api/users',s)).data.account;
  let response=await req('/api/users/'+snap.id,s,'PATCH',{expectedProfileVersion:snap.profileVersion,profile:{...snap.profile,lastNameCn:name.slice(0,1),firstNameCn:name.slice(1),address:'本地权限调试地址',tel:'090-0000-0000\nqa@example.invalid'}});
  s.account=response.data.account;
  const file=await upload(s,name+'-bank.pdf');
  response=await req('/api/users/'+s.account.id,s,'PATCH',{expectedProfileVersion:s.account.profileVersion,profile:{...s.account.profile,birthday:'1990-01-01',bankType:'jp-bank',bankName:'权限测试银行',bankBranch:'001',bankAccountNumber:'000123456789',bankAccountHolder:name,bankFileNames:[file],idType:'passport'}});
  s.account=response.data.account; s.bank=file;return s;
}
async function upload(s,name) {
  const form=new FormData();form.set('file',new File(['%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF'],name,{type:'application/pdf'}));
  return (await req('/api/uploads',s,'POST',form,201)).data.file.key;
}
async function register(name,role='employee') {
  const email='permissions-'+unique+'-'+name+'@example.invalid';
  const r=await req('/api/users',null,'POST',{email,passwordDigest:digest(password)},201);
  const s=await profile({account:r.data.account,cookie:r.cookie,email,password},name);
  if(role!=='employee')await manage(s,{role});
  return s;
}
async function managed(s) {return (await req('/api/admin/users',admin)).data.users.find(u=>u.id===s.account.id);}
async function manage(s,values) {const u=await managed(s);return (await req('/api/admin/users/'+u.id,admin,'PATCH',{...values,expectedUpdatedAt:u.updatedAt})).data.user;}
async function access(s,values) {
  const u=await managed(s);
  return (await req('/api/admin/users/'+u.id+'/access',admin,'PATCH',{...u.access,...values,expectedUpdatedAt:u.updatedAt})).data.user;
}
await req('/api/admin/settings',admin,'PATCH',{registrationOpen:true});
await profile(admin,'权限管理员');
const r1=await register('审核甲','reviewer'),r2=await register('审核乙','reviewer');
const a=await register('老师甲'),b=await register('老师乙'),viewer=await register('资料查看员');
await manage(admin,{workManager:true});
await manage(b,{workManager:true});
await access(admin,{reviewerUserId:r1.account.id});
await access(b,{reviewerUserId:r2.account.id});
await req('/api/review/salary-records',b,'GET',undefined,403);
await req('/api/staff/employees',r1,'GET',undefined,403);
await req('/api/audit/overview',r1,'GET',undefined,403);
ok((await req('/api/staff/payroll/users',r1)).data.users.every(u=>u.id===r1.account.id),'reviewer target picker exposes only self');
// A page flag alone never grants somebody else's payroll.
await access(viewer,{features:{summary:true,employees:true,audit:true}});
ok((await req('/api/staff/employees',viewer)).data.employees.every(u=>u.id===viewer.account.id),'page-only grants reveal no other employees');
await req('/api/staff/employees/'+a.account.id,viewer,'GET',undefined,403);
const malformed = await managed(viewer);
await req('/api/admin/users/'+viewer.account.id+'/access',r1,'PATCH',{...malformed.access,expectedUpdatedAt:malformed.updatedAt},403);
await req('/api/admin/users/'+viewer.account.id+'/access',admin,'PATCH',{...malformed.access,features:{summary:'yes',employees:false,audit:false},expectedUpdatedAt:malformed.updatedAt},400);
await req('/api/admin/users/'+viewer.account.id+'/access',admin,'PATCH',{...malformed.access,subjectUserIds:['nonexistent'],expectedUpdatedAt:malformed.updatedAt},400);
await req('/api/admin/users/'+viewer.account.id+'/access',admin,'PATCH',{...malformed.access,reviewerUserId:a.account.id,expectedUpdatedAt:malformed.updatedAt},400);
const proofA=await upload(a,'teaching.pdf'),proofC=await upload(a,'commission.pdf'),draftProof=await upload(a,'draft-only.pdf');
async function create(s,manager,content,rate,attachments=[],currency='JPY') {
  const record={...createRecord(s.account.id),id:'salary-permissions-'+randomUUID(),workDate:month+'-09',checkUserId:manager.account.id,checkUser:manager.account.profile.lastNameCn,departmentKey:'dept-teaching',departmentLabel:'教学部',currency,applyType:6,rate,workContent:content,attachments};
  return (await req('/api/salary-records',s,'POST',record,201)).data.record;
}
const teaching=await create(a,admin,'权限测试授课费',30000,[proofA]);
const commission=await create(a,b,'不应向审核甲显示的提成',20000,[proofC]);
const bRecord=await create(b,b,'老师乙私密工资',10000);
const cny=await create(a,b,'人民币讲义翻译',800,[],'CNY');
await req('/api/salary-records/apply/'+a.account.id,a,'POST',{month});
await req('/api/salary-records/apply/'+b.account.id,b,'POST',{month});
const draft=await create(a,admin,'未提交的私人草稿',999,[draftProof]);
let queue=(await req('/api/review/salary-records',r1)).data.items;
ok(queue.some(i=>i.record.id===teaching.id),'assigned reviewer sees teaching');
ok(!queue.some(i=>[commission.id,bRecord.id,draft.id].includes(i.record.id)),'unassigned and draft records absent');
ok((await req('/api/review/salary-records',r2)).data.items.some(i=>i.record.id===commission.id),'second reviewer sees commission');
await req('/api/salary-records/'+commission.id+'/history',r1,'GET',undefined,403);
await req('/api/review/salary-records/'+commission.id,r1,'PATCH',{decision:'approve'},403);
async function download(key,s,status=200) {
  const response=await fetch(base+'/api/files?key='+encodeURIComponent(key),{headers:{cookie:s.cookie}});
  assert.equal(response.status,status,'file visibility '+status);checks++; if(status===200) ok((await response.text()).startsWith('%PDF-'),'download bytes are PDF');
}
await download(proofA,r1);
await download(proofC,r1,403);await download(a.bank,r1,403);await download(draftProof,r1,403);
let rows=(await req('/api/staff/transfer-sheet?month='+month+'&scope=assigned',r1)).data.rows;
let aRow=rows.find(r=>r.user.id===a.account.id);
ok(aRow&&aRow.records.length===1&&aRow.records[0].id===teaching.id,'summary only assigned line');
ok(!aRow.profile.bankAccountNumber&&aRow.pdfFiles.length===0&&!aRow.completeProfile,'summary does not leak payment info or profile PDFs');
await req('/api/staff/payroll/records',r1,'POST',{targetUserId:a.account.id,record:teaching,submit:false},403);
await req('/api/staff/payroll/records?userId='+a.account.id+'&month='+month,r1,'GET',undefined,403);
await req('/api/staff/payroll/uploads/'+a.account.id,r1,'POST',undefined,403);
const batch={requestId:'batch-request-'+randomUUID(),targetUserId:a.account.id,month,mode:'calendar',submit:false,template:{...teaching,attachments:[]},calendarSessions:[{workDate:month+'-12',startTime:'10:00',endTime:'11:00',restHours:0}]};
await req('/api/staff/payroll/batches',r1,'POST',batch,403);
await req('/api/staff/payroll/rules?userId='+a.account.id,r1,'GET',undefined,403);
await req('/api/staff/payroll/rules/run',r1,'POST',{targetUserId:a.account.id,month},403);
const selfBatch={...batch,requestId:'batch-request-'+randomUUID(),targetUserId:viewer.account.id,template:{...batch.template,userId:viewer.account.id}};
const selfResult=await req('/api/staff/payroll/batches',viewer,'POST',selfBatch,201);
ok(selfResult.data.records.length===1&&selfResult.data.records[0].userId===viewer.account.id,'ordinary employee self batch works');
const replay=await req('/api/staff/payroll/batches',viewer,'POST',selfBatch,201);
ok(replay.data.replayed===true,'self batch replay does not duplicate');
const sameVersion=await managed(viewer);
await access(viewer,{features:{summary:true,employees:true,audit:true},subjectUserIds:[a.account.id]});
await req('/api/admin/users/'+viewer.account.id+'/access',admin,'PATCH',{...sameVersion.access,expectedUpdatedAt:sameVersion.updatedAt},409);
ok((await req('/api/staff/employees',viewer)).data.employees.some(u=>u.id===a.account.id),'granted employee appears');
ok(!(await req('/api/staff/employees',viewer)).data.employees.some(u=>u.id===b.account.id),'ungranted employee absent');
const detail=(await req('/api/staff/employees/'+a.account.id,viewer)).data.employee;
ok(detail.profile.bankAccountNumber==='000123456789','explicit full access includes bank details');
ok(detail.salaryRecords.some(r=>r.id===commission.id)&&!detail.salaryRecords.some(r=>r.id===draft.id),'full history includes other reviewers but not drafts');
ok(!detail.files.some(f=>f.key===draftProof),'full profile does not expose draft-only files');
await download(a.bank,viewer);await download(proofC,viewer);await download(draftProof,viewer,403);
await req('/api/staff/employees/'+b.account.id,viewer,'GET',undefined,403);
await req('/api/review/salary-records',viewer,'GET',undefined,403);
await req('/api/staff/payroll/records',viewer,'POST',{targetUserId:a.account.id,record:teaching,submit:false},403);
const grantOverview=(await req('/api/audit/overview?year='+month.slice(0,4)+'&month='+month,viewer)).data.overview;
ok(!grantOverview.employees.some(u=>u.id===b.account.id),'audit employee list respects grant');
await access(r1,{features:{summary:true,employees:true,audit:true},subjectUserIds:[a.account.id]});
ok((await req('/api/staff/employees/'+a.account.id,r1)).data.employee.salaryRecords.some(r=>r.id===commission.id),'reviewer extra grant reveals complete submitted wages');
await req('/api/review/salary-records/'+commission.id,r1,'PATCH',{decision:'approve'},403);
await access(viewer,{subjectUserIds:[]});
await req('/api/staff/employees/'+a.account.id,viewer,'GET',undefined,403);await download(proofA,viewer,403);
ok(!(await req('/api/staff/transfer-sheet?month='+month+'&scope=granted',viewer)).data.rows.some(r=>r.user.id===a.account.id),'revocation blocks summary and export data without relogin');
await access(r1,{subjectUserIds:[],features:{summary:true,employees:false,audit:false}});
await download(proofC,r1,403);
const teachingVersion = (await req('/api/salary-records/'+teaching.id+'/history',r1)).data.record.updatedAt;
await req('/api/review/salary-records/'+teaching.id,r1,'PATCH',{decision:'approve'},400);
const teachingNow=(await req('/api/salary-records/'+teaching.id+'/history',admin)).data.record;
await req('/api/review/salary-records/'+teaching.id+'/assign',admin,'PATCH',{reviewerUserId:r2.account.id,expectedUpdatedAt:teachingNow.updatedAt});
await req('/api/salary-records/'+teaching.id+'/history',r1,'GET',undefined,403);await download(proofA,r1,403);
await download(proofA,r2);
await req('/api/review/salary-records/'+teaching.id,r2,'PATCH',{decision:'approve',expectedUpdatedAt:teachingVersion},409);
await req('/api/review/salary-records/'+teaching.id+'/assign',admin,'PATCH',{reviewerUserId:r1.account.id,expectedUpdatedAt:teachingVersion},409);
let history=(await req('/api/salary-records/'+teaching.id+'/history',r2)).data;
ok(history.history.some(h=>h.action==='salary.submit')&&history.history.some(h=>h.action==='salary.reassign'),'new reviewer sees complete line-specific history');
await req('/api/review/salary-records/'+teaching.id,r2,'PATCH',{decision:'reject',auditMemo:'请核对课时'});
const rejected=(await req('/api/salary-records/'+teaching.id+'/history',a)).data.record;
await req('/api/salary-records/'+teaching.id+'/reopen',a,'POST',{expectedUpdatedAt:rejected.updatedAt});
await req('/api/salary-records/'+teaching.id+'/history',r2,'GET',undefined,403);
let own=(await req('/api/users',a)).data.account;
const reopened=own.salaryRecords.find(r=>r.id===teaching.id);
await req('/api/salary-records/'+teaching.id+'?updatedAt='+encodeURIComponent(reopened.updatedAt),a,'DELETE',undefined,409);
await req('/api/salary-records/'+teaching.id,a,'PATCH',{...reopened,rate:31000,attachments:[],reviewerUserId:r2.account.id});
await req('/api/files?key='+encodeURIComponent(proofA),a,'DELETE',undefined,409);
await req('/api/salary-records/apply/'+a.account.id,a,'POST',{month});
history=(await req('/api/salary-records/'+teaching.id+'/history',r1)).data;
ok(history.record.finalSalary===31000&&history.history.some(h=>h.record?.finalSalary===30000&&h.action==='salary.reject'),'resubmission preserves rejected amount snapshot');
await download(proofA,r1); // historical attachment still available after being removed in a resubmission
await req('/api/review/salary-records/'+teaching.id,r1,'PATCH',{decision:'approve'});
await req('/api/review/salary-records/'+cny.id,r2,'PATCH',{decision:'approve'});
const r1Total=(await req('/api/staff/transfer-sheet?month='+month+'&scope=assigned',r1)).data.rows.find(row=>row.user.id===a.account.id);
ok(r1Total.approvedAmounts.JPY===31000&&r1Total.approvedAmounts.CNY===0,'assigned totals cannot include the other reviewer CNY salary');
const r2Total=(await req('/api/staff/transfer-sheet?month='+month+'&scope=assigned',r2)).data.rows.find(row=>row.user.id===a.account.id);
ok(r2Total.approvedAmounts.CNY===800&&r2Total.approvedAmounts.JPY===0&&r2Total.records.some(r=>r.id===cny.id),'summary includes CNY detail and only approved scoped totals');
await access(admin,{reviewerUserId:null});
const unassigned=await create(b,admin,'管理员待办工资',500);
await req('/api/salary-records/apply/'+b.account.id,b,'POST',{month});
ok(!(await req('/api/review/salary-records',r1)).data.items.some(i=>i.record.id===unassigned.id),'unconfigured mapping does not expose to reviewers');
ok((await req('/api/review/salary-records',admin)).data.items.some(i=>i.record.id===unassigned.id),'unconfigured mapping enters admin queue');
await access(admin,{reviewerUserId:r1.account.id});
ok(!(await req('/api/review/salary-records',r1)).data.items.some(i=>i.record.id===unassigned.id),'new mapping does not retroactively assign old records');
await manage(r2,{status:'disabled'});
await req('/api/review/salary-records',r2,'GET',undefined,401);
await access(b,{reviewerUserId:null});
await manage(r2,{status:'active'});
const reviewerOwn=await create(r1,admin,'审核员本人申报',1000);
await req('/api/salary-records/apply/'+r1.account.id,r1,'POST',{month});
await req('/api/review/salary-records/'+reviewerOwn.id,r1,'PATCH',{decision:'approve'});
ok(true,'self approval remains permitted when explicitly assigned');
// Recurring authority follows the current executor, never a historical reviewer role.
await manage(r2,{role:'admin'});
const fixed={...batch,requestId:'batch-request-'+randomUUID(),targetUserId:a.account.id,submit:false,mode:'fixed',
  fixedSchedule:{rangeStart:month+'-01',rangeEnd:month+'-07',weekdays:[1],startTime:'10:00',endTime:'11:00',restHours:0},
  recurring:{enabled:true,title:'权限迁移规律',startMonth:month,endMonth:''}};
const legacyRule=(await req('/api/staff/payroll/batches',admin,'POST',{...fixed,requestId:'batch-request-'+randomUUID()},201)).data.rule;
// Author the legacy fixture using the temporarily authorized second administrator.
const r2Login=await req('/api/users/login',null,'POST',{email:r2.email,passwordDigest:digest(password)});
r2.cookie=r2Login.cookie;
const blockedRule=(await req('/api/staff/payroll/batches',r2,'POST',fixed,201)).data.rule;
await manage(r2,{role:'reviewer'});
let rules=(await req('/api/staff/payroll/rules?userId='+a.account.id,admin)).data.rules;
let blocked=rules.find(rule=>rule.id===blockedRule.id);
ok(blocked.executionBlocked,'demotion stops old proxy recurring authority');
await req('/api/staff/payroll/rules/'+blocked.id,admin,'PATCH',{active:true,expectedUpdatedAt:blocked.updatedAt},409);
await req('/api/staff/payroll/rules/'+blocked.id,r1,'PATCH',{active:true,takeOver:true,expectedUpdatedAt:blocked.updatedAt},403);
const nextDate=new Date(month+'-15T00:00:00Z');nextDate.setUTCMonth(nextDate.getUTCMonth()+1);
const nextMonth=nextDate.toISOString().slice(0,7);
await req('/api/staff/payroll/rules/run',admin,'POST',{targetUserId:a.account.id,month:nextMonth});
let nextRecords=(await req('/api/staff/payroll/records?userId='+a.account.id+'&month='+nextMonth,admin)).data.records;
ok(!nextRecords.some(r=>r.recurringRuleId===blocked.id)&&nextRecords.some(r=>r.recurringRuleId===legacyRule.id),'blocked rule is not executed while valid rule still runs');
await req('/api/staff/payroll/rules/'+blocked.id,admin,'PATCH',{active:true,takeOver:true,expectedUpdatedAt:blocked.updatedAt});
await req('/api/staff/payroll/rules/run',admin,'POST',{targetUserId:a.account.id,month:nextMonth});
nextRecords=(await req('/api/staff/payroll/records?userId='+a.account.id+'&month='+nextMonth,admin)).data.records;
ok(nextRecords.some(r=>r.recurringRuleId===blocked.id),'admin takeover restores future recurring generation');
rules=(await req('/api/staff/payroll/rules?userId='+a.account.id,admin)).data.rules;
ok(rules.find(r=>r.id===blocked.id).createdByUserId===r2.account.id,'takeover preserves original creator');
const ownRule=(await req('/api/staff/payroll/batches',viewer,'POST',{...fixed,requestId:'batch-request-'+randomUUID(),targetUserId:viewer.account.id,submit:true},201)).data.rule;
ok(ownRule && !ownRule.executionBlocked,'ordinary employee can establish own recurring submissions');
await req('/api/staff/payroll/rules/run',viewer,'POST',{month:nextMonth});
ok((await req('/api/users',viewer)).data.account.salaryRecords.some(r=>r.recurringRuleId===ownRule.id&&r.status===2&&r.workDate.startsWith(nextMonth)),'ordinary employee can execute own monthly recurring submission');
await access(viewer,{features:{summary:false,employees:false,audit:false}});
await req('/api/staff/transfer-sheet?month='+month,viewer,'GET',undefined,403);
await req('/api/staff/employees',viewer,'GET',undefined,403);
await req('/api/audit/overview',viewer,'GET',undefined,403);
const creds=[admin,r1,r2,a,b,viewer].map(s=>({id:s.account.id,name:s.account.profile.lastNameCn+s.account.profile.firstNameCn,email:s.email,password:s.password}));
if(process.env.PAYROLL_TEST_SAVE_ACCOUNTS==='1') await writeFile('.local/permissions-qa-accounts.json',JSON.stringify({base,accounts:creds},null,2),{mode:0o600});
console.log(JSON.stringify({result:'PASS',checks,base,accountCount:creds.length,month}));
