import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import {createRecord, currentMonth} from '../app/lib/payroll.ts';

const fixture = JSON.parse(readFileSync('.local/permissions-qa-accounts.json', 'utf8'));
const base = process.env.PAYROLL_TEST_BASE_URL;
if (!base || base !== fixture.base || !['127.0.0.1','localhost'].includes(new URL(base).hostname)) throw Error('Run permissions self-check against an isolated localhost database first.');
let checks = 0;
const ok = (value, message) => {assert.ok(value, message); checks++;};
async function req(path, actor, method = 'GET', body, status = 200) {
  const response = await fetch(base + path, {method, headers:{origin:base, ...(actor?.cookie ? {cookie:actor.cookie} : {}), ...(body && !(body instanceof FormData) ? {'content-type':'application/json'} : {})}, body:body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body)});
  const data = await response.json(); assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`); checks++;
  return {...data, cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
const actors = [];
for (const a of fixture.accounts) actors.push({...a, ...await req('/api/users/login', null, 'POST', {email:a.email, passwordDigest:createHash('sha256').update(a.password).digest('hex')})});
const [admin, reviewer, , owner, other, viewer] = actors;
const month = currentMonth();
const options = await req('/api/payroll-options', owner);
const manager = options.workManagers.find(m => m.id === admin.id) || options.workManagers[0];
const make = (actor, values = {}) => ({...createRecord(actor.id), id:'salary-ux-'+randomUUID(), checkUserId:manager.id, checkUser:manager.label, departmentKey:'dept-teaching', departmentLabel:'教学部', workDate:month+'-13', applyType:2, rate:1000, amount:2, workContent:'输入和作废回归测试', ...values});
const create = async (actor, values) => (await req('/api/salary-records', actor, 'POST', make(actor, values), 201)).record;
const history = async (record, actor=admin) => req(`/api/salary-records/${record.id}/history`, actor);
const submit = async (actor) => req('/api/salary-records/apply/'+actor.id, actor, 'POST', {month});
const approve = async (record) => {const r=(await history(record)).record; return (await req('/api/review/salary-records/'+r.id,admin,'PATCH',{decision:'approve',expectedUpdatedAt:r.updatedAt})).record;};
const remove = async (r, actor, status=200) => req(`/api/salary-records/${r.id}?updatedAt=${encodeURIComponent(r.updatedAt)}`,actor,'DELETE',undefined,status);

// Numeric API input cannot silently accept strings, nulls, booleans or bad ranges.
for (const field of ['rate','amount','travelFee','restHours']) for (const value of ['abc','01',null,true,-1,100000001]) {
  await req('/api/salary-records',owner,'POST',make(owner,{[field]:value}),400);
}
const noTravel = await create(owner,{includeTravel:false,travelStart:'不得计入',travelEnd:'不得计入',travelFee:850});
ok(noTravel.finalSalary===2000 && noTravel.travelFee===0 && noTravel.travelStart==='-' && noTravel.travelEnd==='-', 'unchecked travel is normalized on the server');
await remove(noTravel,owner);
await req('/api/salary-records/'+noTravel.id+'/history',admin,'GET',undefined,403);
const zero = await create(owner,{rate:0,amount:0,travelFee:0,includeTravel:false}); ok(zero.finalSalary===0,'empty numeric fields serialize as numeric zero'); await remove(zero,owner);
await req('/api/salary-records/travel-defaults?userId='+owner.id,other,'GET',undefined,403);
await req('/api/salary-records/travel-defaults?currency=USD',owner,'GET',undefined,400);
const travel = await create(owner,{includeTravel:true,travelStart:'新宿',travelEnd:'中野',travelFee:420});
const cny = await create(owner,{currency:'CNY',includeTravel:true,travelStart:'虹桥',travelEnd:'徐汇',travelFee:18});
await submit(owner);
let defaults=await req('/api/salary-records/travel-defaults?currency=JPY',owner);
ok(defaults.travel.travelFee===420 && defaults.travel.travelStart==='新宿','JPY recalls submitted route');
defaults=await req('/api/salary-records/travel-defaults?currency=CNY',owner);
ok(defaults.travel.travelFee===18 && defaults.travel.travelStart==='虹桥','CNY defaults remain separate');
const draftTravel = await create(owner,{includeTravel:true,travelFee:999,travelStart:'草稿路线'});
ok((await req('/api/salary-records/travel-defaults?currency=JPY',owner)).travel.travelFee===999,'saved draft replaces defaults without submission');
await remove(draftTravel,owner);
ok((await req('/api/salary-records/travel-defaults?currency=JPY',owner)).travel.travelFee===420,'deleted draft is no longer a default');

// A submitted record must first be reopened, and its original snapshot survives.
const pending=(await history(travel)).record;
await remove(pending,owner,409);
await req('/api/salary-records/'+pending.id+'/void',owner,'POST',{expectedUpdatedAt:pending.updatedAt,reason:'尚未撤回'},409);
const reopened=(await req('/api/salary-records/'+pending.id+'/reopen',owner,'POST',{expectedUpdatedAt:pending.updatedAt})).record;
await remove({...reopened,updatedAt:'stale'},owner,409);
await remove(reopened,other,404);
await remove(reopened,owner);
const voidHistory=await history(reopened);
ok(voidHistory.record.status===5 && voidHistory.history.some(h=>h.action==='salary.submit') && voidHistory.history.some(h=>h.action==='salary.void'),'void retains submission and void snapshots');
ok(!(await req('/api/users',owner)).account.salaryRecords.some(r=>r.id===reopened.id),'void hidden from owner default list');
await req('/api/salary-records/'+reopened.id+'/history',owner,'GET',undefined,403);
await req('/api/review/salary-records?status=5',reviewer,'GET',undefined,403);
await req('/api/review/salary-records?status=5',viewer,'GET',undefined,403);
ok((await req('/api/review/salary-records?status=5',admin)).items.some(i=>i.record.id===reopened.id),'admin can retrieve void archive');
await req('/api/salary-records/'+reopened.id+'/reopen',owner,'POST',{expectedUpdatedAt:voidHistory.record.updatedAt},409);
await req('/api/salary-records/'+reopened.id,owner,'PATCH',{...reopened,updatedAt:voidHistory.record.updatedAt},409);
await req('/api/review/salary-records/'+reopened.id,admin,'PATCH',{decision:'approve',expectedUpdatedAt:voidHistory.record.updatedAt},409);

// Approved wages require admin, explanation and an explicit payment check.
const form=new FormData();form.set('file',new File(['%PDF-1.4\n%%EOF'],'void-proof.pdf',{type:'application/pdf'}));
const file=(await req('/api/uploads',owner,'POST',form,201)).file.key;
const wage=await create(owner,{attachments:[file],workContent:'保留凭证的审批作废测试'});await submit(owner);
const paid=await approve(wage);
const approvedTotals = async () => (await req('/api/staff/transfer-sheet?month='+month,admin)).rows.find(r=>r.user.id===owner.id).approvedAmounts;
const before=await approvedTotals();
const payload={expectedUpdatedAt:paid.updatedAt,reason:'重复申报，已核对转账记录',paymentChecked:true};
await req('/api/salary-records/'+paid.id+'/void',owner,'POST',payload,403);
await req('/api/salary-records/'+paid.id+'/void',reviewer,'POST',payload,403);
await req('/api/salary-records/'+paid.id+'/void',admin,'POST',{...payload,reason:' '},400);
await req('/api/salary-records/'+paid.id+'/void',admin,'POST',{...payload,paymentChecked:false},400);
await req('/api/salary-records/'+paid.id+'/void',admin,'POST',{...payload,expectedUpdatedAt:'stale'},409);
const race=await Promise.all([req('/api/salary-records/'+paid.id+'/void',admin,'POST',payload), fetch(base+'/api/review/salary-records/'+paid.id,{method:'PATCH',headers:{origin:base,cookie:admin.cookie,'content-type':'application/json'},body:JSON.stringify({decision:'reject',auditMemo:'stale review',expectedUpdatedAt:paid.updatedAt})})]);
ok(race[1].status===409,'concurrent stale review cannot overwrite void');
const after=await approvedTotals();ok(before.JPY-after.JPY===paid.finalSalary && before.CNY===after.CNY,'void subtracts only its own currency from approved totals');
const archived=await history(paid);ok(archived.record.statusBeforeVoid===3 && archived.history.some(h=>h.action==='salary.approve') && archived.record.attachments.includes(file),'approved snapshot and attachment survive');
const download=await fetch(base+'/api/files?key='+encodeURIComponent(file),{headers:{cookie:admin.cookie}});ok(download.status===200,'admin can download archived evidence');
await req('/api/files?key='+encodeURIComponent(file),owner,'DELETE',undefined,409);
await req('/api/salary-records/'+paid.id+'/void',admin,'POST',payload,409);
ok(!(await req('/api/review/salary-records',admin)).items.some(i=>i.record.id===paid.id),'normal admin queue excludes voided wages');
ok(!(await req('/api/staff/employees/'+owner.id,admin)).employee.salaryRecords.some(r=>r.id===paid.id),'employee view excludes voided wages');

// Self grant can be removed dynamically, even while the same reviewer is assigned.
const self=await create(reviewer);await submit(reviewer);
const managed=(await req('/api/admin/users',admin)).users.find(u=>u.id===reviewer.id);
await req('/api/admin/users/'+reviewer.id+'/access',admin,'PATCH',{...managed.access,subjectUserIds:managed.access.subjectUserIds.filter(id=>id!==reviewer.id),expectedUpdatedAt:managed.updatedAt});
const selfPending=(await history(self)).record;
await req('/api/review/salary-records/'+self.id,reviewer,'PATCH',{decision:'approve',expectedUpdatedAt:selfPending.updatedAt},403);
ok((await req('/api/users',reviewer)).account.salaryRecords.some(r=>r.id===self.id),'revoking self approval preserves own wage visibility');
await approve(cny);
console.log(JSON.stringify({result:'PASS',checks,base,month}));
