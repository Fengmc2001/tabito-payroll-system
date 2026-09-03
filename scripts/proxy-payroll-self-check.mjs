import { createHash, randomUUID } from 'node:crypto';

const baseUrl = process.env.PAYROLL_TEST_BASE_URL || 'http://localhost:3000';
const adminEmail = 'TabitoAdimin01@tabitoedu.com';
const adminPassword = process.env.PAYROLL_TEST_ADMIN_PASSWORD;
const bootstrapSecret = process.env.PAYROLL_TEST_BOOTSTRAP_SECRET;

if (!adminPassword) {
  throw new Error('Set PAYROLL_TEST_ADMIN_PASSWORD before running this check.');
}
if (!bootstrapSecret) throw new Error('Set PAYROLL_TEST_BOOTSTRAP_SECRET before running this check.');

const testUrl = new URL(baseUrl);
if (!['localhost', '127.0.0.1', '::1'].includes(testUrl.hostname)
  && process.env.PAYROLL_ALLOW_REMOTE_TEST !== '1') {
  throw new Error('This destructive fixture check only runs on localhost. Set PAYROLL_ALLOW_REMOTE_TEST=1 for an isolated remote test environment.');
}

const checks = [];
const unique = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const singleMonth = '2030-04';
const batchMonth = '2030-05';
const limitBatchMonth = '2032-01';
const recurringStartMonth = '2031-01';
const recurringNextMonth = '2031-02';
const recurringPausedMonth = '2031-03';

await expect('/api/staff/payroll/users', 401, 'anonymous user cannot open delegated-payroll account list');

const bootstrap = await request('/api/bootstrap-status');
expectStatus(bootstrap, 200, 'bootstrap state is readable');
let adminSession;
if (bootstrap.data.bootstrap.bootstrapRequired) {
  adminSession = await request('/api/users', {
    method: 'POST',
    body: { email: `ignored-${unique}@example.invalid`, passwordDigest: digest(adminPassword), bootstrapSecret },
  });
  expectStatus(adminSession, 201, 'empty test database creates the fixed administrator');
} else {
  adminSession = await request('/api/users/login', {
    method: 'POST',
    body: { email: adminEmail, passwordDigest: digest(adminPassword) },
  });
  expectStatus(adminSession, 200, 'existing test administrator can log in');
}
const adminCookie = cookieFrom(adminSession);
let admin = adminSession.data.account;
assert(admin.role === 'admin', 'bootstrap account has administrator role');
admin = await saveBasicProfile(admin, adminCookie, '回归', '管理员');

await expect('/api/admin/settings', 200, 'administrator can keep test registration open', {
  method: 'PATCH',
  cookie: adminCookie,
  body: { registrationOpen: true },
});
const managerUpdate = await patchManagedUser(admin.id, adminCookie, { workManager: true });
expectStatus(managerUpdate, 200, 'administrator can act as a work manager in test records');

const reviewerSession = await registerAccount(`proxy-reviewer-${unique}@example.invalid`, 'Proxy-Reviewer-2026!');
let reviewer = await saveBasicProfile(reviewerSession.account, reviewerSession.cookie, '回归', '审核员');
const reviewerPromotion = await patchManagedUser(reviewer.id, adminCookie, { role: 'reviewer', workManager: true });
expectStatus(reviewerPromotion, 200, 'administrator grants reviewer and work-manager permissions');
assert(reviewerPromotion.data.user.role === 'reviewer', 'reviewer permission is active without a new login');

const targetASession = await registerAccount(`proxy-target-a-${unique}@example.invalid`, 'Proxy-Target-A-2026!');
const targetA = await completePayrollProfile(targetASession.account, targetASession.cookie, '代报', '甲');
const targetBSession = await registerAccount(`proxy-target-b-${unique}@example.invalid`, 'Proxy-Target-B-2026!');
const targetB = await completePayrollProfile(targetBSession.account, targetBSession.cookie, '代报', '乙');
const employeeSession = await registerAccount(`proxy-employee-${unique}@example.invalid`, 'Proxy-Employee-2026!');
const employee = await saveBasicProfile(employeeSession.account, employeeSession.cookie, '普通', '员工');

const adminUsers = await request('/api/staff/payroll/users', { cookie: adminCookie });
expectStatus(adminUsers, 200, 'administrator can list delegated-payroll targets');
assert(adminUsers.data.users.some((user) => user.id === targetA.id && user.profileReady), 'administrator sees a payroll-ready target');
const reviewerUsers = await request('/api/staff/payroll/users', { cookie: reviewerSession.cookie });
expectStatus(reviewerUsers, 200, 'reviewer can list delegated-payroll targets');
assert(reviewerUsers.data.users.some((user) => user.id === targetB.id), 'reviewer sees the second payroll target');
await expect('/api/admin/users', 403, 'reviewer still cannot use administrator-only account APIs', {
  cookie: reviewerSession.cookie,
});

