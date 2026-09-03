import { createHash, randomUUID } from 'node:crypto';

const baseUrl = process.env.PAYROLL_TEST_BASE_URL || 'http://localhost:3000';
const bootstrapAdminEmail = 'TabitoAdimin01@tabitoedu.com';
const adminEmail = process.env.PAYROLL_TEST_ADMIN_EMAIL || bootstrapAdminEmail;
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

const unauthAdmin = await request('/api/admin/users');
expectStatus(unauthAdmin, 401, 'anonymous admin access is rejected');

const bootstrapStatus = await request('/api/bootstrap-status');
expectStatus(bootstrapStatus, 200, 'bootstrap status is readable before authentication');
assert(bootstrapStatus.data.bootstrap.email === bootstrapAdminEmail, 'bootstrap account name is fixed in server code');
assert(bootstrapStatus.headers.get('x-frame-options') === 'DENY', 'responses deny iframe embedding');
assert(bootstrapStatus.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"), 'responses include a frame-ancestors policy');
assert(bootstrapStatus.headers.get('x-content-type-options') === 'nosniff', 'responses disable content-type sniffing');
assert(bootstrapStatus.headers.get('referrer-policy') === 'same-origin', 'responses limit cross-origin referrer data');
let adminAuth;
if (bootstrapStatus.data.bootstrap.bootstrapRequired) {
  await expect('/api/users', 403, 'first administrator cannot be claimed without the deployment setup key', {
    method: 'POST', body: { email: `attacker-${unique}@example.invalid`, passwordDigest: digest('Attacker-Password-2026!') },
  });
  await expect('/api/users', 403, 'first administrator rejects an incorrect deployment setup key', {
    method: 'POST', body: {
      email: `attacker-${unique}@example.invalid`,
      passwordDigest: digest('Attacker-Password-2026!'),
      bootstrapSecret: `${bootstrapSecret}-wrong`,
    },
  });
  adminAuth = await request('/api/users', {
    method: 'POST',
    body: { email: `ignored-${unique}@example.invalid`, passwordDigest: digest(adminPassword), bootstrapSecret },
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

const managerUpdate = await patchManagedUser(adminAccount.id, adminCookie, { workManager: true });
expectStatus(managerUpdate, 200, 'admin can enable an account as a work manager');
assert(managerUpdate.data.user.workManager === true, 'work-manager permission is persisted');
await expect(`/api/admin/users/${adminAccount.id}`, 400, 'permission updates require an explicit account version', {
  method: 'PATCH', cookie: adminCookie, body: { workManager: true },
});
const permissionVersion = managerUpdate.data.user.updatedAt;
const permissionChange = await patchManagedUser(
  adminAccount.id,
  adminCookie,
  { workManager: false },
  permissionVersion,
);
expectStatus(permissionChange, 200, 'a permission update accepts the current account version');
const stalePermissionChange = await patchManagedUser(
  adminAccount.id,
  adminCookie,
  { workManager: true },
  permissionVersion,
);
expectStatus(stalePermissionChange, 409, 'a stale permission page cannot overwrite a newer account update');
const permissionAfterConflict = await managedUserSnapshot(adminAccount.id, adminCookie);
assert(permissionAfterConflict.workManager === false, 'a stale permission request cannot revive an older work-manager setting');
const permissionRestore = await patchManagedUser(
  adminAccount.id,
  adminCookie,
  { workManager: true },
  permissionAfterConflict.updatedAt,
);
expectStatus(permissionRestore, 200, 'the current permission version can restore the intended setting');

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
await expect(`/api/users/${employee.id}`, 400, 'server rejects a future birthday', {
  method: 'PATCH', cookie: employeeCookie, body: { profile: { ...employeeBasicAccount.profile, birthday: '9999-01-01' } },
});
await expect(`/api/users/${employee.id}`, 400, 'server rejects overlong profile text instead of silently truncating it', {
  method: 'PATCH', cookie: employeeCookie, body: { profile: { ...employeeBasicAccount.profile, address: 'x'.repeat(501) } },
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
await expect('/api/admin/departments', 400, 'server rejects an overlong department name instead of silently truncating it', {
  method: 'POST', cookie: adminCookie, body: { label: 'x'.repeat(81) },
});

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
const lockBeforeRecovery = await managedUserSnapshot(lockUser.id, adminCookie);
await expect(`/api/admin/users/${lockUser.id}/password`, 200, 'admin can set a temporary password and clear lockout', {
  method: 'POST', cookie: adminCookie, body: {
    newPasswordDigest: digest('Recovered-Audit-2026!'),
    expectedUpdatedAt: lockBeforeRecovery.updatedAt,
  },
});
const recoveredLogin = await request('/api/users/login', {
  method: 'POST',
  body: { email: lockUser.email, passwordDigest: digest('Recovered-Audit-2026!') },
});
expectStatus(recoveredLogin, 200, 'temporary password can be used after admin reset');

const racedPassword = 'Raced-Reset-Audit-2026!';
const lockBeforeRace = await managedUserSnapshot(lockUser.id, adminCookie);
const [oldPasswordRaceLogin, concurrentAdminReset] = await Promise.all([
  request('/api/users/login', {
    method: 'POST',
    body: { email: lockUser.email, passwordDigest: digest('Recovered-Audit-2026!') },
  }),
  request(`/api/admin/users/${lockUser.id}/password`, {
    method: 'POST', cookie: adminCookie, body: {
      newPasswordDigest: digest(racedPassword),
      expectedUpdatedAt: lockBeforeRace.updatedAt,
    },
  }),
]);
assert(
  concurrentAdminReset.status === 200 || concurrentAdminReset.status === 409,
  'administrator reset racing a login either commits first or reports a version conflict',
);
assert(
  oldPasswordRaceLogin.status === 200 || oldPasswordRaceLogin.status === 401,
  'old-password login racing a reset either completes before the reset or is rejected',
);
if (concurrentAdminReset.status === 409) {
  const latestLockUser = await managedUserSnapshot(lockUser.id, adminCookie);
  await expect(`/api/admin/users/${lockUser.id}/password`, 200, 'administrator can retry a conflicted reset with the current version', {
    method: 'POST', cookie: adminCookie, body: {
      newPasswordDigest: digest(racedPassword),
      expectedUpdatedAt: latestLockUser.updatedAt,
    },
  });
}
await expect('/api/users/login', 401, 'old password is rejected after the concurrent reset completes', {
  method: 'POST',
  body: { email: lockUser.email, passwordDigest: digest('Recovered-Audit-2026!') },
});
if (oldPasswordRaceLogin.status === 200) {
  await expect(`/api/users/${lockUser.id}`, 401, 'a racing old-password session is revoked by the reset', {
    cookie: cookieFrom(oldPasswordRaceLogin),
  });
} else {
  assert(oldPasswordRaceLogin.status === 401, 'the racing old-password request was rejected before session issuance');
  assert(!oldPasswordRaceLogin.headers.get('set-cookie'), 'a rejected racing login does not set a session cookie');
}
const racedPasswordLogin = await request('/api/users/login', {
  method: 'POST',
  body: { email: lockUser.email, passwordDigest: digest(racedPassword) },
});
expectStatus(racedPasswordLogin, 200, 'new password works after the concurrent reset');
const preChangeCookie = cookieFrom(racedPasswordLogin);
const selfChangedPassword = 'Self-Changed-Audit-2026!';
const selfPasswordChange = await request('/api/users/reset-password', {
  method: 'POST',
  cookie: preChangeCookie,
  body: { oldPasswordDigest: digest(racedPassword), newPasswordDigest: digest(selfChangedPassword) },
});
expectStatus(selfPasswordChange, 200, 'an account can change its own password');
const rotatedPasswordCookie = cookieFrom(selfPasswordChange);
assert(rotatedPasswordCookie !== preChangeCookie, 'self-service password change rotates the current session token');
await expect(`/api/users/${lockUser.id}`, 401, 'the pre-change session is revoked after a password change', {
  cookie: preChangeCookie,
});
await expect('/api/users/login', 401, 'the previous password is rejected after a self-service change', {
  method: 'POST',
  body: { email: lockUser.email, passwordDigest: digest(racedPassword) },
});
const selfChangedLogin = await request('/api/users/login', {
  method: 'POST',
  body: { email: lockUser.email, passwordDigest: digest(selfChangedPassword) },
});
expectStatus(selfChangedLogin, 200, 'the self-service replacement password can log in');
cookieFrom(selfChangedLogin);

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

const disposableUploadForm = new FormData();
disposableUploadForm.set('file', new File(
  [new TextEncoder().encode('%PDF-1.4\ndelete-self-check\n')],
  'delete-self-check.pdf',
  { type: 'application/pdf' },
));
const disposableUpload = await request('/api/uploads', {
  method: 'POST', cookie: employeeCookie, formData: disposableUploadForm,
});
expectStatus(disposableUpload, 201, 'employee can upload an unreferenced file for deletion testing');
const disposableFileKey = disposableUpload.data.file.key;
await expect(`/api/files?key=${encodeURIComponent(disposableFileKey)}`, 200, 'an unreferenced file is readable before deletion', {
  cookie: employeeCookie, raw: true,
});
await expect(`/api/files?key=${encodeURIComponent(disposableFileKey)}`, 200, 'an unreferenced file can be deleted safely', {
  method: 'DELETE', cookie: employeeCookie,
});
await expect(`/api/files?key=${encodeURIComponent(disposableFileKey)}`, 404, 'deleted file metadata is no longer readable', {
  cookie: employeeCookie,
});

const invalidUpload = new FormData();
invalidUpload.set('file', new File([new TextEncoder().encode('not permitted')], 'self-check.txt', { type: 'text/plain' }));
await expect('/api/uploads', 400, 'disallowed attachment type is rejected', {
  method: 'POST', cookie: employeeCookie, formData: invalidUpload,
});
const svgUpload = new FormData();
svgUpload.set('file', new File([new TextEncoder().encode('<svg onload="fetch(`/api/admin/users`)"></svg>')], 'script.svg', { type: 'image/svg+xml' }));
await expect('/api/uploads', 400, 'active SVG content is rejected', {
  method: 'POST', cookie: employeeCookie, formData: svgUpload,
});
const spoofedPdfUpload = new FormData();
spoofedPdfUpload.set('file', new File([new TextEncoder().encode('<script>alert(1)</script>')], 'spoofed.pdf', { type: 'application/pdf' }));
await expect('/api/uploads', 400, 'declared PDF without a PDF signature is rejected', {
  method: 'POST', cookie: employeeCookie, formData: spoofedPdfUpload,
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
const gateDraftCreate = await request('/api/salary-records', {
  method: 'POST', cookie: employeeCookie, body: gateDraft,
});
expectStatus(gateDraftCreate, 201, 'employee can prepare a draft before the full payment profile is complete');
const blockedSubmission = await request(`/api/salary-records/apply/${employee.id}`, {
  method: 'POST', cookie: employeeCookie, body: { month: workDate.slice(0, 7) },
});
expectStatus(blockedSubmission, 400, 'salary submission requires at least one bank-card attachment');
assert(String(blockedSubmission.data.error).includes('银行卡正反面'), 'incomplete-profile response names the missing bank-card attachment');
await expect(`/api/salary-records/${gateDraftId}?updatedAt=${encodeURIComponent(gateDraftCreate.data.record.updatedAt)}`, 200, 'unsubmitted profile-gate test draft can be deleted', {
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
const staleSelfDraft = structuredClone(created.data.record);

await expect('/api/salary-records', 400, 'an account without work-manager permission cannot be selected', {
  method: 'POST', cookie: employeeCookie, body: { ...forgedRecord, id: `salary-${randomUUID()}`, checkUserId: secondUser.id },
});
await expect('/api/salary-records', 400, 'server rejects an impossible work date', {
  method: 'POST', cookie: employeeCookie, body: { ...forgedRecord, id: `salary-${randomUUID()}`, workDate: '2026-02-31' },
});
await expect('/api/salary-records', 400, 'server rejects a work date with a valid prefix and trailing text', {
  method: 'POST', cookie: employeeCookie, body: { ...forgedRecord, id: `salary-${randomUUID()}`, workDate: `${workDate}x` },
});
await expect('/api/salary-records', 400, 'server rejects a time with a valid prefix and trailing text', {
  method: 'POST', cookie: employeeCookie, body: { ...forgedRecord, id: `salary-${randomUUID()}`, departmentKey: 'dept-teaching', applyType: 1, startTime: '09:00x', endTime: '10:00' },
});
await expect('/api/salary-records', 400, 'server rejects overlong salary text instead of silently truncating it', {
  method: 'POST', cookie: employeeCookie, body: { ...forgedRecord, id: `salary-${randomUUID()}`, workContent: 'x'.repeat(2001) },
});

const tenMinuteRecordId = `salary-${randomUUID()}`;
const tenMinuteRecord = await request('/api/salary-records', {
  method: 'POST', cookie: employeeCookie, body: {
    ...forgedRecord,
    id: tenMinuteRecordId,
    departmentKey: 'dept-teaching',
    applyType: 1,
    rate: 1000,
    startTime: '09:00',
    endTime: '09:10',
    restHours: 0,
    travelFee: 0,
    attachments: [],
  },
});
expectStatus(tenMinuteRecord, 201, 'employee can create a ten-minute hourly draft');
assert(tenMinuteRecord.data.record.finalSalary === 166, 'server calculates a ten-minute hourly salary with minute precision');

const fiveMinuteBreakRecordId = `salary-${randomUUID()}`;
const fiveMinuteBreakRecord = await request('/api/salary-records', {
  method: 'POST', cookie: employeeCookie, body: {
    ...forgedRecord,
    id: fiveMinuteBreakRecordId,
    departmentKey: 'dept-teaching',
    applyType: 1,
    rate: 1000,
    startTime: '09:00',
    endTime: '10:00',
    restHours: 0.08,
    travelFee: 0,
    attachments: [],
  },
});
expectStatus(fiveMinuteBreakRecord, 201, 'employee can create an hourly draft with a five-minute break');
assert(fiveMinuteBreakRecord.data.record.finalSalary === 916, 'server deducts a five-minute break with minute precision');
await expect(`/api/salary-records/${tenMinuteRecordId}?updatedAt=${encodeURIComponent(tenMinuteRecord.data.record.updatedAt)}`, 200, 'ten-minute calculation test draft can be deleted', {
  method: 'DELETE', cookie: employeeCookie,
});
await expect(`/api/salary-records/${fiveMinuteBreakRecordId}?updatedAt=${encodeURIComponent(fiveMinuteBreakRecord.data.record.updatedAt)}`, 200, 'five-minute-break calculation test draft can be deleted', {
  method: 'DELETE', cookie: employeeCookie,
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
await expect(`/api/salary-records/${restRecordId}?updatedAt=${encodeURIComponent(noAutomaticRest.data.record.updatedAt)}`, 200, 'manual-break test draft can be deleted', {
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

const d1BindingMonth = '2032-02';
const d1BindingDrafts = await Promise.all(Array.from({ length: 21 }, (_, index) => request('/api/salary-records', {
  method: 'POST',
  cookie: employeeCookie,
  body: {
    ...forgedRecord,
    id: `salary-${randomUUID()}`,
    workDate: `${d1BindingMonth}-${String(index + 1).padStart(2, '0')}`,
    departmentKey: 'dept-teaching',
    departmentLabel: '',
    attachments: [],
    memo: `D1 binding regression ${index + 1}`,
  },
})));
d1BindingDrafts.forEach((response) => expectStatus(response, 201, 'D1 binding regression draft can be created'));
const d1BindingSubmit = await request(`/api/salary-records/apply/${employee.id}`, {
  method: 'POST', cookie: employeeCookie, body: { month: d1BindingMonth },
});
expectStatus(d1BindingSubmit, 200, 'submitting more than 19 monthly drafts stays below D1 binding limits');
assert(d1BindingSubmit.data.records.length === 21
  && d1BindingSubmit.data.records.every((record) => record.status === 2),
  'all 21 drafts are submitted atomically without a partial month');

const untouchedOtherMonth = await request(`/api/salary-records/${otherMonthSalaryId}`, { cookie: employeeCookie });
expectStatus(untouchedOtherMonth, 200, 'other-month draft remains readable');
assert(untouchedOtherMonth.data.record.status === 1, 'other-month draft remains unsubmitted');
const staleOtherMonthDraft = structuredClone(untouchedOtherMonth.data.record);
const updatedOtherMonthDraft = await request(`/api/salary-records/${otherMonthSalaryId}`, {
  method: 'PATCH',
  cookie: employeeCookie,
  body: {
    ...untouchedOtherMonth.data.record,
    workContent: 'fresh self-service draft edit',
    rate: 7050,
  },
});
expectStatus(updatedOtherMonthDraft, 200, 'a current self-service draft version can be updated');
await expect(`/api/salary-records/${otherMonthSalaryId}`, 409, 'an older self-service page cannot overwrite a newer draft edit', {
  method: 'PATCH',
  cookie: employeeCookie,
  body: {
    ...staleOtherMonthDraft,
    workContent: 'stale self-service draft overwrite must not persist',
    rate: 1,
  },
});
const afterStaleOtherMonthEdit = await request(`/api/salary-records/${otherMonthSalaryId}`, { cookie: employeeCookie });
expectStatus(afterStaleOtherMonthEdit, 200, 'self-service draft remains readable after an old-page conflict');
assert(afterStaleOtherMonthEdit.data.record.workContent === updatedOtherMonthDraft.data.record.workContent
  && afterStaleOtherMonthEdit.data.record.finalSalary === updatedOtherMonthDraft.data.record.finalSalary,
  'newer self-service draft content survives an old-page overwrite attempt');
await expect(`/api/files?key=${encodeURIComponent(fileKey)}`, 409, 'referenced attachment cannot be deleted', {
  method: 'DELETE', cookie: employeeCookie,
});
await expect(`/api/salary-records/${salaryId}`, 409, 'a stale self-service draft cannot reopen a record after submission', {
  method: 'PATCH',
  cookie: employeeCookie,
  body: {
    ...staleSelfDraft,
    status: 1,
    workContent: 'stale client overwrite must not persist',
    rate: 1,
  },
});
const afterStaleSelfEdit = await request(`/api/salary-records/${salaryId}`, { cookie: employeeCookie });
expectStatus(afterStaleSelfEdit, 200, 'submitted self-service record remains readable after a stale edit conflict');
assert(afterStaleSelfEdit.data.record.status === 2, 'stale self-service edit cannot move a submitted record back to draft');
assert(afterStaleSelfEdit.data.record.workContent === created.data.record.workContent
  && afterStaleSelfEdit.data.record.finalSalary === created.data.record.finalSalary,
  'stale self-service edit cannot overwrite submitted salary content');

const concurrentSelfEdit = {
  ...updatedOtherMonthDraft.data.record,
  workContent: 'concurrent self-service edit',
  rate: 7100,
};
const [concurrentSelfSubmit, concurrentSelfUpdate] = await Promise.all([
  request(`/api/salary-records/apply/${employee.id}`, {
    method: 'POST', cookie: employeeCookie, body: { month: otherMonthWorkDate.slice(0, 7) },
  }),
  request(`/api/salary-records/${otherMonthSalaryId}`, {
    method: 'PATCH', cookie: employeeCookie, body: concurrentSelfEdit,
  }),
]);
assert([200, 409].includes(concurrentSelfSubmit.status), 'concurrent self-service submission either commits or reports a version conflict');
assert([200, 409].includes(concurrentSelfUpdate.status), 'concurrent self-service edit either commits first or reports a version conflict');
assert(concurrentSelfSubmit.status === 200 || concurrentSelfUpdate.status === 200, 'at least one concurrent self-service operation commits');
const afterConcurrentSelfRace = await request(`/api/salary-records/${otherMonthSalaryId}`, { cookie: employeeCookie });
expectStatus(afterConcurrentSelfRace, 200, 'self-service record remains readable after concurrent submit and edit');
if (concurrentSelfSubmit.status === 200) {
  assert(afterConcurrentSelfRace.data.record.status === 2, 'a successful concurrent submission cannot be reopened by an older edit');
}
if (concurrentSelfUpdate.status === 200) {
  assert(afterConcurrentSelfRace.data.record.workContent === concurrentSelfEdit.workContent,
    'a committed concurrent edit is preserved whether it wins before submission or remains a draft');
}

const promote = await patchManagedUser(secondUser.id, adminCookie, {
  role: 'reviewer', status: 'active', workManager: true,
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
const reviewerFileDownload = await expect(`/api/files?key=${encodeURIComponent(fileKey)}`, 200, 'reviewer can read a submitted salary attachment', { cookie: secondCookie, raw: true });
assert(reviewerFileDownload.headers.get('content-disposition')?.startsWith('attachment;'), 'downloaded attachments cannot execute inline in the application origin');
assert(reviewerFileDownload.headers.get('content-security-policy')?.includes("sandbox"), 'attachment responses use a sandbox content security policy');
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
await expect(`/api/review/salary-records/${salaryId}`, 400, 'server rejects an overlong review memo instead of silently truncating it', {
  method: 'PATCH', cookie: secondCookie, body: { decision: 'approve', auditMemo: 'x'.repeat(1001) },
});

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

expectStatus(
  await patchManagedUser(adminAccount.id, adminCookie, { workManager: false }),
  200,
  'admin can remove own work-manager permission',
);
const managerOptionsAfterRemoval = await request('/api/payroll-options', { cookie: employeeCookie });
expectStatus(managerOptionsAfterRemoval, 200, 'work-manager options refresh after permission removal');
assert(!managerOptionsAfterRemoval.data.workManagers.some((item) => item.id === adminAccount.id), 'removed work manager no longer appears in payroll options');
assert(managerOptionsAfterRemoval.data.workManagers.some((item) => item.id === secondUser.id), 'other enabled work managers remain available');

expectStatus(await patchManagedUser(secondUser.id, adminCookie, { status: 'disabled' }), 200, 'admin can disable an account');
const managersAfterTestAccountsDisabled = await request('/api/payroll-options', { cookie: employeeCookie });
expectStatus(managersAfterTestAccountsDisabled, 200, 'payroll options remain readable after tested work managers are disabled');
assert(!managersAfterTestAccountsDisabled.data.workManagers.some((item) => item.id === adminAccount.id || item.id === secondUser.id), 'disabled tested work managers are not silently restored');
await expect('/api/users', 401, 'disabled account loses active session immediately', { cookie: secondCookie });
expectStatus(await patchManagedUser(secondUser.id, adminCookie, { status: 'active' }), 200, 'admin can reactivate an account');
expectStatus(await patchManagedUser(adminAccount.id, adminCookie, { workManager: true }), 200, 'admin can restore own work-manager permission');
expectStatus(await patchManagedUser(employee.id, adminCookie, { revokeSessions: true }), 200, 'admin can revoke an employee session');
await expect('/api/users', 401, 'revoked employee session is rejected', { cookie: employeeCookie });
expectStatus(await patchManagedUser(adminAccount.id, adminCookie, { status: 'disabled' }), 400, 'admin cannot disable own account');
expectStatus(await patchManagedUser(adminAccount.id, adminCookie, { role: 'employee' }), 409, 'last active admin cannot demote self');

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
assert(audit.data.logs.some((log) => log.action === 'file.delete_requested' && log.targetId === disposableFileKey), 'database-first file deletion is audited atomically');
assert(audit.data.logs.some((log) => log.action === 'file.delete' && log.targetId === disposableFileKey), 'completed object-storage deletion is audited');
assert(audit.data.logs.some((log) => log.action === 'auth.login_failed' && log.targetId === lockUser.id && log.actorUserId === null), 'failed login is attributed to an anonymous actor and the targeted account');

expectStatus(
  await patchManagedUser(secondUser.id, adminCookie, { role: 'admin', status: 'active' }),
  200,
  'admin can promote a second active administrator for concurrency testing',
);
const secondAdminLogin = await request('/api/users/login', {
  method: 'POST', body: { email: secondUser.email, passwordDigest: digest('Reviewer-Audit-2026!') },
});
expectStatus(secondAdminLogin, 200, 'second administrator can log in for concurrency testing');
const secondAdminCookie = cookieFrom(secondAdminLogin);
const secondBeforeDemotion = await managedUserSnapshot(secondUser.id, adminCookie);
const originalBeforeDemotion = await managedUserSnapshot(adminAccount.id, adminCookie);
const [demoteSecond, demoteOriginal] = await Promise.all([
  request(`/api/admin/users/${secondUser.id}`, {
    method: 'PATCH', cookie: adminCookie,
    body: { role: 'employee', expectedUpdatedAt: secondBeforeDemotion.updatedAt },
  }),
  request(`/api/admin/users/${adminAccount.id}`, {
    method: 'PATCH', cookie: secondAdminCookie,
    body: { role: 'employee', expectedUpdatedAt: originalBeforeDemotion.updatedAt },
  }),
]);
assert([demoteSecond.status, demoteOriginal.status].filter((status) => status === 200).length === 1, 'concurrent administrator demotions allow exactly one change');
assert([demoteSecond.status, demoteOriginal.status].some((status) => status === 409 || status === 403), 'concurrent final-administrator removal is rejected');
const survivingAdminCookie = demoteSecond.status === 200 ? adminCookie : secondAdminCookie;
const survivingAdminId = demoteSecond.status === 200 ? adminAccount.id : secondUser.id;
const adminsAfterRace = await request('/api/admin/users', { cookie: survivingAdminCookie });
expectStatus(adminsAfterRace, 200, 'an active administrator remains after concurrent demotion attempts');
assert(adminsAfterRace.data.users.filter((user) => user.role === 'admin' && user.status === 'active').length >= 1, 'database preserves at least one active administrator');
assert(adminsAfterRace.data.users.some((user) => user.id === survivingAdminId && user.role === 'admin'), 'the surviving administrator keeps its role');
if (survivingAdminId !== adminAccount.id) {
  expectStatus(
    await patchManagedUser(adminAccount.id, survivingAdminCookie, { role: 'admin', status: 'active' }),
    200,
    'fixed bootstrap administrator is restored after the concurrency test',
  );
}

const logout = await request('/api/users/logout', { method: 'POST', cookie: survivingAdminCookie });
expectStatus(logout, 200, 'logout succeeds');
assert((logout.headers.get('set-cookie') || '').includes('Max-Age=0'), 'logout clears session cookie');
await expect('/api/users', 401, 'logged-out session is rejected', { cookie: survivingAdminCookie });

process.stdout.write(`${JSON.stringify({ result: 'PASS', checks: checks.length }, null, 2)}\n`);

async function expect(path, status, label, options = {}) {
  const response = await request(path, options);
  expectStatus(response, status, label);
  return response;
}

async function managedUserSnapshot(userId, cookie) {
  const response = await request('/api/admin/users', { cookie });
  if (response.status !== 200) return { id: userId, updatedAt: '' };
  const user = response.data.users.find((candidate) => candidate.id === userId);
  if (!user) throw new Error(`Managed user ${userId} is missing.`);
  return user;
}

async function patchManagedUser(userId, cookie, body, expectedUpdatedAt) {
  const version = expectedUpdatedAt || (await managedUserSnapshot(userId, cookie)).updatedAt;
  return request(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    cookie,
    body: { ...body, expectedUpdatedAt: version },
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
  const headers = new Headers(options.headers || {});
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
