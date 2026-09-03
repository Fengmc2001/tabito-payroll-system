import {
  BOOTSTRAP_ADMIN_EMAIL,
  GRAY_SEED_CONFIRMATION,
  GRAY_SEED_TAG,
  PayrollClient,
  accountSpecs,
  assert,
  assertGrayMaintenancePreflight,
  assertMonth,
  credentialPath,
  currentMonthShanghai,
  digest,
  grayAdminSalarySpec,
  grayBaseUrl,
  grayDelegatedSalarySpec,
  grayStaffSalarySpecs,
  grayTeacherSalarySpecs,
  loadOrCreateCredentials,
  minimalPdf,
} from './gray-fixture-common.mjs';

const baseUrl = grayBaseUrl();
const month = assertMonth(process.env.PAYROLL_GRAY_MONTH || currentMonthShanghai());
const client = new PayrollClient(baseUrl);
const seededFiles = new Set();
const seededRecords = new Map();
const seededBatches = new Set();

if (process.env.PAYROLL_GRAY_CONFIRM !== GRAY_SEED_CONFIRMATION) {
  throw new Error(`请显式设置 PAYROLL_GRAY_CONFIRM=${GRAY_SEED_CONFIRMATION} 后再初始化灰度数据。`);
}

const preflight = await client.expect('/api/admin/gray-fixtures', 200);
assertGrayMaintenancePreflight(preflight.data);
const bootstrap = await client.expect('/api/bootstrap-status', 200);
const credentials = await loadOrCreateCredentials(baseUrl, Boolean(bootstrap.data.bootstrap?.bootstrapRequired), month);
const credentialByKey = new Map(credentials.accounts.map((account) => [account.key, account]));
const adminCredentials = credentialByKey.get('lingling');
assert(adminCredentials, '缺少首管理员凭据。');

let adminSession;
if (bootstrap.data.bootstrap?.bootstrapRequired) {
  adminSession = await client.register(adminCredentials);
} else {
  adminSession = await client.login(adminCredentials);
}
assert(adminSession.account.role === 'admin', '首账号不是管理员。');
assert(adminSession.account.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase(), '首管理员邮箱不符合固定值。');

adminSession = await completeProfile(adminSession, adminCredentials, 0);
await client.expect('/api/admin/settings', 200, {
  method: 'PATCH',
  cookie: adminSession.cookie,
  body: { registrationOpen: true },
});

let managed = (await client.expect('/api/admin/users', 200, { cookie: adminSession.cookie })).data.users;
const allowedEmails = new Set(accountSpecs.map((account) => account.email.toLowerCase()));
const unexpected = managed.filter((user) => !allowedEmails.has(user.email.toLowerCase()));
if (unexpected.length > 0) {
  throw new Error(
    `灰度库包含非本套测试账号：${unexpected.map((user) => user.email).join('、')}。`
    + '请使用独立的灰度 D1/R2，或先执行受保护的灰度清除。',
  );
}

const sessions = new Map([['lingling', adminSession]]);
for (let index = 1; index < credentials.accounts.length; index += 1) {
  const credentialsForUser = credentials.accounts[index];
  let session = await loginIfPossible(credentialsForUser);
  if (!session) {
    const registration = await client.request('/api/users', {
      method: 'POST',
      body: { email: credentialsForUser.email, passwordDigest: digest(credentialsForUser.password) },
    });
    if (registration.status === 201) {
      session = { account: registration.data.account, cookie: cookieFromResponse(registration) };
    } else if (registration.status === 409) {
      managed = (await client.expect('/api/admin/users', 200, { cookie: adminSession.cookie })).data.users;
      const existing = managed.find((user) => user.email.toLowerCase() === credentialsForUser.email.toLowerCase());
      assert(existing, `无法找到已存在的灰度账号 ${credentialsForUser.email}。`);
      await client.expect(`/api/admin/users/${existing.id}/password`, 200, {
        method: 'POST',
        cookie: adminSession.cookie,
        body: {
          newPasswordDigest: digest(credentialsForUser.password),
          expectedUpdatedAt: existing.updatedAt,
        },
      });
      session = await client.login(credentialsForUser);
    } else {
      throw new Error(`创建 ${credentialsForUser.email} 失败：HTTP ${registration.status} ${JSON.stringify(registration.data)}`);
    }
  }
  session = await completeProfile(session, credentialsForUser, index);
  sessions.set(credentialsForUser.key, session);
}