const ownEmployeeRecord = makeSalaryRecord({
  userId: employee.id,
  managerId: admin.id,
  workDate: `${singleMonth}-04`,
  currency: 'JPY',
  rate: 3100,
  workContent: '普通员工本人草稿',
});
const ownEmployeeCreate = await request('/api/salary-records', {
  method: 'POST',
  cookie: employeeSession.cookie,
  body: ownEmployeeRecord,
});
expectStatus(ownEmployeeCreate, 201, 'ordinary employee retains legitimate self-service draft creation');
assert(ownEmployeeCreate.data.record.userId === employee.id && ownEmployeeCreate.data.record.source === 'self', 'ordinary employee draft belongs to self');

const targetAExistingDraft = makeSalaryRecord({
  userId: targetA.id,
  managerId: admin.id,
  workDate: `${singleMonth}-01`,
  currency: 'JPY',
  rate: 4100,
  workContent: '甲已存在的本人草稿',
});
const targetAOwnCreate = await request('/api/salary-records', {
  method: 'POST',
  cookie: targetASession.cookie,
  body: targetAExistingDraft,
});
expectStatus(targetAOwnCreate, 201, 'target employee can prepare an existing self-service draft');

const proxyAttachment = await uploadPdf(
  `/api/staff/payroll/uploads/${targetA.id}`,
  adminCookie,
  'admin-proxy-attachment.pdf',
  'administrator delegated attachment',
);
assert(proxyAttachment.key.startsWith(`payroll/${targetA.id}/`), 'privileged upload is stored under the target employee owner path');
await expect(`/api/files?key=${encodeURIComponent(proxyAttachment.key)}`, 200, 'target employee can read an attachment uploaded on their behalf', {
  cookie: targetASession.cookie,
  raw: true,
});
await expect(`/api/files?key=${encodeURIComponent(proxyAttachment.key)}`, 200, 'reviewer can read another employee attachment', {
  cookie: reviewerSession.cookie,
  raw: true,
});
await expect(`/api/files?key=${encodeURIComponent(proxyAttachment.key)}`, 403, 'unrelated ordinary employee cannot read delegated attachment', {
  cookie: employeeSession.cookie,
  raw: true,
});

const adminCnyRecord = makeSalaryRecord({
  userId: targetA.id,
  managerId: admin.id,
  workDate: `${singleMonth}-02`,
  currency: 'CNY',
  rate: 8800,
  workContent: '管理员代报人民币',
  attachments: [proxyAttachment.key],
});
const adminDirectSubmit = await request('/api/staff/payroll/records', {
  method: 'POST',
  cookie: adminCookie,
  body: { targetUserId: targetA.id, record: adminCnyRecord, submit: true },
});
expectStatus(adminDirectSubmit, 201, 'administrator can create and immediately submit one delegated record');
const submittedCny = adminDirectSubmit.data.record;
assert(submittedCny.status === 2 && submittedCny.currency === 'CNY' && submittedCny.finalSalary === 8800, 'administrator delegated CNY record is pending with authoritative amount');
assert(submittedCny.source === 'proxy-single', 'single delegated record stores proxy-single provenance');
assert(submittedCny.createdByUserId === admin.id && submittedCny.submittedByUserId === admin.id, 'single delegated record stores the real administrator actor');

const targetARecords = await request(`/api/staff/payroll/records?userId=${targetA.id}&month=${singleMonth}`, {
  cookie: adminCookie,
});
expectStatus(targetARecords, 200, 'administrator can read all statuses for a target month');
assert(targetARecords.data.records.some((record) => record.id === targetAExistingDraft.id && record.status === 1), 'immediate delegated submission does not submit an existing employee draft');
assert(targetARecords.data.records.some((record) => record.id === submittedCny.id && record.status === 2), 'immediate delegated submission submits only the newly created record');

const crossOwnerRecord = makeSalaryRecord({
  userId: targetB.id,
  managerId: admin.id,
  workDate: `${singleMonth}-05`,
  currency: 'JPY',
  rate: 5000,
  workContent: '跨账号附件应被拒绝',
  attachments: [proxyAttachment.key],
});
await expect('/api/staff/payroll/records', 400, 'delegated record cannot attach a file owned by another employee', {
  method: 'POST',
  cookie: adminCookie,
  body: { targetUserId: targetB.id, record: crossOwnerRecord, submit: false },
});

