import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createEmptyProfile, createRecord, currentMonth, profileMissingRequirements } from '../app/lib/payroll.ts';

let checks = 0;
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const modal = source('app/components/RecordDetailsButton.tsx');
equal(/createPortal\(<RecordDetails[\s\S]*?document\.body/.test(modal), true, 'record dialog is portalled outside all tables');
equal(modal.includes("document.body.style.overflow = 'hidden'"), true, 'background scrolling is locked while dialog is open');
equal(modal.includes('document.body.style.overflow = previousOverflow'), true, 'background scroll setting is restored on close');
equal(source('app/components/ReviewTable.tsx').includes('<RecordHistoryContent'), true, 'review table keeps inline details');
const css = source('app/globals.css');
equal(/\.record-detail-body\s*\{[^}]*min-height: 0;[^}]*overflow-y: auto;/.test(css), true, 'modal body independently scrolls');
const editor = source('app/components/ProfileEditor.tsx');
equal(editor.includes('<Field label="银行卡/支付宝账户截图（需核对推荐上传）">'), true, 'receipt attachment has no required marker');
equal(editor.includes('<Field label="My Number 番号（推荐填写）">'), true, 'My Number is recommended, not required');
const profile = { ...createEmptyProfile(), lastNameCn: '测试', firstNameCn: '资料', address: '测试地址', tel: '000-0000-0000',
  birthday: '1990-01-01', idType: 'my-number', myNumber: '', bankType: 'jp-bank', bankName: '测试银行',
  bankAccountNumber: '1234567', bankAccountHolder: 'TEST ONLY', bankFileNames: [] };
equal(profileMissingRequirements(profile), [], 'complete profile needs neither My Number nor payment attachments');
equal(profileMissingRequirements({ ...profile, bankAccountNumber: '' }).includes('收款账号'), true, 'payment number remains required');
equal(profileMissingRequirements({ ...profile, bankFileNames: ['a', 'b', 'c'] }).length > 0, true, 'more than two receipt attachments remains invalid');
if (!process.env.PAYROLL_TEST_BASE_URL) {
  console.log(JSON.stringify({ result: 'PASS', checks, mode: 'static' }));
  process.exit(0);
}
const fixture = JSON.parse(readFileSync('.local/permissions-qa-accounts.json', 'utf8'));
const base = process.env.PAYROLL_TEST_BASE_URL;
if (fixture.base !== base || !['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Use the same isolated local permission fixture database.');
async function req(path, actor, method = 'GET', body, expected = 200) {
  if (method === 'PATCH' && path === `/api/users/${actor?.id}`) body = { ...body, expectedProfileVersion: actor.profileVersion };
  const response = await fetch(base + path, { method, headers: { origin: base,
    ...(actor?.cookie ? { cookie: actor.cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
  if (data.account?.id === actor?.id) actor.profileVersion = data.account.profileVersion;
  return { ...data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const admin = fixture.accounts[0];
Object.assign(admin, await req('/api/users/login', null, 'POST', { email: admin.email,
  passwordDigest: createHash('sha256').update(admin.password).digest('hex') }));
const registered = await req('/api/users', null, 'POST', { email: `profile-${randomUUID()}@example.invalid`,
  passwordDigest: createHash('sha256').update('Profile-Only-2026!Aa9').digest('hex') }, 201);
const owner = { ...registered.account, cookie: registered.cookie };
let saved = await req(`/api/users/${owner.id}`, owner, 'PATCH', { profile });
equal(saved.account.profile.idType, 'my-number', 'server retains My Number Card');
equal(saved.account.profile.myNumber, '', 'blank My Number saves');
equal(saved.account.profile.bankFileNames, [], 'empty payment attachments save');
for (const idType of ['passport', 'residence', 'china-id', 'my-number']) {
  saved = await req(`/api/users/${owner.id}`, owner, 'PATCH', { profile: { ...profile, idType, myNumber: '000000000000' } });
  equal(saved.account.profile.idType, idType, 'existing and new document types round-trip');
}
equal(saved.account.profile.myNumber, '000000000000', 'optional number persists when provided');
await req(`/api/users/${owner.id}`, owner, 'PATCH', { profile: { ...profile, bankFileNames: ['one', 'two', 'three'] } }, 400);
const other = fixture.accounts[4];
const otherLogin = await req('/api/users/login', null, 'POST', { email: other.email,
  passwordDigest: createHash('sha256').update(other.password).digest('hex') });
const foreignKey = otherLogin.account.profile.bankFileNames[0];
equal(Boolean(foreignKey), true, 'fixture supplies another employee attachment for ownership validation');
await req(`/api/users/${owner.id}`, owner, 'PATCH', { profile: { ...profile, bankFileNames: [foreignKey] } }, 400);
await req(`/api/users/${owner.id}`, owner, 'PATCH', { profile });
const options = await req('/api/payroll-options', owner);
const manager = options.workManagers.find(m => m.id === admin.id) ?? options.workManagers[0];
const month = currentMonth();
const make = () => ({ ...createRecord(owner.id), id: 'salary-profile-' + randomUUID(), workDate: month + '-03',
  checkUserId: manager.id, checkUser: manager.label, departmentKey: 'dept-teaching', departmentLabel: '教学部',
  applyType: 2, rate: 1000, amount: 1, workContent: '选填资料回归测试', memo: '仅独立本地测试' });
const draft = (await req('/api/salary-records', owner, 'POST', make(), 201)).record;
await req(`/api/salary-records/apply/${owner.id}`, owner, 'POST', { month });
equal((await req(`/api/salary-records/${draft.id}/history`, owner)).record.status, 2, 'self salary can submit with no screenshot or My Number');
const proxy = (await req('/api/staff/payroll/records', admin, 'POST', { targetUserId: owner.id, record: make(), submit: true }, 201)).record;
equal(proxy.status, 2, 'admin proxy submission also accepts optional receipt');
const batch = await req('/api/staff/payroll/batches', owner, 'POST', {
  requestId: 'batch-request-' + randomUUID(), targetUserId: owner.id, month, mode: 'calendar', submit: true,
  template: make(), calendarSessions: [{ workDate: month + '-04', startTime: '10:00', endTime: '11:00', restHours: 0 }],
}, 201);
equal(batch.records.every(r => r.status === 2), true, 'self batch submission also accepts optional receipt');
console.log(JSON.stringify({ result: 'PASS', checks, base }));