managed = (await client.expect('/api/admin/users', 200, { cookie: adminSession.cookie })).data.users;
for (const spec of credentials.accounts) {
  const user = managed.find((candidate) => candidate.email.toLowerCase() === spec.email.toLowerCase());
  assert(user, `缺少灰度账号 ${spec.email}。`);
  const update = await client.expect(`/api/admin/users/${user.id}`, 200, {
    method: 'PATCH',
    cookie: adminSession.cookie,
    body: {
      role: spec.role,
      status: 'active',
      workManager: spec.key === 'lingling',
      expectedUpdatedAt: user.updatedAt,
    },
  });
  assert(update.data.user.role === spec.role, `${spec.name} 的角色设置失败。`);
}

// Refresh sessions so account payloads and role-dependent checks reflect the final setup.
for (const credentialsForUser of credentials.accounts) {
  sessions.set(credentialsForUser.key, await client.login(credentialsForUser));
}
adminSession = sessions.get('lingling');
const adminUserId = adminSession.account.id;

const adminRecord = await ensureAdminCommission(adminSession);
seededRecords.set(adminRecord.id, adminRecord);

for (const [index, spec] of grayStaffSalarySpecs.entries()) {
  const target = sessions.get(spec.key).account;
  const records = await ensureCalendarBatch(target, spec, index + 3);
  const reviewerCookie = spec.key === 'aiwei' && spec.decision === 'approve'
    ? sessions.get('aiwei').cookie
    : adminSession.cookie;
  await setDecision(records, spec.decision, reviewerCookie);
}

for (const spec of grayTeacherSalarySpecs) {
  const target = sessions.get(spec.key).account;
  const records = await ensureRecurringTeachingBatch(target, spec);
  const actualTotal = records.reduce((sum, record) => sum + record.finalSalary, 0);
  assert(actualTotal === spec.total, `${target.profile.lastNameCn}${target.profile.firstNameCn} 的月工资总额不正确。`);
  await setDecision(records, spec.decision, adminSession.cookie);
}

const dCny = await ensureDelegatedSingle(
  sessions.get(grayDelegatedSalarySpec.key).account,
  grayDelegatedSalarySpec,
);
await setDecision([dCny], grayDelegatedSalarySpec.decision, adminSession.cookie);

// The selected operating policy permits reviewers and administrators to approve
// their own submissions. The gray fixture deliberately exercises both cases.
await setDecision([adminRecord], grayAdminSalarySpec.decision, adminSession.cookie);

const rulesResponse = await client.expect('/api/staff/payroll/rules', 200, { cookie: adminSession.cookie });
const grayRules = rulesResponse.data.rules.filter((rule) => rule.title.startsWith('[GRAY v1]'));
for (const rule of grayRules) {
  assert(rule.active === true, `规律 ${rule.title} 未启用。`);
}

const manifest = [
  ...[...sessions.values()].map((session) => ({ type: 'user', id: session.account.id })),
  ...[...seededRecords.keys()].map((id) => ({ type: 'salary', id })),
  ...[...seededBatches].map((id) => ({ type: 'batch', id })),
  ...grayRules.map((rule) => ({ type: 'rule', id: rule.id })),
  ...[...seededFiles].map((id) => ({ type: 'file', id })),
];
await client.expect('/api/admin/gray-fixtures', 201, {
  method: 'POST',
  cookie: adminSession.cookie,
  body: { seedTag: GRAY_SEED_TAG, entities: manifest },
});