const reviewerJpyDraft = makeSalaryRecord({
  userId: targetB.id,
  managerId: reviewer.id,
  workDate: `${singleMonth}-03`,
  currency: 'JPY',
  rate: 6600,
  workContent: '审核员代报日元',
});
const reviewerDraftCreate = await request('/api/staff/payroll/records', {
  method: 'POST',
  cookie: reviewerSession.cookie,
  body: { targetUserId: targetB.id, record: reviewerJpyDraft, submit: false },
});
expectStatus(reviewerDraftCreate, 201, 'reviewer can create a delegated draft');
assert(reviewerDraftCreate.data.record.status === 1, 'reviewer delegated draft remains unsubmitted');
const reviewerDraftUpdate = await request(`/api/staff/payroll/records/${reviewerJpyDraft.id}`, {
  method: 'PATCH',
  cookie: reviewerSession.cookie,
  body: {
    targetUserId: targetB.id,
    record: {
      ...reviewerDraftCreate.data.record,
      workContent: '审核员代报日元（新版草稿）',
    },
    submit: false,
  },
});
expectStatus(reviewerDraftUpdate, 200, 'a current delegated draft version can be updated');
await expect(`/api/staff/payroll/records/${reviewerJpyDraft.id}`, 409, 'an older delegated-payroll page cannot overwrite a newer draft edit', {
  method: 'PATCH',
  cookie: reviewerSession.cookie,
  body: {
    targetUserId: targetB.id,
    record: {
      ...reviewerDraftCreate.data.record,
      workContent: 'stale delegated draft overwrite must not persist',
      rate: 1,
    },
    submit: false,
  },
});
const afterDelegatedDraftConflict = await proxyRecords(reviewerSession.cookie, targetB.id, singleMonth);
const preservedDelegatedDraft = afterDelegatedDraftConflict.find((record) => record.id === reviewerJpyDraft.id);
assert(preservedDelegatedDraft?.workContent === reviewerDraftUpdate.data.record.workContent
  && preservedDelegatedDraft?.finalSalary === reviewerDraftUpdate.data.record.finalSalary,
  'newer delegated draft content survives an old-page overwrite attempt');
const reviewerSubmit = await request(`/api/staff/payroll/records/${reviewerJpyDraft.id}`, {
  method: 'PATCH',
  cookie: reviewerSession.cookie,
  body: { targetUserId: targetB.id, record: reviewerDraftUpdate.data.record, submit: true },
});
expectStatus(reviewerSubmit, 200, 'reviewer can submit only the selected delegated draft');
const submittedJpy = reviewerSubmit.data.record;
assert(submittedJpy.status === 2 && submittedJpy.currency === 'JPY' && submittedJpy.finalSalary === 6600, 'reviewer delegated JPY record is pending with authoritative amount');
assert(submittedJpy.createdByUserId === reviewer.id && submittedJpy.submittedByUserId === reviewer.id, 'reviewer identity is stored for creation and submission');
await expect(`/api/staff/payroll/records/${reviewerJpyDraft.id}`, 409, 'a stale delegated draft cannot reopen a record after submission', {
  method: 'PATCH',
  cookie: reviewerSession.cookie,
  body: {
    targetUserId: targetB.id,
    record: {
      ...reviewerDraftUpdate.data.record,
      status: 1,
      workContent: 'stale delegated overwrite must not persist',
      rate: 1,
    },
    submit: false,
  },
});
await expect(`/api/staff/payroll/records/${reviewerJpyDraft.id}?userId=${targetB.id}&updatedAt=${encodeURIComponent(reviewerDraftUpdate.data.record.updatedAt)}`, 409, 'a stale delegated delete cannot remove a submitted record', {
  method: 'DELETE',
  cookie: reviewerSession.cookie,
});
const afterStaleDelegatedMutation = await proxyRecords(reviewerSession.cookie, targetB.id, singleMonth);
const preservedDelegatedRecord = afterStaleDelegatedMutation.find((record) => record.id === reviewerJpyDraft.id);
assert(preservedDelegatedRecord?.status === 2, 'stale delegated mutation cannot move a submitted record back to draft or delete it');
assert(preservedDelegatedRecord?.workContent === reviewerDraftUpdate.data.record.workContent
  && preservedDelegatedRecord?.finalSalary === reviewerDraftUpdate.data.record.finalSalary,
  'stale delegated mutation cannot overwrite submitted salary content');

const invalidBatchRequestId = `batch-request-${unique}-atomic`;
const recordsBeforeInvalidBatch = await proxyRecords(reviewerSession.cookie, targetB.id, batchMonth);
const invalidBatch = makeBatch({
  requestId: invalidBatchRequestId,
  targetUserId: targetB.id,
  managerId: reviewer.id,
  month: batchMonth,
  currency: 'CNY',
  rate: 1200,
  sessions: [
    { workDate: `${batchMonth}-10`, startTime: '', endTime: '', restHours: 0 },
    { workDate: '2030-06-01', startTime: '', endTime: '', restHours: 0 },
  ],
});
await expect('/api/staff/payroll/batches', 400, 'batch rejects a schedule containing one out-of-month session', {
  method: 'POST',
  cookie: reviewerSession.cookie,
  body: invalidBatch,
});
const recordsAfterInvalidBatch = await proxyRecords(reviewerSession.cookie, targetB.id, batchMonth);
assert(recordsAfterInvalidBatch.length === recordsBeforeInvalidBatch.length, 'failed batch is atomic and leaves no partial records');

