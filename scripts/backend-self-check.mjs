import { createHash, randomUUID } from 'node:crypto';

const baseUrl = process.env.PAYROLL_TEST_BASE_URL || 'http://localhost:3000';
const bootstrapAdminEmail = 'TabitoAdimin01@tabitoedu.com';
const adminEmail = process.env.PAYROLL_TEST_ADMIN_EMAIL || bootstrapAdminEmail;
const adminPassword = process.env.PAYROLL_TEST_ADMIN_PASSWORD;

if (!adminPassword) {
  throw new Error('Set PAYROLL_TEST_ADMIN_PASSWORD before running this check.');
}

const checks = [];
const unique = `${Date.now()}-${randomUUID().slice(0, 8)}`;

const unauthAdmin = await request('/api/admin/users');
expectStatus(unauthAdmin, 401, 'anonymous admin access is rejected');

const bootstrapStatus = await request('/api/bootstrap-status');
expectStatus(bootstrapStatus, 200, 'bootstrap status is readable before authentication');
assert(bootstrapStatus.data.bootstrap.email === bootstrapAdminEmail, 'bootstrap account name is fixed in server code');
let adminAuth;
if (bootstrapStatus.data.bootstrap.bootstrapRequired) {
  adminAuth = await request('/api/users', {
    method: 'POST',
    body: { email: `ignored-${unique}@example.invalid`, passwordDigest: digest(adminPassword) },
  });
  expectStatus(adminAuth, 201, 'empty database creates the fixed bootstrap administrator');
  assert(adminAuth.data.account.email === bootstrapAdminEmail.toLowerCase(), 'first account email is forced to the bootstrap administrator');
} else {
  adminAuth = await request('/api/users/login', {
    method: 'POST', body: { email: adminEmail, passwordDigest: digest(adminPassword) },
  });
  expectStatus(adminAuth, 200, 'admin can log in');
}
assert(adminAuth.data.account.role === 'admin', 'test account is an admin');
assert(!('passwordDigest' in adminAuth.data.account), 'account response contains no password material');
assert(!('token' in adminAuth.data.session), 'session token is not exposed to JavaScript');
const adminSetCookie = adminAuth.headers.get('set-cookie') || '';
assert(adminSetCookie.includes('HttpOnly'), 'session cookie is HttpOnly');
assert(adminSetCookie.includes('SameSite=Strict'), 'session cookie is SameSite=Strict');
const adminCookie = cookieFrom(adminAuth);

let adminAccount = adminAuth.data.account;
if (!adminAccount.profile.lastNameCn || !adminAccount.profile.firstNameCn || !adminAccount.profile.address || !adminAccount.profile.tel) {
  const onboardAdmin = await request(`/api/users/${adminAccount.id}`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: {
      profile: {
        ...adminAccount.profile,
        lastNameCn: '审计',
        firstNameCn: '管理员',
        address: 'Backend audit address',
        tel: '090-0000-0000\naudit-admin@example.invalid',
      },
    },
  });
  expectStatus(onboardAdmin, 200, 'admin can complete mandatory onboarding profile');
  adminAccount = onboardAdmin.data.account;
}

const defaultSettings = await request('/api/admin/settings', { cookie: adminCookie });
expectStatus(defaultSettings, 200, 'admin can read registration setting');
assert(defaultSettings.data.settings.registrationOpen === true, 'new-account registration defaults to open on a fresh database');

const managerUpdate = await request(`/api/admin/users/${adminAccount.id}`, {
  method: 'PATCH', cookie: adminCookie, body: { workManager: true },
});
expectStatus(managerUpdate, 200, 'admin can enable an account as a work manager');
assert(managerUpdate.data.user.workManager === true, 'work-manager permission is persisted');

await expect('/api/admin/settings', 200, 'admin can open registration', {
  cookie: adminCookie,
  method: 'PATCH',
  body: { registrationOpen: true },
});