const detail = await client.expect('/api/admin/gray-fixtures?detail=1', 200, { cookie: adminSession.cookie });
assert(detail.data.counts.users === accountSpecs.length, `灰度账号数应为 ${accountSpecs.length}。`);

process.stdout.write(`${JSON.stringify({
  result: 'READY',
  baseUrl,
  month,
  credentialsFile: credentialPath,
  credentialsFileMode: '0600',
  accounts: credentials.accounts.map(({ name, email, role }) => ({ name, email, role })),
  counts: detail.data.counts,
  note: '密码未输出，仅保存在 credentialsFile。',
}, null, 2)}\n`);

async function loginIfPossible(credentialsForUser) {
  const response = await client.request('/api/users/login', {
    method: 'POST',
    body: { email: credentialsForUser.email, passwordDigest: digest(credentialsForUser.password) },
  });
  if (response.status === 401) return null;
  if (response.status !== 200) {
    throw new Error(`登录 ${credentialsForUser.email} 失败：HTTP ${response.status} ${JSON.stringify(response.data)}`);
  }
  return { account: response.data.account, cookie: cookieFromResponse(response) };
}

async function completeProfile(session, spec, index) {
  const [lastNameCn, firstNameCn] = spec.nameParts;
  const basics = {
    lastNameCn,
    firstNameCn,
    address: `东京都新宿区旅人教育灰度测试地址 ${index + 1} 号`,
    tel: `手机：090-8000-${String(index).padStart(4, '0')}\n工作联系：gray-${spec.key}`,
  };
  if (!session.account.profile.lastNameCn || !session.account.profile.firstNameCn
    || !session.account.profile.address || !session.account.profile.tel) {
    const basicResponse = await client.expect(`/api/users/${session.account.id}`, 200, {
      method: 'PATCH',
      cookie: session.cookie,
      body: { profile: { ...session.account.profile, ...basics } },
    });
    session = { ...session, account: basicResponse.data.account };
  }
  let bankKey = session.account.profile.bankFileNames[0];
  if (!bankKey) {
    const uploaded = await uploadPdf(
      '/api/uploads',
      session.cookie,
      `gray-bank-${spec.key}.pdf`,
      `Gray fixture bank proof for ${spec.name}`,
    );
    bankKey = uploaded.key;
    seededFiles.add(bankKey);
  } else {
    seededFiles.add(bankKey);
  }
  const response = await client.expect(`/api/users/${session.account.id}`, 200, {
    method: 'PATCH',
    cookie: session.cookie,
    body: {
      profile: {
        ...session.account.profile,
        ...basics,
        birthday: `199${index % 8}-0${(index % 8) + 1}-15`,
        gender: index % 3 === 0 ? '其他' : index % 2 === 0 ? '女' : '男',
        idType: 'passport',
        nationality: '中国',
        idFileNames: [],
        activityPermission: '有',
        dependents: '无',
        bankType: spec.bankType,
        bankName: spec.bankType === 'cn-bank' ? '旅人测试银行（中国）' : '旅人测试银行（日本）',
        bankBranch: spec.bankType === 'cn-bank' ? '上海测试支行' : '新宿测试支店',
        bankAccountNumber: `${spec.bankType === 'cn-bank' ? '62' : '10'}${String(260_900 + index).padStart(10, '0')}`,
        bankAccountHolder: spec.name,
        payeeIsSelf: '是',
        payeeName: spec.name,
        payeeIdNumber: `GRAY-${String(index + 1).padStart(4, '0')}`,
        bankFileNames: [bankKey],
      },
    },
  });
  return { ...session, account: response.data.account };
}