const validBatch = {
  ...invalidBatch,
  calendarSessions: [
    { workDate: `${batchMonth}-10`, startTime: '', endTime: '', restHours: 0 },
    { workDate: `${batchMonth}-11`, startTime: '', endTime: '', restHours: 0 },
  ],
};
const firstBatch = await request('/api/staff/payroll/batches', {
  method: 'POST',
  cookie: reviewerSession.cookie,
  body: validBatch,
});
expectStatus(firstBatch, 201, 'same requestId can be retried after an atomic validation failure');
assert(firstBatch.data.replayed === false && firstBatch.data.records.length === 2, 'valid CNY batch creates exactly two records');
assert(firstBatch.data.records.every((record) => record.status === 2 && record.currency === 'CNY' && record.finalSalary === 1200), 'valid batch preserves CNY and submits each new record');
assert(firstBatch.data.records.every((record) => record.source === 'proxy-batch' && record.createdByUserId === reviewer.id), 'batch records store reviewer provenance');
const firstBatchIds = firstBatch.data.records.map((record) => record.id).sort();

const replayBatch = await request('/api/staff/payroll/batches', {
  method: 'POST',
  cookie: reviewerSession.cookie,
  body: {
    ...validBatch,
    template: {
      ...validBatch.template,
      id: `salary-${unique}-reconstructed-retry`,
      status: 4,
      createdAt: '2099-01-01T00:00:00.000Z',
      updatedAt: '2099-01-01T00:00:00.000Z',
    },
  },
});
expectStatus(replayBatch, 201, 'repeating an accepted batch request is handled idempotently');
assert(replayBatch.data.replayed === true, 'repeated requestId is explicitly reported as a replay');
assert(JSON.stringify(replayBatch.data.records.map((record) => record.id).sort()) === JSON.stringify(firstBatchIds), 'idempotent replay returns the original record IDs');
const recordsAfterReplay = await proxyRecords(reviewerSession.cookie, targetB.id, batchMonth);
assert(recordsAfterReplay.length === recordsBeforeInvalidBatch.length + 2, 'idempotent replay does not add duplicate records');
await expect('/api/staff/payroll/batches', 409, 'same requestId with changed payload is rejected instead of replaying stale data', {
  method: 'POST',
  cookie: reviewerSession.cookie,
  body: { ...validBatch, calendarSessions: [...validBatch.calendarSessions, {
    workDate: `${batchMonth}-12`, startTime: '', endTime: '', restHours: 0,
  }] },
});
await expect('/api/staff/payroll/batches', 409, 'another actor cannot reuse an accepted batch requestId', {
  method: 'POST',
  cookie: adminCookie,
  body: validBatch,
});

const limitSessions = Array.from({ length: 31 }, (_, index) => String(index + 1).padStart(2, '0'))
  .flatMap((day) => [
    { workDate: `${limitBatchMonth}-${day}`, startTime: '00:00', endTime: '00:01', restHours: 0 },
    { workDate: `${limitBatchMonth}-${day}`, startTime: '00:01', endTime: '00:02', restHours: 0 },
  ]);
const limitBatch = makeBatch({
  requestId: `batch-request-${unique}-d1-limit`,
  targetUserId: targetB.id,
  managerId: reviewer.id,
  month: limitBatchMonth,
  currency: 'JPY',
  rate: 77,
  sessions: limitSessions,
});
const limitBatchCreate = await request('/api/staff/payroll/batches', {
  method: 'POST', cookie: reviewerSession.cookie, body: limitBatch,
});
expectStatus(limitBatchCreate, 201, 'maximum-size 62-record batch stays within D1 query and binding limits');
assert(limitBatchCreate.data.records.length === 62, 'maximum-size batch creates all 62 records atomically');
const limitBatchReplay = await request('/api/staff/payroll/batches', {
  method: 'POST', cookie: reviewerSession.cookie, body: limitBatch,
});
expectStatus(limitBatchReplay, 201, 'maximum-size batch can be replayed with one bulk lookup');
assert(limitBatchReplay.data.replayed === true && limitBatchReplay.data.records.length === 62,
  'maximum-size replay returns the complete original batch without duplicates');

const recurringRequestId = `batch-request-${unique}-recurring`;
const recurringBatch = {
  requestId: recurringRequestId,
  targetUserId: targetB.id,
  month: recurringStartMonth,
  mode: 'fixed',
  submit: true,
  template: makeSalaryRecord({
    userId: targetB.id,
    managerId: reviewer.id,
    workDate: `${recurringStartMonth}-01`,
    currency: 'JPY',
    rate: 2000,
    applyType: 1,
    startTime: '09:00',
    endTime: '10:30',
    restHours: 0.25,
    workContent: '每月固定授课',
  }),
  fixedSchedule: {
    rangeStart: `${recurringStartMonth}-01`,
    rangeEnd: `${recurringStartMonth}-03`,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    startTime: '09:00',
    endTime: '10:30',
    restHours: 0.25,
  },
  recurring: {
    enabled: true,
    title: `回归固定授课-${unique}`,
    startMonth: recurringStartMonth,
    endMonth: recurringPausedMonth,
  },
};
const recurringCreate = await request('/api/staff/payroll/batches', {
  method: 'POST',
  cookie: reviewerSession.cookie,
  body: recurringBatch,
});
expectStatus(recurringCreate, 201, 'reviewer can create a fixed schedule and recurring rule');
assert(recurringCreate.data.records.length === 3 && recurringCreate.data.rule, 'initial recurring batch contains three records and one rule');
assert(recurringCreate.data.rule.submit === true, 'recurring rule remembers that generated records should be submitted');
assert(recurringCreate.data.records.every((record) => record.finalSalary === 2500 && record.currency === 'JPY'), 'fixed hourly schedule deducts break time and keeps JPY');
const recurringRule = recurringCreate.data.rule;