const employeePassword = 'Employee-Audit-2026!';
const employeeRegistration = await request('/api/users', {
  method: 'POST',
  body: { email: `employee-${unique}@example.invalid`, passwordDigest: digest(employeePassword) },
});
expectStatus(employeeRegistration, 201, 'employee registration succeeds');
assert(employeeRegistration.data.account.role === 'employee', 'subsequent account gets employee role');
const employee = employeeRegistration.data.account;
const employeeCookie = cookieFrom(employeeRegistration);

await expect('/api/salary-records', 428, 'new account is gated until mandatory profile is submitted', { cookie: employeeCookie });
await expect(`/api/users/${employee.id}`, 400, 'server rejects profile without required name address and contact', {
  method: 'PATCH', cookie: employeeCookie, body: { profile: employee.profile },
});
const employeeOnboarding = await request(`/api/users/${employee.id}`, {
  method: 'PATCH',
  cookie: employeeCookie,
  body: {
    profile: {
      ...employee.profile,
      lastNameCn: '审计',
      firstNameCn: '员工',
      address: 'Backend audit employee address',
      tel: '090-1111-2222\nWeChat: audit-employee',
    },
  },
});
expectStatus(employeeOnboarding, 200, 'employee can submit mandatory onboarding profile');
const employeeBasicAccount = employeeOnboarding.data.account;
await expect(`/api/users/${employee.id}`, 400, 'server rejects a birthday whose year is not exactly four digits', {
  method: 'PATCH', cookie: employeeCookie, body: { profile: { ...employeeBasicAccount.profile, birthday: '123456-01-01' } },
});

await expect('/api/admin/users', 403, 'employee cannot list accounts', { cookie: employeeCookie });
await expect('/api/review/salary-records', 403, 'employee cannot open review queue', { cookie: employeeCookie });
await expect('/api/staff/employees', 403, 'employee cannot open employee management', { cookie: employeeCookie });
await expect('/api/audit/recent', 403, 'employee cannot read recent backend audit events', { cookie: employeeCookie });
await expect('/api/audit/overview', 403, 'employee cannot open total audit', { cookie: employeeCookie });
await expect('/api/admin/departments', 403, 'employee cannot manage department options', { cookie: employeeCookie });
const payrollOptions = await request('/api/payroll-options', { cookie: employeeCookie });
expectStatus(payrollOptions, 200, 'employee can load active payroll department options');
assert(['事务部', '教学部', '美术部', '正社员', '特殊（具体备注）'].every((label) => payrollOptions.data.departments.some((item) => item.label === label)), 'all five required default departments are active');
assert(payrollOptions.data.workManagers.some((item) => item.id === adminAccount.id), 'enabled work manager is available in salary options');
const departmentCreate = await request('/api/admin/departments', {
  method: 'POST', cookie: adminCookie, body: { label: `审计测试部-${unique}` },
});
expectStatus(departmentCreate, 201, 'admin can add a payroll department option');
const customDepartment = departmentCreate.data.department;

const secondRegistration = await request('/api/users', {
  method: 'POST',
  body: { email: `reviewer-${unique}@example.invalid`, passwordDigest: digest('Reviewer-Audit-2026!') },
});
expectStatus(secondRegistration, 201, 'second employee registration succeeds');
const secondUser = secondRegistration.data.account;
const secondCookie = cookieFrom(secondRegistration);
const secondOnboarding = await request(`/api/users/${secondUser.id}`, {
  method: 'PATCH',
  cookie: secondCookie,
  body: {
    profile: {
      ...secondUser.profile,
      lastNameCn: '审计',
      firstNameCn: '审核员',
      address: 'Backend audit reviewer address',
      tel: '090-3333-4444\nreviewer@example.invalid',
    },
  },
});
expectStatus(secondOnboarding, 200, 'future reviewer completes mandatory onboarding profile');