async function ensureAdminCommission(session) {
  const marker = markerFor(grayAdminSalarySpec.slug);
  const existing = session.account.salaryRecords.find((record) => record.memo === marker && record.workDate.startsWith(month));
  if (existing) {
    for (const key of existing.attachments) seededFiles.add(key);
    if (existing.status !== 1) return existing;
    const submitted = await client.expect(`/api/salary-records/apply/${session.account.id}`, 200, {
      method: 'POST',
      cookie: session.cookie,
      body: { month },
    });
    const converged = submitted.data.records.find((record) => record.id === existing.id);
    assert(converged?.status === 2, '已存在的管理员佣金草稿未能继续提交。');
    return converged;
  }
  const proof = await uploadPdf(
    '/api/uploads',
    session.cookie,
    `gray-commission-${month}.pdf`,
    `Gray commission proof ${month}`,
  );
  seededFiles.add(proof.key);
  const record = salaryTemplate(session.account, {
    ...grayAdminSalarySpec,
    date: `${month}-02`,
    attachments: [proof.key],
  });
  const created = await client.expect('/api/salary-records', 201, {
    method: 'POST',
    cookie: session.cookie,
    body: record,
  });
  const submitted = await client.expect(`/api/salary-records/apply/${session.account.id}`, 200, {
    method: 'POST',
    cookie: session.cookie,
    body: { month },
  });
  const converged = submitted.data.records.find((record) => record.id === created.data.record.id);
  assert(converged?.status === 2, '管理员佣金创建后未能提交。');
  return converged;
}

async function ensureCalendarBatch(target, spec, day) {
  const template = salaryTemplate(target, {
    ...spec,
    date: `${month}-${String(day).padStart(2, '0')}`,
  });
  const response = await client.expect('/api/staff/payroll/batches', 201, {
    method: 'POST',
    cookie: adminSession.cookie,
    body: {
      requestId: requestIdFor(spec.slug),
      targetUserId: target.id,
      month,
      mode: 'calendar',
      submit: true,
      template,
      calendarSessions: [{
        workDate: template.workDate,
        startTime: template.startTime,
        endTime: template.endTime,
        restHours: 0,
      }],
      recurring: { enabled: false, title: '', startMonth: month, endMonth: '' },
    },
  });
  rememberBatch(response.data.records);
  return response.data.records;
}

async function ensureRecurringTeachingBatch(target, spec) {
  const slug = `${spec.key}-${spec.currency.toLowerCase()}`;
  const template = salaryTemplate(target, {
    slug,
    currency: spec.currency,
    total: spec.unit,
    hourlyRate: spec.unit / 2,
    applyType: spec.applyType,
    label: spec.label,
    date: `${month}-01`,
  });
  const firstWeekday = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  const response = await client.expect('/api/staff/payroll/batches', 201, {
    method: 'POST',
    cookie: adminSession.cookie,
    body: {
      requestId: requestIdFor(slug),
      targetUserId: target.id,
      month,
      mode: 'fixed',
      submit: true,
      template,
      fixedSchedule: {
        rangeStart: `${month}-01`,
        rangeEnd: `${month}-28`,
        weekdays: [firstWeekday],
        startTime: '18:00',
        endTime: '20:00',
        restHours: 0,
      },
      recurring: {
        enabled: true,
        title: `[GRAY v1] ${target.profile.lastNameCn}${target.profile.firstNameCn} 固定授课`,
        startMonth: month,
        endMonth: '',
      },
    },
  });
  rememberBatch(response.data.records);
  return response.data.records;
}