const otherTargetRecurringBatch = {
  ...recurringBatch,
  requestId: `batch-request-${unique}-recurring-other-target`,
  targetUserId: targetA.id,
  submit: false,
  template: {
    ...recurringBatch.template,
    id: randomUUID(),
    userId: targetA.id,
    finalSalary: 3750,
  },
  recurring: {
    ...recurringBatch.recurring,
    title: `其他员工固定授课-${unique}`,
  },
};
const otherTargetRecurringCreate = await request('/api/staff/payroll/batches', {
  method: 'POST',
  cookie: adminCookie,
  body: otherTargetRecurringBatch,
});
expectStatus(otherTargetRecurringCreate, 201, 'administrator can create a second employee recurring rule');
const otherTargetRecurringRule = otherTargetRecurringCreate.data.rule;
assert(otherTargetRecurringRule.submit === false, 'draft recurring rule remembers that generated records should remain unsubmitted');

const reviewerRules = await request(`/api/staff/payroll/rules?userId=${targetB.id}`, {
  cookie: reviewerSession.cookie,
});
expectStatus(reviewerRules, 200, 'reviewer can list recurring rules for one employee');
assert(reviewerRules.data.rules.some((rule) => rule.id === recurringRule.id && rule.active), 'new recurring rule is active and visible');
const adminRules = await request('/api/staff/payroll/rules', { cookie: adminCookie });
expectStatus(adminRules, 200, 'administrator can list all recurring rules');
assert(adminRules.data.rules.some((rule) => rule.id === recurringRule.id), 'administrator sees reviewer-created recurring rule');

const firstRuleRun = await request('/api/staff/payroll/rules/run', {
  method: 'POST',
  cookie: reviewerSession.cookie,
  body: { month: recurringNextMonth, targetUserId: targetB.id },
});
expectStatus(firstRuleRun, 200, 'reviewer can manually run due recurring rules for a month');
assert(firstRuleRun.data.generatedRules === 1 && firstRuleRun.data.generatedRecords === 3, 'targeted future-month run generates only the selected employee rule');
const nextMonthRecords = await proxyRecords(reviewerSession.cookie, targetB.id, recurringNextMonth);
const generatedByRule = nextMonthRecords.filter((record) => record.recurringRuleId === recurringRule.id);
assert(generatedByRule.length === 3, 'future month contains exactly three records from the tested rule');
assert(generatedByRule.every((record) => record.source === 'recurring' && record.status === 2), 'automatically generated records are marked recurring and pending');
assert(generatedByRule.every((record) => record.submittedByUserId === reviewer.id && record.submittedByName === '回归审核员'), 'manual recurring run records the reviewer who triggered submission');
assert(generatedByRule.every((record) => record.currency === 'JPY' && record.finalSalary === 2500), 'automatically generated records preserve JPY template calculation');
const otherTargetBeforeGlobalRun = await proxyRecords(adminCookie, targetA.id, recurringNextMonth);
assert(!otherTargetBeforeGlobalRun.some((record) => record.recurringRuleId === otherTargetRecurringRule.id), 'targeted manual run does not generate another employee records');

const secondRuleRun = await request('/api/staff/payroll/rules/run', {
  method: 'POST',
  cookie: adminCookie,
  body: { month: recurringNextMonth },
});
expectStatus(secondRuleRun, 200, 'administrator can repeat the same recurring-rule month safely');
const afterSecondRuleRun = await proxyRecords(adminCookie, targetB.id, recurringNextMonth);
assert(afterSecondRuleRun.filter((record) => record.recurringRuleId === recurringRule.id).length === 3, 'same-month recurring generation is idempotent and creates no duplicate records');
assert(secondRuleRun.data.skippedRules >= 1, 'same-month recurring rerun reports the existing instance as skipped');
const otherTargetAfterGlobalRun = await proxyRecords(adminCookie, targetA.id, recurringNextMonth);
const generatedDrafts = otherTargetAfterGlobalRun.filter((record) => record.recurringRuleId === otherTargetRecurringRule.id);
assert(generatedDrafts.length === 3 && generatedDrafts.every((record) => record.status === 1), 'draft recurring rule keeps next-month generated records unsubmitted');