const lockRegistration = await request('/api/users', {
  method: 'POST',
  body: { email: `locked-${unique}@example.invalid`, passwordDigest: digest('Lock-Audit-2026!') },
});
expectStatus(lockRegistration, 201, 'lockout test account registration succeeds');
const lockUser = lockRegistration.data.account;
for (let attempt = 1; attempt <= 5; attempt += 1) {
  await expect('/api/users/login', 401, `bad password attempt ${attempt} is rejected`, {
    method: 'POST',
    body: { email: lockUser.email, passwordDigest: digest('Definitely-Wrong-2026!') },
  });
}
await expect('/api/users/login', 429, 'sixth login attempt is rate-limited', {
  method: 'POST',
  body: { email: lockUser.email, passwordDigest: digest('Definitely-Wrong-2026!') },
});
await expect(`/api/admin/users/${lockUser.id}/password`, 200, 'admin can set a temporary password and clear lockout', {
  method: 'POST', cookie: adminCookie, body: { newPasswordDigest: digest('Recovered-Audit-2026!') },
});
const recoveredLogin = await request('/api/users/login', {
  method: 'POST',
  body: { email: lockUser.email, passwordDigest: digest('Recovered-Audit-2026!') },
});
expectStatus(recoveredLogin, 200, 'temporary password can be used after admin reset');

const uploadForm = new FormData();
uploadForm.set('file', new File([new TextEncoder().encode('%PDF-1.4\nself-check\n')], 'self-check.pdf', { type: 'application/pdf' }));
const upload = await request('/api/uploads', { method: 'POST', cookie: employeeCookie, formData: uploadForm });
expectStatus(upload, 201, 'employee can upload a permitted PDF');
const fileKey = upload.data.file.key;

const bankUploadForm = new FormData();
bankUploadForm.set('file', new File([new TextEncoder().encode('%PDF-1.4\nbank-self-check\n')], 'bank-self-check.pdf', { type: 'application/pdf' }));
const bankUpload = await request('/api/uploads', { method: 'POST', cookie: employeeCookie, formData: bankUploadForm });
expectStatus(bankUpload, 201, 'employee can upload a bank proof PDF');
const bankFileKey = bankUpload.data.file.key;

const invalidUpload = new FormData();
invalidUpload.set('file', new File([new TextEncoder().encode('not permitted')], 'self-check.txt', { type: 'text/plain' }));
await expect('/api/uploads', 400, 'disallowed attachment type is rejected', {
  method: 'POST', cookie: employeeCookie, formData: invalidUpload,
});

const workDate = new Date().toISOString().slice(0, 10);
const profileWithoutBankCard = {
  ...employeeBasicAccount.profile,
  birthday: '1990-01-01',
  idType: 'passport',
  idFileNames: [],
  activityPermission: '',
  dependents: '',
  bankType: 'jp-bank',
  bankName: 'Self Check Bank',
  bankAccountNumber: '1234567',
  bankAccountHolder: 'SELF CHECK',
  bankFileNames: [],
};
await expect(`/api/users/${employee.id}`, 200, 'optional identity, activity-permission and dependent fields can remain empty', {
  method: 'PATCH', cookie: employeeCookie, body: { profile: profileWithoutBankCard },
});

