import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createRecord, currentMonth } from '../app/lib/payroll.ts';

const fixture = JSON.parse(readFileSync('.local/permissions-qa-accounts.json', 'utf8'));
const base = process.env.PAYROLL_TEST_BASE_URL;
if (!base || fixture.base !== base || !['localhost', '127.0.0.1'].includes(new URL(base).hostname)) {
  throw Error('Use permission fixtures from the same isolated local test database.');
}
let checks = 0;
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
async function req(path, actor, method = 'GET', body, expected = 200) {
  const response = await fetch(base + path, {
    method,
    headers: { origin: base, ...(actor?.cookie ? { cookie: actor.cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
  return { ...data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const [admin, reviewer, , owner, other] = fixture.accounts;
for (const actor of [admin, reviewer, owner, other]) {
  Object.assign(actor, await req('/api/users/login', null, 'POST', {
    email: actor.email, passwordDigest: createHash('sha256').update(actor.password).digest('hex'),
  }));
}
const options = await req('/api/payroll-options', owner);
const manager = options.workManagers.find(m => m.id === admin.id) ?? options.workManagers[0];
const month = currentMonth();
const make = (actor, values = {}) => ({ ...createRecord(actor.id), id: 'salary-travel-draft-' + randomUUID(),
  workDate: month + '-03', checkUserId: manager.id, checkUser: manager.label, departmentKey: 'dept-teaching',
  departmentLabel: '教学部', applyType: 2, rate: 1000, amount: 1, includeTravel: true,
  travelStart: '新宿', travelEnd: '中野', travelFee: 381, workContent: '未提交交通回填测试', ...values });
const create = async (actor, values) => (await req('/api/salary-records', actor, 'POST', make(actor, values), 201)).record;
const defaults = async (actor, currency = 'JPY', userId = actor.id) =>
  (await req(`/api/salary-records/travel-defaults?userId=${userId}&currency=${currency}`, actor)).travel;
const remove = async record => req(`/api/salary-records/${record.id}?updatedAt=${encodeURIComponent(record.updatedAt)}`, owner, 'DELETE');

let saved = await create(owner);
equal(saved.status, 1, 'saving does not submit or change approval state');
equal(await defaults(owner), { travelStart: '新宿', travelEnd: '中野', travelFee: 381 }, 'saved draft immediately supplies all three fields');
equal(await defaults(admin, 'JPY', owner.id), await defaults(owner), 'admin proxy form reads target employee defaults');
const history = (await req(`/api/salary-records/${saved.id}/history`, owner)).history;
equal(history.some(h => h.action === 'salary.submit'), false, 'default is available without a submission event');

saved = (await req('/api/salary-records/' + saved.id, owner, 'PATCH', { ...saved, travelFee: 482, travelEnd: '高田马场' })).record;
equal((await defaults(owner)).travelFee, 482, 'editing and saving an unsubmitted record changes next default');
await req('/api/salary-records/' + saved.id, owner, 'PATCH', { ...saved, travelFee: 'not-a-number' }, 400);
equal((await defaults(owner)).travelFee, 482, 'failed validation cannot replace default');
await create(owner, { includeTravel: false, travelFee: 9999 });
equal((await defaults(owner)).travelFee, 482, 'unchecked travel does not overwrite last included travel');
await create(owner, { currency: 'CNY', travelFee: 17, travelStart: '虹桥', travelEnd: '徐汇' });
equal((await defaults(owner, 'CNY')).travelFee, 17, 'CNY saved draft has its own value');
equal((await defaults(owner)).travelFee, 482, 'CNY save does not overwrite JPY');
await create(other, { travelFee: 812 });
equal((await defaults(owner)).travelFee, 482, 'another employee cannot change these defaults');
await req('/api/salary-records/travel-defaults?userId=' + owner.id, other, 'GET', undefined, 403);
await req('/api/salary-records/travel-defaults?userId=' + owner.id, reviewer, 'GET', undefined, 403);

const zero = await create(owner, { travelFee: 0 });
equal((await defaults(owner)).travelFee, 0, 'explicit saved zero is remembered');
await remove(zero);
equal((await defaults(owner)).travelFee, 482, 'deleting a draft falls back to previous saved value');
const proxy = (await req('/api/staff/payroll/records', admin, 'POST', {
  targetUserId: owner.id, record: make(owner, { travelFee: 593 }), submit: false,
}, 201)).record;
equal(proxy.status, 1, 'proxy saved draft remains unsubmitted');
equal((await defaults(owner)).travelFee, 593, 'admin proxy save also supplies employee default');
const batch = (await req('/api/staff/payroll/batches', owner, 'POST', {
  requestId: 'batch-request-' + randomUUID(), targetUserId: owner.id, month, mode: 'calendar', submit: false,
  template: make(owner, { travelFee: 604 }), calendarSessions: [{ workDate: month + '-04', startTime: '10:00', endTime: '11:00', restHours: 0 }],
}, 201)).records;
equal(batch.every(r => r.status === 1), true, 'self batch can remain unsubmitted');
equal((await defaults(owner)).travelFee, 604, 'self batch saved draft supplies travel default');
for (const record of batch) await remove(record);
equal((await defaults(owner)).travelFee, 593, 'removed batch cannot remain a default');
console.log(JSON.stringify({ result: 'PASS', checks, base, month }));