await assertEmployeeForbiddenMatrix({
  employeeCookie: employeeSession.cookie,
  target: targetA,
  record: submittedCny,
  batch: validBatch,
  rule: recurringRule,
});

const rulesBeforePause = await request(`/api/staff/payroll/rules?userId=${targetB.id}`, {
  cookie: reviewerSession.cookie,
});
expectStatus(rulesBeforePause, 200, 'reviewer can refresh the recurring rule before editing it');
const currentRecurringRule = rulesBeforePause.data.rules.find((rule) => rule.id === recurringRule.id);
assert(currentRecurringRule, 'the recurring rule remains available before pause');
const pauseRule = await request(`/api/staff/payroll/rules/${recurringRule.id}`, {
  method: 'PATCH',
  cookie: reviewerSession.cookie,
  body: { active: false, title: `${currentRecurringRule.title}-已暂停`, expectedUpdatedAt: currentRecurringRule.updatedAt },
});
expectStatus(pauseRule, 200, 'reviewer can pause and rename a recurring rule');
assert(pauseRule.data.rule.active === false, 'paused recurring rule reports inactive state');
await expect(`/api/staff/payroll/rules/${recurringRule.id}`, 409, 'an old recurring-rule page cannot overwrite a newer pause', {
  method: 'PATCH',
  cookie: reviewerSession.cookie,
  body: { active: true, expectedUpdatedAt: recurringRule.updatedAt },
});
await expect('/api/staff/payroll/rules/run', 200, 'administrator can run a month while the tested rule is paused', {
  method: 'POST',
  cookie: adminCookie,
  body: { month: recurringPausedMonth },
});
const pausedMonthRecords = await proxyRecords(adminCookie, targetB.id, recurringPausedMonth);
assert(!pausedMonthRecords.some((record) => record.recurringRuleId === recurringRule.id), 'paused rule generates no records in a later month');
const reactivateRule = await request(`/api/staff/payroll/rules/${recurringRule.id}`, {
  method: 'PATCH',
  cookie: reviewerSession.cookie,
  body: { active: true, expectedUpdatedAt: pauseRule.data.rule.updatedAt },
});
expectStatus(reactivateRule, 200, 'reviewer can reactivate a recurring rule');
await expect(`/api/staff/payroll/rules/${recurringRule.id}`, 200, 'reviewer can delete a recurring rule', {
  method: 'DELETE',
  cookie: reviewerSession.cookie,
  body: { expectedUpdatedAt: reactivateRule.data.rule.updatedAt },
});
const rulesAfterDelete = await request(`/api/staff/payroll/rules?userId=${targetB.id}`, {
  cookie: reviewerSession.cookie,
});
expectStatus(rulesAfterDelete, 200, 'recurring rule list remains readable after deletion');
assert(!rulesAfterDelete.data.rules.some((rule) => rule.id === recurringRule.id), 'deleted recurring rule no longer appears in active rule list');

const adminApprovesOwnDelegatedRecord = await request(`/api/review/salary-records/${submittedCny.id}`, {
  method: 'PATCH',
  cookie: adminCookie,
  body: { decision: 'approve', auditMemo: 'CNY self-approval regression approved' },
});
expectStatus(adminApprovesOwnDelegatedRecord, 200, 'administrator can approve a record they created and submitted for another employee');
assert(adminApprovesOwnDelegatedRecord.data.record.currency === 'CNY' && adminApprovesOwnDelegatedRecord.data.record.status === 3, 'CNY remains explicit after administrator self-approval');
const reviewerApprovesOwnDelegatedRecord = await request(`/api/review/salary-records/${submittedJpy.id}`, {
  method: 'PATCH',
  cookie: reviewerSession.cookie,
  body: { decision: 'approve', auditMemo: 'JPY self-approval regression approved' },
});
expectStatus(reviewerApprovesOwnDelegatedRecord, 200, 'reviewer can approve a record they created and submitted for another employee');
assert(reviewerApprovesOwnDelegatedRecord.data.record.currency === 'JPY' && reviewerApprovesOwnDelegatedRecord.data.record.status === 3, 'JPY remains explicit after reviewer self-approval');