const gateDraftId = `salary-${randomUUID()}`;
const gateDraft = {
  id: gateDraftId,
  userId: employee.id,
  workDate,
  checkUserId: adminAccount.id,
  checkUser: 'forged manager label',
  departmentKey: 'dept-affairs',
  departmentLabel: '',
  currency: 'JPY',
  applyType: 6,
  workContent: 'Profile gate self-check',
  memo: '',
  rate: 1000,
  startTime: '',
  endTime: '',
  amount: 0,
  travelStart: '',
  travelEnd: '',
  travelFee: 0,
  totalHours: 0,
  workHours: 0,
  restHours: 0,
  finalSalary: 0,
  attachments: [],
  status: 1,
  checkDate: null,
  auditMemo: '',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
await expect('/api/salary-records', 201, 'employee can prepare a draft before the full payment profile is complete', {
  method: 'POST', cookie: employeeCookie, body: gateDraft,
});
const blockedSubmission = await request(`/api/salary-records/apply/${employee.id}`, {
  method: 'POST', cookie: employeeCookie, body: { month: workDate.slice(0, 7) },
});
expectStatus(blockedSubmission, 400, 'salary submission requires at least one bank-card attachment');
assert(String(blockedSubmission.data.error).includes('银行卡正反面'), 'incomplete-profile response names the missing bank-card attachment');
await expect(`/api/salary-records/${gateDraftId}`, 200, 'unsubmitted profile-gate test draft can be deleted', {
  method: 'DELETE', cookie: employeeCookie,
});

const profile = {
  ...profileWithoutBankCard,
  bankFileNames: [bankFileKey],
};
await expect(`/api/users/${employee.id}`, 200, 'employee can complete payroll profile with one bank-card attachment', {
  method: 'PATCH', cookie: employeeCookie, body: { profile },
});
await expect(`/api/users/${secondUser.id}`, 403, 'employee cannot update another profile', {
  method: 'PATCH', cookie: employeeCookie, body: { profile },
});

const salaryId = `salary-${randomUUID()}`;
const cnySalaryId = `salary-${randomUUID()}`;
const otherMonthSalaryId = `salary-${randomUUID()}`;
const otherMonth = new Date(`${workDate}T00:00:00Z`);
otherMonth.setUTCMonth(otherMonth.getUTCMonth() - 1);
const otherMonthWorkDate = otherMonth.toISOString().slice(0, 10);
const forgedRecord = {
  id: salaryId,
  userId: employee.id,
  workDate,
  checkUserId: adminAccount.id,
  checkUser: '伪造负责人名称',
  departmentKey: customDepartment.key,
  departmentLabel: '伪造部门名称',
  currency: 'JPY',
  applyType: 6,
  workContent: 'Backend permission self-check',
  memo: 'Server must ignore forged status and amount.',
  rate: 5000,
  startTime: '',
  endTime: '',
  amount: 0,
  travelStart: '',
  travelEnd: '',
  travelFee: 0,
  totalHours: 999,
  workHours: 999,
  restHours: 0,
  finalSalary: 99999999,
  attachments: [fileKey],
  status: 3,
  checkDate: new Date().toISOString(),
  auditMemo: 'forged approval',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
const created = await request('/api/salary-records', { method: 'POST', cookie: employeeCookie, body: forgedRecord });
expectStatus(created, 201, 'employee can create a draft');
assert(created.data.record.status === 1, 'server forces a new record to draft status');
assert(created.data.record.finalSalary === 5000, 'server recalculates and ignores forged salary');
assert(created.data.record.workHours === 0, 'server recalculates and ignores forged work hours');
assert(created.data.record.auditMemo === '', 'server strips forged audit memo');
assert(created.data.record.departmentLabel === customDepartment.label, 'server stores the authoritative department label snapshot');
assert(created.data.record.currency === 'JPY', 'server stores the selected JPY currency');
assert(created.data.record.checkUserId === adminAccount.id && created.data.record.checkUser !== '伪造负责人名称', 'server stores the authoritative work-manager account and name');

await expect('/api/salary-records', 400, 'an account without work-manager permission cannot be selected', {
  method: 'POST', cookie: employeeCookie, body: { ...forgedRecord, id: `salary-${randomUUID()}`, checkUserId: secondUser.id },
});

const restRecordId = `salary-${randomUUID()}`;
const restRecord = await request('/api/salary-records', {
  method: 'POST', cookie: employeeCookie, body: {
    ...forgedRecord,
    id: restRecordId,
    departmentKey: 'dept-teaching',
    departmentLabel: '',
    applyType: 1,
    rate: 1000,
    startTime: '09:00',
    endTime: '17:00',
    restHours: 1.5,
    travelFee: 0,
    attachments: [],
  },
});
expectStatus(restRecord, 201, 'employee can enter an optional manual break duration');
assert(restRecord.data.record.totalHours === 8, 'server calculates eight total elapsed hours');
assert(restRecord.data.record.restHours === 1.5 && restRecord.data.record.workHours === 6.5, 'manual break is deducted from paid work time');
assert(restRecord.data.record.finalSalary === 6500, 'hourly salary uses paid work time after manual break');
const noAutomaticRest = await request(`/api/salary-records/${restRecordId}`, {
  method: 'PATCH', cookie: employeeCookie, body: { ...restRecord.data.record, restHours: 0 },
});
expectStatus(noAutomaticRest, 200, 'manual break can be changed back to zero');
assert(noAutomaticRest.data.record.restHours === 0 && noAutomaticRest.data.record.workHours === 8, 'an eight-hour shift no longer receives an automatic break deduction');
assert(noAutomaticRest.data.record.finalSalary === 8000, 'zero manual break pays all eight hours');
await expect('/api/salary-records', 400, 'manual break cannot exceed total elapsed time', {
  method: 'POST', cookie: employeeCookie, body: { ...forgedRecord, id: `salary-${randomUUID()}`, departmentKey: 'dept-teaching', applyType: 1, startTime: '09:00', endTime: '17:00', restHours: 9, attachments: [] },
});
await expect(`/api/salary-records/${restRecordId}`, 200, 'manual-break test draft can be deleted', {
  method: 'DELETE', cookie: employeeCookie,
});

const departmentDelete = await request(`/api/admin/departments/${customDepartment.key}`, { method: 'DELETE', cookie: adminCookie });
expectStatus(departmentDelete, 200, 'admin can deactivate a payroll department option');
assert(departmentDelete.data.department.active === false, 'deleted department is inactive');
await expect('/api/salary-records', 400, 'inactive department cannot be used for a new declaration', {
  method: 'POST', cookie: employeeCookie, body: { ...forgedRecord, id: `salary-${randomUUID()}` },
});
const afterDepartmentDelete = await request(`/api/salary-records/${salaryId}`, { cookie: employeeCookie });
expectStatus(afterDepartmentDelete, 200, 'existing draft remains readable after its department is deactivated');
assert(afterDepartmentDelete.data.record.departmentLabel === customDepartment.label, 'historical department label snapshot survives deactivation');

const cnyRecord = await request('/api/salary-records', {
  method: 'POST', cookie: employeeCookie, body: {
    ...forgedRecord,
    id: cnySalaryId,
    departmentKey: 'dept-teaching',
    departmentLabel: '',
    currency: 'CNY',
    rate: 8000,
    memo: 'CNY monthly rejection visibility check',
    attachments: [],
  },
});
expectStatus(cnyRecord, 201, 'employee can create a CNY draft');
assert(cnyRecord.data.record.currency === 'CNY' && cnyRecord.data.record.finalSalary === 8000, 'CNY currency and amount are persisted independently');

const otherMonthRecord = await request('/api/salary-records', {
  method: 'POST', cookie: employeeCookie, body: {
    ...forgedRecord,
    id: otherMonthSalaryId,
    workDate: otherMonthWorkDate,
    departmentKey: 'dept-teaching',
    departmentLabel: '',
    rate: 7000,
    attachments: [],
  },
});
expectStatus(otherMonthRecord, 201, 'employee can create a draft in another work month');

await expect(`/api/salary-records/${salaryId}`, 404, 'other employee cannot read the record', { cookie: secondCookie });
await expect(`/api/salary-records/${salaryId}`, 403, 'other employee cannot overwrite the record', {
  method: 'PATCH', cookie: secondCookie, body: { ...forgedRecord, userId: secondUser.id },
});
await expect(`/api/files?key=${encodeURIComponent(fileKey)}`, 403, 'other employee cannot read the attachment', { cookie: secondCookie });

const applied = await request(`/api/salary-records/apply/${employee.id}`, {
  method: 'POST', cookie: employeeCookie, body: { month: workDate.slice(0, 7) },
});
expectStatus(applied, 200, 'employee can submit drafts for the selected work month');
assert(applied.data.records.some((record) => record.id === salaryId && record.status === 2), 'submitted record becomes pending');
assert(applied.data.records.some((record) => record.id === cnySalaryId && record.status === 2), 'CNY submitted record becomes pending');
assert(!applied.data.records.some((record) => record.id === otherMonthSalaryId), 'submitting one month does not submit another month');
const untouchedOtherMonth = await request(`/api/salary-records/${otherMonthSalaryId}`, { cookie: employeeCookie });
expectStatus(untouchedOtherMonth, 200, 'other-month draft remains readable');
assert(untouchedOtherMonth.data.record.status === 1, 'other-month draft remains unsubmitted');
await expect(`/api/files?key=${encodeURIComponent(fileKey)}`, 409, 'referenced attachment cannot be deleted', {
  method: 'DELETE', cookie: employeeCookie,
});
await expect(`/api/salary-records/${salaryId}`, 409, 'employee cannot edit a submitted record', {
  method: 'PATCH', cookie: employeeCookie, body: forgedRecord,
});

const promote = await request(`/api/admin/users/${secondUser.id}`, {
  method: 'PATCH',
  cookie: adminCookie,
  body: { role: 'reviewer', status: 'active', workManager: true },
});
expectStatus(promote, 200, 'admin can grant reviewer role');
assert(promote.data.user.role === 'reviewer', 'reviewer role is persisted');
assert(promote.data.user.workManager === true, 'admin can independently grant work-manager permission');
const refreshedOptions = await request('/api/payroll-options', { cookie: employeeCookie });
expectStatus(refreshedOptions, 200, 'payroll options refresh after permission changes');
assert(refreshedOptions.data.workManagers.some((item) => item.id === secondUser.id), 'newly enabled work manager appears in payroll options');

const queue = await request('/api/review/salary-records', { cookie: secondCookie });
expectStatus(queue, 200, 'reviewer can open review queue without relogin');
assert(queue.data.items.some((item) => item.record.id === salaryId), 'pending record appears in review queue');
assert(queue.data.items.some((item) => item.record.id === cnySalaryId && item.record.currency === 'CNY'), 'pending CNY record appears in review queue with currency');
await expect(`/api/files?key=${encodeURIComponent(fileKey)}`, 200, 'reviewer can read a submitted salary attachment', { cookie: secondCookie, raw: true });
await expect(`/api/files?key=${encodeURIComponent(bankFileKey)}`, 200, 'reviewer can read an employee bank/profile attachment', { cookie: secondCookie, raw: true });
const staffList = await request('/api/staff/employees', { cookie: secondCookie });
expectStatus(staffList, 200, 'reviewer can open employee management');
assert(staffList.data.employees.some((item) => item.id === employee.id), 'employee management lists the target employee');
const staffDetail = await request(`/api/staff/employees/${employee.id}`, { cookie: secondCookie });
expectStatus(staffDetail, 200, 'reviewer can read full employee detail');
assert(staffDetail.data.employee.files.some((file) => file.key === bankFileKey), 'employee detail includes uploaded bank/profile files');
assert(staffDetail.data.employee.salaryRecords.some((record) => record.id === salaryId), 'employee detail includes all salary declarations');
const recentAudit = await request('/api/audit/recent', { cookie: secondCookie });
expectStatus(recentAudit, 200, 'reviewer can read the latest ten audit events');
assert(recentAudit.data.logs.length <= 10, 'recent audit endpoint never returns more than ten events');

const approval = await request(`/api/review/salary-records/${salaryId}`, {
  method: 'PATCH', cookie: secondCookie, body: { decision: 'approve', auditMemo: 'Self-check approved' },
});
expectStatus(approval, 200, 'reviewer can approve a pending record');
assert(approval.data.record.status === 3, 'approved record has approved status');
const rejection = await request(`/api/review/salary-records/${cnySalaryId}`, {
  method: 'PATCH', cookie: secondCookie, body: { decision: 'reject', auditMemo: 'Self-check CNY rejected' },
});
expectStatus(rejection, 200, 'reviewer can reject the CNY pending record');
assert(rejection.data.record.status === 4 && rejection.data.record.currency === 'CNY', 'rejected CNY record keeps its currency');
const processedMonthQueue = await request('/api/review/salary-records', { cookie: secondCookie });
expectStatus(processedMonthQueue, 200, 'review queue remains readable after monthly decisions');
assert(processedMonthQueue.data.items.some((item) => item.record.id === salaryId && item.record.status === 3), 'approved record remains in the monthly review data');
assert(processedMonthQueue.data.items.some((item) => item.record.id === cnySalaryId && item.record.status === 4), 'rejected record remains in the monthly review data');

const transferSheet = await request(`/api/staff/transfer-sheet?month=${workDate.slice(0, 7)}`, { cookie: secondCookie });
expectStatus(transferSheet, 200, 'reviewer can load the monthly transfer sheet');
const transferRow = transferSheet.data.rows.find((row) => row.user.id === employee.id);
assert(transferRow?.approvedAmounts.JPY === 5000, 'transfer sheet includes selected-month approved salary');
assert(transferRow?.profile.tel.includes('WeChat'), 'transfer sheet includes multiline employee contact information');
assert(transferRow?.pdfFiles.some((file) => file.key === bankFileKey), 'transfer sheet includes downloadable bank-card PDF');
assert(transferRow?.pdfFiles.some((file) => file.key === fileKey), 'transfer sheet includes every uploaded salary PDF');

const auditMonth = workDate.slice(0, 7);
const overview = await request(`/api/audit/overview?year=${workDate.slice(0, 4)}&month=${auditMonth}&userId=${employee.id}`, { cookie: secondCookie });
expectStatus(overview, 200, 'reviewer can open monthly and annual total audit');
assert(overview.data.overview.monthSummary.approvedAmounts.JPY === 5000, 'monthly audit totals approved JPY independently');
assert(overview.data.overview.monthSummary.rejectedAmounts.CNY === 8000, 'monthly audit totals rejected CNY independently');
assert(overview.data.overview.accountLogs.length > 0, 'total audit traces the selected account by month');
const emptyAccountOverview = await request(`/api/audit/overview?year=${workDate.slice(0, 4)}&month=${auditMonth}&userId=${lockUser.id}`, { cookie: secondCookie });
expectStatus(emptyAccountOverview, 200, 'total audit accepts an employee account with no salary records');
assert(emptyAccountOverview.data.overview.monthSummary.recordCount === 0, 'account filter excludes other employees from monthly totals');
assert(emptyAccountOverview.data.overview.yearSummary.recordCount === 0, 'account filter excludes other employees from annual totals');
assert(emptyAccountOverview.data.overview.departmentSummaries.length === 0, 'account filter excludes other employees from department totals');
await expect(`/api/review/salary-records/${salaryId}`, 409, 'reviewer cannot process the same record twice', {
  method: 'PATCH', cookie: secondCookie, body: { decision: 'reject', auditMemo: 'duplicate' },
});
await expect('/api/admin/users', 403, 'reviewer cannot use admin account APIs', { cookie: secondCookie });

const employeeAccount = await request('/api/users', { cookie: employeeCookie });
expectStatus(employeeAccount, 200, 'employee can refresh own account');
assert(employeeAccount.data.account.salaryRecords.some((record) => record.id === salaryId && record.status === 3), 'employee sees reviewed result');

await expect(`/api/admin/users/${adminAccount.id}`, 200, 'admin can remove own work-manager permission', {
  method: 'PATCH', cookie: adminCookie, body: { workManager: false },
});
const managerOptionsAfterRemoval = await request('/api/payroll-options', { cookie: employeeCookie });
expectStatus(managerOptionsAfterRemoval, 200, 'work-manager options refresh after permission removal');
assert(!managerOptionsAfterRemoval.data.workManagers.some((item) => item.id === adminAccount.id), 'removed work manager no longer appears in payroll options');
assert(managerOptionsAfterRemoval.data.workManagers.some((item) => item.id === secondUser.id), 'other enabled work managers remain available');

await expect(`/api/admin/users/${secondUser.id}`, 200, 'admin can disable an account', {
  method: 'PATCH', cookie: adminCookie, body: { status: 'disabled' },
});
const noActiveManagers = await request('/api/payroll-options', { cookie: employeeCookie });
expectStatus(noActiveManagers, 200, 'payroll options remain readable when no work manager is active');
assert(noActiveManagers.data.workManagers.length === 0, 'removing every active work manager does not silently restore one');
await expect('/api/users', 401, 'disabled account loses active session immediately', { cookie: secondCookie });
await expect(`/api/admin/users/${secondUser.id}`, 200, 'admin can reactivate an account', {
  method: 'PATCH', cookie: adminCookie, body: { status: 'active' },
});
await expect(`/api/admin/users/${adminAccount.id}`, 200, 'admin can restore own work-manager permission', {
  method: 'PATCH', cookie: adminCookie, body: { workManager: true },
});
await expect(`/api/admin/users/${employee.id}`, 200, 'admin can revoke an employee session', {
  method: 'PATCH', cookie: adminCookie, body: { revokeSessions: true },
});
await expect('/api/users', 401, 'revoked employee session is rejected', { cookie: employeeCookie });
await expect(`/api/admin/users/${adminAccount.id}`, 400, 'admin cannot disable own account', {
  method: 'PATCH', cookie: adminCookie, body: { status: 'disabled' },
});
await expect(`/api/admin/users/${adminAccount.id}`, 409, 'last active admin cannot demote self', {
  method: 'PATCH', cookie: adminCookie, body: { role: 'employee' },
});

await expect('/api/admin/settings', 200, 'admin can close registration', {
  method: 'PATCH', cookie: adminCookie, body: { registrationOpen: false },
});
await expect('/api/users', 403, 'closed registration rejects new accounts', {
  method: 'POST', body: { email: `closed-${unique}@example.invalid`, passwordDigest: digest('Closed-Audit-2026!') },
});
await expect('/api/admin/settings', 200, 'admin can reopen registration after test', {
  method: 'PATCH', cookie: adminCookie, body: { registrationOpen: true },
});

const audit = await request('/api/admin/audit-logs?limit=200', { cookie: adminCookie });
expectStatus(audit, 200, 'admin can read audit log');
assert(audit.data.logs.some((log) => log.action === 'salary.approve' && log.targetId === salaryId), 'salary approval is audited');
assert(audit.data.logs.some((log) => log.action === 'salary.approve' && log.targetId === salaryId && log.actorDisplayName === '审计审核员'), 'audit entries prefer the registered name over email');
assert(audit.data.logs.some((log) => log.action === 'salary.reject' && log.targetId === cnySalaryId), 'salary rejection is audited');
assert(audit.data.logs.some((log) => log.action === 'department.delete' && log.targetId === customDepartment.key), 'department deactivation is audited');
assert(audit.data.logs.some((log) => log.action === 'account.permission_update' && log.targetId === secondUser.id), 'permission change is audited');

const logout = await request('/api/users/logout', { method: 'POST', cookie: adminCookie });
expectStatus(logout, 200, 'logout succeeds');
assert((logout.headers.get('set-cookie') || '').includes('Max-Age=0'), 'logout clears session cookie');
await expect('/api/users', 401, 'logged-out session is rejected', { cookie: adminCookie });

process.stdout.write(`${JSON.stringify({ result: 'PASS', checks: checks.length }, null, 2)}\n`);

async function expect(path, status, label, options = {}) {
  const response = await request(path, options);
  expectStatus(response, status, label);
  return response;
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
  try { data = text ? JSON.parse(text) : {}; } catch { data = { body: text }; }
  return { status: response.status, data, headers: response.headers };
}

function cookieFrom(response) {
  const setCookie = response.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';', 1)[0];
  assert(cookie.startsWith('xly_payroll_session='), 'authentication response sets session cookie');
  return cookie;
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}
