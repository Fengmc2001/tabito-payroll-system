import { createHash, randomUUID } from 'node:crypto';

const baseUrl = process.env.PAYROLL_DEMO_BASE_URL || 'http://localhost:3100';
const adminCredentials = {
  email: process.env.PAYROLL_DEMO_ADMIN_EMAIL || 'TabitoAdimin01@tabitoedu.com',
  password: process.env.PAYROLL_DEMO_ADMIN_PASSWORD || 'TabitoAdmin2026!',
};
const employeeCredentials = {
  email: process.env.PAYROLL_DEMO_EMPLOYEE_EMAIL || 'employee@tabito.local',
  password: process.env.PAYROLL_DEMO_EMPLOYEE_PASSWORD || 'TabitoEmployee2026!',
};
const demoRecords = [
  { marker: '[LOCAL-DEMO-SEED-JPY]', currency: 'JPY', amount: 8000, label: '日元教学资料整理' },
  { marker: '[LOCAL-DEMO-SEED-CNY]', currency: 'CNY', amount: 5000, label: '人民币事务支援' },
];

let adminCookie = '';

try {
  let adminSession = await loginOrRegister(adminCredentials);
  adminCookie = adminSession.cookie;
  assert(adminSession.account.role === 'admin', `${adminCredentials.email} 不是管理员，请换用空的演示数据库。`);

  adminSession = await saveBasicProfile(adminSession, {
    lastNameCn: '系统',
    firstNameCn: '管理员',
    address: '旅人教育本地演示办公室',
    tel: '本地演示账号\nTabitoAdimin01@tabitoedu.com',
  });

  await expect('/api/admin/settings', 200, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { registrationOpen: true },
  });

  adminSession = await completePayrollProfile(adminSession, {
    lastNameCn: '系统',
    firstNameCn: '管理员',
    bankAccountHolder: 'TABITO ADMIN',
    bankAccountNumber: '0000001',
  });
  await expect(`/api/admin/users/${adminSession.account.id}`, 200, {
    method: 'PATCH', cookie: adminCookie, body: { workManager: true },
  });

  let employeeSession = await loginOrRegister(employeeCredentials);
  employeeSession = await saveBasicProfile(employeeSession, {
    lastNameCn: '测试',
    firstNameCn: '员工',
    address: '东京都新宿区本地演示地址 1-2-3',
    tel: '手机：090-0000-0000\n微信：tabito-demo\n紧急联系人：测试家属 080-0000-0000',
  });

  const roleResponse = await expect(`/api/admin/users/${employeeSession.account.id}`, 200, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { role: 'employee', status: 'active' },
  });
  assert(roleResponse.data.user.role === 'employee', '员工角色写入失败。');

  employeeSession = await completePayrollProfile(employeeSession, {
    lastNameCn: '测试',
    firstNameCn: '员工',
    bankAccountHolder: 'TABITO EMPLOYEE',
    bankAccountNumber: '0001234',
  });

  const pendingRecords = employeeSession.account.salaryRecords.filter(
    (record) => demoRecords.some((spec) => spec.marker === record.memo) && record.status === 2,
  );
  const existingMarkers = new Set(pendingRecords.map((record) => record.memo));
  const createdIds = [];
  for (const spec of demoRecords.filter((record) => !existingMarkers.has(record.marker))) {
    const proof = await uploadDemoPdf(employeeSession.cookie, `demo-work-proof-${spec.currency.toLowerCase()}.pdf`, `Local demo ${spec.currency} proof`);
    const timestamp = new Date().toISOString();
    const salaryId = `salary-local-demo-${randomUUID()}`;
    const created = await expect('/api/salary-records', 201, {
      method: 'POST', cookie: employeeSession.cookie, body: {
        id: salaryId, userId: employeeSession.account.id, workDate: timestamp.slice(0, 10),
        checkUserId: adminSession.account.id, checkUser: '系统管理员', departmentKey: 'dept-affairs', departmentLabel: '事务部', currency: spec.currency,
        applyType: 6, workContent: `本地审批演示：${spec.label}`, memo: spec.marker, rate: spec.amount,
        startTime: '', endTime: '', amount: 0, travelStart: '', travelEnd: '', travelFee: 0,
        totalHours: 0, workHours: 0, restHours: 0, finalSalary: 0, attachments: [proof.key], status: 1,
        checkDate: null, auditMemo: '', createdAt: timestamp, updatedAt: timestamp,
      },
    });
    assert(created.data.record.finalSalary === spec.amount, `${spec.currency} 演示工资金额计算错误。`);
    assert(created.data.record.currency === spec.currency, `${spec.currency} 币种写入失败。`);
    createdIds.push(salaryId);
  }
  if (createdIds.length > 0) {
    const submitted = await expect(`/api/salary-records/apply/${employeeSession.account.id}`, 200, { method: 'POST', cookie: employeeSession.cookie });
    for (const id of createdIds) assert(submitted.data.records.some((record) => record.id === id && record.status === 2), '演示工资没有进入待审核状态。');
    pendingRecords.push(...submitted.data.records.filter((record) => createdIds.includes(record.id)));
  }

  const managedUsers = await expect('/api/admin/users', 200, { cookie: adminCookie });
  assert(managedUsers.data.users.some((user) => user.email.toLowerCase() === adminCredentials.email.toLowerCase() && user.role === 'admin'), '管理员账号验证失败。');
  assert(managedUsers.data.users.some((user) => user.email === employeeCredentials.email && user.role === 'employee'), '员工账号验证失败。');

  const reviewQueue = await expect('/api/review/salary-records?status=2', 200, { cookie: adminCookie });
  const queuedItems = reviewQueue.data.items.filter((item) => pendingRecords.some((record) => record.id === item.record.id));
  assert(queuedItems.length === 2, '审批队列中应同时存在两条双币种演示工资。');
  assert(queuedItems.some((item) => item.record.currency === 'JPY' && item.record.finalSalary === 8000), '日元演示金额不正确。');
  assert(queuedItems.some((item) => item.record.currency === 'CNY' && item.record.finalSalary === 5000), '人民币演示金额不正确。');

  const attachment = await request(`/api/files?key=${encodeURIComponent(queuedItems[0].record.attachments[0])}`, {
    cookie: adminCookie,
    raw: true,
  });
  assert(attachment.status === 200, '管理员无法读取待审批附件。');

  const forbidden = await request('/api/admin/users', { cookie: employeeSession.cookie });
  assert(forbidden.status === 403, '员工不应能访问账号权限接口。');

  const registration = await expect('/api/admin/settings', 200, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { registrationOpen: true },
  });
  assert(registration.data.settings.registrationOpen === true, '公开注册应保持开放。');

  process.stdout.write(`${JSON.stringify({
    result: 'READY',
    baseUrl,
    accounts: [
      { role: 'admin', ...adminCredentials },
      { role: 'employee', ...employeeCredentials },
    ],
    pendingSalaries: queuedItems.map((item) => ({ id: item.record.id, employee: employeeCredentials.email, currency: item.record.currency, amount: item.record.finalSalary, status: 'pending' })),
    registrationOpen: true,
    accountCount: managedUsers.data.users.length,
  }, null, 2)}\n`);
} catch (error) {
  if (adminCookie) {
    await request('/api/admin/settings', {
      method: 'PATCH',
      cookie: adminCookie,
      body: { registrationOpen: true },
    }).catch(() => {});
  }
  throw error;
}