const audit = await request('/api/admin/audit-logs?limit=200', { cookie: adminCookie });
expectStatus(audit, 200, 'administrator can inspect delegated-payroll audit trail');
assertAudit(audit.data.logs, {
  action: 'file.upload_privileged',
  actorUserId: admin.id,
  subjectUserId: targetA.id,
}, 'privileged attachment audit separates administrator actor and employee subject');
assertAudit(audit.data.logs, {
  action: 'salary.proxy_submit',
  actorUserId: admin.id,
  targetId: submittedCny.id,
  subjectUserId: targetA.id,
  businessMonth: singleMonth,
}, 'direct delegated-submit audit stores actor, subject, and business month');
assertAudit(audit.data.logs, {
  action: 'salary.proxy_submit',
  actorUserId: reviewer.id,
  targetId: submittedJpy.id,
  subjectUserId: targetB.id,
  businessMonth: singleMonth,
}, 'reviewer delegated-submit audit stores actor, subject, and business month');
assertAudit(audit.data.logs, {
  action: 'salary.proxy_batch_submit',
  actorUserId: reviewer.id,
  subjectUserId: targetB.id,
  businessMonth: batchMonth,
}, 'batch audit stores reviewer actor, employee subject, and business month');
assertAudit(audit.data.logs, {
  action: 'salary.rule_generate',
  actorUserId: reviewer.id,
  targetId: recurringRule.id,
  subjectUserId: targetB.id,
  businessMonth: recurringNextMonth,
}, 'manual rule-generation audit stores reviewer actor, employee subject, and business month');

const accountAudit = await request(`/api/audit/overview?year=2031&month=${recurringNextMonth}&userId=${targetB.id}`, {
  cookie: reviewerSession.cookie,
});
expectStatus(accountAudit, 200, 'reviewer can trace one employee for the generated business month');
assert(accountAudit.data.overview.accountLogs.some((log) => log.action === 'salary.rule_generate'
  && log.targetId === recurringRule.id
  && log.detail.businessMonth === recurringNextMonth), 'account-month audit lookup finds system-generated recurring activity');

process.stdout.write(`${JSON.stringify({ result: 'PASS', checks: checks.length }, null, 2)}\n`);

async function assertEmployeeForbiddenMatrix({ employeeCookie, target, record, batch, rule }) {
  const forbiddenRecord = makeSalaryRecord({
    userId: target.id,
    managerId: admin.id,
    workDate: `${singleMonth}-06`,
    currency: 'JPY',
    rate: 1000,
    workContent: '越权测试',
  });
  await expect('/api/staff/payroll/users', 403, 'ordinary employee cannot list delegated-payroll targets', {
    cookie: employeeCookie,
  });
  await expect(`/api/staff/payroll/records?userId=${target.id}&month=${singleMonth}`, 403, 'ordinary employee cannot read another account delegated records', {
    cookie: employeeCookie,
  });
  await expect('/api/staff/payroll/records', 403, 'ordinary employee cannot create a delegated record', {
    method: 'POST',
    cookie: employeeCookie,
    body: { targetUserId: target.id, record: forbiddenRecord, submit: true },
  });
  await expect(`/api/staff/payroll/records/${record.id}`, 403, 'ordinary employee cannot update a delegated record', {
    method: 'PATCH',
    cookie: employeeCookie,
    body: { targetUserId: target.id, record, submit: false },
  });
  await expect(`/api/staff/payroll/records/${record.id}?userId=${target.id}`, 403, 'ordinary employee cannot delete a delegated record', {
    method: 'DELETE',
    cookie: employeeCookie,
  });
  await expect('/api/staff/payroll/batches', 403, 'ordinary employee cannot create a delegated batch', {
    method: 'POST',
    cookie: employeeCookie,
    body: { ...batch, requestId: `batch-request-${unique}-forbidden` },
  });
  await expect(`/api/staff/payroll/rules?userId=${target.id}`, 403, 'ordinary employee cannot list recurring rules', {
    cookie: employeeCookie,
  });
  await expect(`/api/staff/payroll/rules/${rule.id}`, 403, 'ordinary employee cannot modify a recurring rule', {
    method: 'PATCH',
    cookie: employeeCookie,
    body: { active: false },
  });
  await expect(`/api/staff/payroll/rules/${rule.id}`, 403, 'ordinary employee cannot delete a recurring rule', {
    method: 'DELETE',
    cookie: employeeCookie,
  });
  await expect('/api/staff/payroll/rules/run', 403, 'ordinary employee cannot manually run recurring rules', {
    method: 'POST',
    cookie: employeeCookie,
    body: { month: recurringNextMonth },
  });
  await expect(`/api/staff/payroll/uploads/${target.id}`, 403, 'ordinary employee cannot upload a file for another account', {
    method: 'POST',
    cookie: employeeCookie,
  });
}

async function registerAccount(email, password) {
  const response = await request('/api/users', {
    method: 'POST',
    body: { email, passwordDigest: digest(password) },
  });
  expectStatus(response, 201, `test account registers: ${email}`);
  return { account: response.data.account, cookie: cookieFrom(response) };
}

async function saveBasicProfile(account, cookie, lastName, firstName) {
  const response = await request(`/api/users/${account.id}`, {
    method: 'PATCH',
    cookie,
    body: {
      profile: {
        ...account.profile,
        lastNameCn: lastName,
        firstNameCn: firstName,
        address: `Proxy regression address ${unique}`,
        tel: `090-0000-0000\nproxy-${unique}@example.invalid`,
      },
    },
  });
  expectStatus(response, 200, `mandatory profile is saved for ${lastName}${firstName}`);
  return response.data.account;
}