async function ensureDelegatedSingle(target, spec) {
  const marker = markerFor(spec.slug);
  const listing = await client.expect(
    `/api/staff/payroll/records?userId=${encodeURIComponent(target.id)}&month=${month}`,
    200,
    { cookie: adminSession.cookie },
  );
  const existing = listing.data.records.find((record) => record.memo === marker);
  if (existing) {
    seededRecords.set(existing.id, existing);
    for (const key of existing.attachments) seededFiles.add(key);
    return existing;
  }
  const proof = await uploadPdf(
    `/api/staff/payroll/uploads/${encodeURIComponent(target.id)}`,
    adminSession.cookie,
    `gray-${spec.slug}-${month}.pdf`,
    `Gray delegated proof ${spec.slug}`,
  );
  seededFiles.add(proof.key);
  const record = salaryTemplate(target, {
    ...spec,
    date: `${month}-26`,
    attachments: [proof.key],
  });
  const created = await client.expect('/api/staff/payroll/records', 201, {
    method: 'POST',
    cookie: adminSession.cookie,
    body: { targetUserId: target.id, record, submit: true },
  });
  seededRecords.set(created.data.record.id, created.data.record);
  return created.data.record;
}

async function setDecision(records, decision, cookie) {
  for (const source of records) {
    seededRecords.set(source.id, source);
    if (source.batchId) seededBatches.add(source.batchId);
    if (decision === 'pending') {
      assert(source.status === 2, `记录 ${source.id} 应保持待审核。`);
      continue;
    }
    const expectedStatus = decision === 'approve' ? 3 : 4;
    if (source.status === expectedStatus) continue;
    assert(source.status === 2, `记录 ${source.id} 已处于不可变更的状态 ${source.status}。`);
    const reviewed = await client.expect(`/api/review/salary-records/${source.id}`, 200, {
      method: 'PATCH',
      cookie,
      body: {
        decision,
        auditMemo: decision === 'reject' ? '灰度数据：故意驳回，用于验证完整状态流转。' : '灰度数据审核通过。',
      },
    });
    seededRecords.set(reviewed.data.record.id, reviewed.data.record);
  }
}

function salaryTemplate(target, spec) {
  const timestamp = new Date().toISOString();
  const applyType = spec.applyType ?? 6;
  return {
    id: `salary-gray-v1-${spec.slug}-${month.replace('-', '')}`,
    userId: target.id,
    workDate: spec.date,
    checkUserId: adminUserId,
    checkUser: '泠泠',
    departmentKey: spec.slug.includes('teaching') || spec.slug.startsWith('teacher-') ? 'dept-teaching' : 'dept-affairs',
    departmentLabel: spec.slug.includes('teaching') || spec.slug.startsWith('teacher-') ? '教学部' : '事务部',
    currency: spec.currency,
    applyType,
    workContent: `灰度测试：${spec.label}`,
    memo: markerFor(spec.slug),
    rate: applyType === 1 ? spec.hourlyRate : spec.total,
    startTime: spec.startTime || '09:00',
    endTime: spec.endTime || '10:00',
    amount: 0,
    travelStart: '',
    travelEnd: '',
    travelFee: 0,
    totalHours: 0,
    workHours: 0,
    restHours: 0,
    finalSalary: 0,
    attachments: spec.attachments || [],
    status: 1,
    checkDate: null,
    auditMemo: '',
    createdByUserId: adminUserId,
    createdByName: '泠泠',
    submittedByUserId: '',
    submittedByName: '',
    source: 'gray-seed',
    batchId: null,
    recurringRuleId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function rememberBatch(records) {
  for (const record of records) {
    seededRecords.set(record.id, record);
    if (record.batchId) seededBatches.add(record.batchId);
  }
}

async function uploadPdf(path, cookie, filename, label) {
  const formData = new FormData();
  formData.set('file', new File([minimalPdf(label)], filename, { type: 'application/pdf' }));
  const upload = await client.expect(path, 201, { method: 'POST', cookie, formData });
  return upload.data.file;
}

function requestIdFor(slug) {
  return `batch-request-gray-v1-${slug}-${month.replace('-', '')}`;
}

function markerFor(slug) {
  return `[GRAY-v1:${slug}:${month}]`;
}

function cookieFromResponse(response) {
  const cookie = (response.headers.get('set-cookie') || '').split(';', 1)[0];
  assert(cookie.startsWith('xly_payroll_session='), '注册响应没有会话 Cookie。');
  return cookie;
}