async function saveBasicProfile(session, values) {
  const response = await expect(`/api/users/${session.account.id}`, 200, {
    method: 'PATCH',
    cookie: session.cookie,
    body: { profile: { ...session.account.profile, ...values } },
  });
  return { ...session, account: response.data.account };
}

async function completePayrollProfile(session, values) {
  let idFileKey = session.account.profile.idFileNames[0];
  if (!idFileKey) {
    idFileKey = (await uploadDemoPdf(session.cookie, 'demo-passport.pdf', 'Local demo passport')).key;
  }
  let bankFileKey = session.account.profile.bankFileNames[0];
  if (!bankFileKey) {
    bankFileKey = (await uploadDemoPdf(session.cookie, 'demo-bank-card.pdf', 'Local demo bank card')).key;
  }
  const response = await expect(`/api/users/${session.account.id}`, 200, {
    method: 'PATCH',
    cookie: session.cookie,
    body: {
      profile: {
        ...session.account.profile,
        ...values,
        birthday: '1995-01-01',
        gender: '其他',
        idType: 'passport',
        idFileNames: [idFileKey],
        nationality: '中国',
        dependents: '无',
        bankType: 'jp-bank',
        bankName: '本地演示银行',
        bankBranch: '测试支店',
        bankFileNames: [bankFileKey],
        payeeIsSelf: '是',
      },
    },
  });
  return { ...session, account: response.data.account };
}

async function loginOrRegister(credentials) {
  const login = await request('/api/users/login', {
    method: 'POST',
    body: { email: credentials.email, passwordDigest: digest(credentials.password) },
  });
  if (login.status === 200) return { account: login.data.account, cookie: cookieFrom(login) };
  if (login.status !== 401) throw new Error(`登录 ${credentials.email} 失败：HTTP ${login.status} ${JSON.stringify(login.data)}`);

  const registration = await request('/api/users', {
    method: 'POST',
    body: { email: credentials.email, passwordDigest: digest(credentials.password) },
  });
  if (registration.status !== 201) {
    throw new Error(`创建 ${credentials.email} 失败：HTTP ${registration.status} ${JSON.stringify(registration.data)}`);
  }
  return { account: registration.data.account, cookie: cookieFrom(registration) };
}

async function uploadDemoPdf(cookie, filename, label) {
  const formData = new FormData();
  formData.set('file', new File([minimalPdf(label)], filename, { type: 'application/pdf' }));
  const upload = await expect('/api/uploads', 201, { method: 'POST', cookie, formData });
  return upload.data.file;
}

function minimalPdf(label) {
  const escaped = label.replace(/[()\\]/g, (value) => `\\${value}`);
  return new TextEncoder().encode(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n`
    + `2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n`
    + `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 120]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n`
    + `4 0 obj<</Length ${escaped.length + 33}>>stream\nBT /F1 12 Tf 24 64 Td (${escaped}) Tj ET\nendstream endobj\n`
    + `5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n`
    + `trailer<</Root 1 0 R>>\n%%EOF\n`,
  );
}

async function expect(path, status, options = {}) {
  const response = await request(path, options);
  if (response.status !== status) {
    throw new Error(`${options.method || 'GET'} ${path}: expected ${status}, received ${response.status} ${JSON.stringify(response.data)}`);
  }
  return response;
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
  const responseText = await response.text();
  let data = {};
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    data = { body: responseText };
  }
  return { status: response.status, data, headers: response.headers };
}

function cookieFrom(response) {
  const cookie = (response.headers.get('set-cookie') || '').split(';', 1)[0];
  assert(cookie.startsWith('xly_payroll_session='), '登录响应没有设置会话 Cookie。');
  return cookie;
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