async function completePayrollProfile(account, cookie, lastName, firstName) {
  const basic = await saveBasicProfile(account, cookie, lastName, firstName);
  const bankFile = await uploadPdf('/api/uploads', cookie, `${lastName}${firstName}-bank.pdf`, 'bank fixture');
  const response = await request(`/api/users/${account.id}`, {
    method: 'PATCH',
    cookie,
    body: {
      profile: {
        ...basic.profile,
        birthday: '1990-01-01',
        idType: 'passport',
        bankType: 'jp-bank',
        bankName: 'Regression Bank',
        bankBranch: '001',
        bankAccountNumber: '1234567',
        bankAccountHolder: `${lastName}${firstName}`,
        bankFileNames: [bankFile.key],
      },
    },
  });
  expectStatus(response, 200, `payroll profile is complete for ${lastName}${firstName}`);
  return response.data.account;
}

async function uploadPdf(path, cookie, name, content) {
  const formData = new FormData();
  formData.set('file', new File(
    [new TextEncoder().encode(`%PDF-1.4\n${content}\n`)],
    name,
    { type: 'application/pdf' },
  ));
  const response = await request(path, { method: 'POST', cookie, formData });
  expectStatus(response, 201, `PDF upload succeeds: ${name}`);
  return response.data.file;
}

function makeSalaryRecord({
  userId,
  managerId,
  workDate,
  currency,
  rate,
  workContent,
  attachments = [],
  applyType = 6,
  startTime = '',
  endTime = '',
  restHours = 0,
}) {
  const timestamp = new Date().toISOString();
  return {
    id: `salary-${randomUUID()}`,
    userId,
    workDate,
    checkUserId: managerId,
    checkUser: 'client label is not authoritative',
    departmentKey: applyType === 1 ? 'dept-teaching' : 'dept-affairs',
    departmentLabel: '',
    currency,
    applyType,
    workContent,
    memo: '',
    rate,
    startTime,
    endTime,
    amount: 0,
    travelStart: '',
    travelEnd: '',
    travelFee: 0,
    totalHours: 0,
    workHours: 0,
    restHours,
    finalSalary: 0,
    attachments,
    status: 1,
    checkDate: null,
    auditMemo: '',
    createdByUserId: userId,
    createdByName: '',
    submittedByUserId: '',
    submittedByName: '',
    source: 'self',
    batchId: null,
    recurringRuleId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function makeBatch({ requestId, targetUserId, managerId, month, currency, rate, sessions }) {
  return {
    requestId,
    targetUserId,
    month,
    mode: 'calendar',
    submit: true,
    template: makeSalaryRecord({
      userId: targetUserId,
      managerId,
      workDate: sessions[0].workDate,
      currency,
      rate,
      workContent: '批量代报回归测试',
    }),
    calendarSessions: sessions,
    recurring: { enabled: false, title: '', startMonth: month, endMonth: '' },
  };
}

async function proxyRecords(cookie, userId, month) {
  const response = await request(`/api/staff/payroll/records?userId=${userId}&month=${month}`, { cookie });
  expectStatus(response, 200, `delegated records are readable for ${userId} in ${month}`);
  return response.data.records;
}

function assertAudit(logs, expected, label) {
  const matched = logs.some((log) => {
    if (log.action !== expected.action) return false;
    if (log.actorUserId !== expected.actorUserId) return false;
    if (expected.targetId !== undefined && log.targetId !== expected.targetId) return false;
    if (expected.subjectUserId !== undefined && log.detail.subjectUserId !== expected.subjectUserId) return false;
    if (expected.businessMonth !== undefined && log.detail.businessMonth !== expected.businessMonth) return false;
    return true;
  });
  assert(matched, label);
}

async function expect(path, status, label, options = {}) {
  const response = await request(path, options);
  expectStatus(response, status, label);
  return response;
}

async function patchManagedUser(userId, cookie, body) {
  const listing = await request('/api/admin/users', { cookie });
  expectStatus(listing, 200, `managed account version is readable for ${userId}`);
  const target = listing.data.users.find((candidate) => candidate.id === userId);
  if (!target) throw new Error(`Managed user ${userId} is missing.`);
  return request(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    cookie,
    body: { ...body, expectedUpdatedAt: target.updatedAt },
  });
}

function expectStatus(response, status, label) {
  assert(response.status === status, `${label}: expected ${status}, received ${response.status} ${JSON.stringify(response.data)}`);
  checks.push(label);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  checks.push(message);
}

async function request(path, options = {}) {
  const headers = new Headers();
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.formData || (options.body === undefined ? undefined : JSON.stringify(options.body)),
    redirect: 'manual',
  });
  if (options.raw) return { status: response.status, data: null, headers: response.headers };
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { body: text };
  }
  return { status: response.status, data, headers: response.headers };
}

function cookieFrom(response) {
  const setCookie = response.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';', 1)[0];
  assert(cookie.startsWith('xly_payroll_session='), 'authentication response sets a session cookie');
  return cookie;
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}
