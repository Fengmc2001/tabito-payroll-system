import { stat } from 'node:fs/promises';
import {
  BOOTSTRAP_ADMIN_EMAIL,
  GRAY_FIXTURE_CNY_TO_JPY,
  GRAY_MONTHLY_LIMIT_JPY_EQUIVALENT,
  PayrollClient,
  accountSpecs,
  assert,
  assertGrayMaintenancePreflight,
  assertMonth,
  credentialPath,
  currentMonthShanghai,
  grayBaseUrl,
  grayExpectedSalarySpecs,
  loadCredentials,
} from './gray-fixture-common.mjs';

const baseUrl = grayBaseUrl();
const client = new PayrollClient(baseUrl);
const credentialDocument = await loadCredentials(baseUrl);
const month = assertMonth(process.env.PAYROLL_GRAY_MONTH || credentialDocument.month || currentMonthShanghai());
const credentials = credentialDocument.accounts;
const credentialByKey = new Map(credentials.map((account) => [account.key, account]));
const checks = [];

const mode = (await stat(credentialPath)).mode & 0o777;
check(mode === 0o600, `凭据文件权限为 0600（当前 ${mode.toString(8).padStart(4, '0')}）`);

const preflight = await client.expect('/api/admin/gray-fixtures', 200);
assertGrayMaintenancePreflight(preflight.data);
check(true, '服务端仅在固定标识的隔离灰度环境暴露维护接口');

const sessions = new Map();
for (const spec of accountSpecs) {
  const credentialsForUser = credentialByKey.get(spec.key);
  assert(credentialsForUser, `凭据文件缺少 ${spec.name}。`);
  const session = await client.login(credentialsForUser);
  sessions.set(spec.key, session);
  check(session.account.role === spec.role, `${spec.name} 角色为 ${spec.role}`);
  check(session.account.status === 'active', `${spec.name} 账号正常`);
  check(
    `${session.account.profile.lastNameCn}${session.account.profile.firstNameCn}` === spec.name,
    `${spec.name} 显示名已正确保存`,
  );
  check(session.account.profile.bankFileNames.length >= 1, `${spec.name} 有银行卡凭证`);
}

const admin = sessions.get('lingling');
check(admin.account.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase(), '空库首账号是固定管理员邮箱');
const managed = (await client.expect('/api/admin/users', 200, { cookie: admin.cookie })).data.users;
check(managed.length === accountSpecs.length, `灰度库只有 ${accountSpecs.length} 个预期账号`);
check(managed.filter((user) => user.workManager).length === 1, '仅泠泠是工作负责人');
check(
  managed.find((user) => user.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase())?.workManager === true,
  '工作负责人对应泠泠账号',
);
check(managed.every((user) => user.profileReady === true), '12 个账号均已补全工资所需资料');

const allRecords = new Map();
for (const spec of accountSpecs) {
  const target = sessions.get(spec.key).account;
  const response = await client.expect(
    `/api/staff/payroll/records?userId=${encodeURIComponent(target.id)}&month=${month}`,
    200,
    { cookie: admin.cookie },
  );
  const grayRecords = response.data.records.filter((record) => record.memo.startsWith(`[GRAY-v1:`));
  for (const record of grayRecords) allRecords.set(record.id, { ...record, accountKey: spec.key });
}

for (const spec of grayExpectedSalarySpecs) {
  const marker = `[GRAY-v1:${spec.slug}:${month}]`;
  const matching = [...allRecords.values()].filter((record) => record.accountKey === spec.key && record.memo === marker);
  check(matching.length === spec.count, `${spec.slug} 有 ${spec.count} 条且无重复`);
  check(matching.every((record) => record.currency === spec.currency), `${spec.slug} 币种为 ${spec.currency}`);
  check(matching.every((record) => record.applyType === spec.applyType), `${spec.slug} 申报类别正确`);
  const expectedDepartmentKey = spec.slug.includes('teaching') || spec.slug.startsWith('teacher-')
    ? 'dept-teaching'
    : 'dept-affairs';
  check(
    matching.every((record) => record.departmentKey === expectedDepartmentKey),
    `${spec.slug} 工作所属部门正确`,
  );
  check(
    matching.every((record) => record.workContent.includes(spec.label)),
    `${spec.slug} 工作内容与样例定义一致`,
  );
  if (spec.applyType === 1) {
    check(
      matching.every((record) => record.rate === spec.hourlyRate
        && record.workHours === 2
        && record.restHours === 0
        && record.finalSalary === record.rate * 2),
      `${spec.slug} 按时工资由两小时工时与时薪计算`,
    );
  }
  check(matching.every((record) => record.status === spec.status), `${spec.slug} 状态为 ${spec.status}`);
  check(matching.reduce((sum, record) => sum + record.finalSalary, 0) === spec.total, `${spec.slug} 月度合计正确`);
}

check(allRecords.size === 35, '灰度工资共 35 条');
check([...allRecords.values()].every((record) => record.finalSalary > 0), '每条灰度工资金额均为正数');
const monthlyTotals = monthlyTotalsByAccount([...allRecords.values()]);
for (const spec of accountSpecs) {
  const totals = monthlyTotals.get(spec.key) || { JPY: 0, CNY: 0 };
  const jpyEquivalent = totals.JPY + totals.CNY * GRAY_FIXTURE_CNY_TO_JPY;
  check(
    jpyEquivalent <= GRAY_MONTHLY_LIMIT_JPY_EQUIVALENT,
    `${spec.name} 测试月合计不超过 JPY ${GRAY_MONTHLY_LIMIT_JPY_EQUIVALENT.toLocaleString()} 等值`,
  );
}
check(new Set([...allRecords.values()].map((record) => record.status)).size === 3, '待审、通过、驳回三种状态齐全');
check(
  new Set([...allRecords.values()].filter((record) => record.accountKey === 'teacher-f').map((record) => record.currency)).size === 1
    && [...allRecords.values()].filter((record) => record.accountKey === 'teacher-f').every((record) => record.currency === 'CNY'),
  '授课老师 F 仅有 CNY',
);
check(
  new Set([...allRecords.values()].filter((record) => record.accountKey === 'teacher-g').map((record) => record.currency)).size === 1
    && [...allRecords.values()].filter((record) => record.accountKey === 'teacher-g').every((record) => record.currency === 'CNY'),
  '授课老师 G 仅有 CNY',
);
check(
  new Set([...allRecords.values()].filter((record) => record.accountKey === 'teacher-d').map((record) => record.currency)).size === 2,
  '授课老师 D 同时有 JPY 和 CNY',
);
check([...allRecords.values()].some((record) => record.source === 'self'), '灰度数据覆盖本人申报');
check([...allRecords.values()].some((record) => record.source === 'proxy-single'), '灰度数据覆盖他人单条申报');
check([...allRecords.values()].some((record) => record.source === 'proxy-batch'), '灰度数据覆盖他人多条申报');

const rules = (await client.expect('/api/staff/payroll/rules', 200, { cookie: admin.cookie })).data.rules
  .filter((rule) => rule.title.startsWith('[GRAY v1]'));
check(rules.length === 7, '每位授课老师都有一条结构化自动规律');
check(rules.every((rule) => rule.active && rule.startMonth === month), '灰度自动规律均已启用且从所选月生效');
check(rules.every((rule) => rule.schedule.rangeStart.endsWith('-01') && rule.schedule.rangeEnd.endsWith('-28')), '自动规律使用每月固定日期范围');

const audit = await client.expect('/api/admin/audit-logs?limit=200', 200, { cookie: admin.cookie });
const auditYear = month.slice(0, 4);
const adminOverview = await client.expect(
  `/api/audit/overview?year=${auditYear}&month=${month}&userId=${encodeURIComponent(admin.account.id)}`,
  200,
  { cookie: admin.cookie },
);
const aiweiAccount = sessions.get('aiwei').account;
const aiweiOverview = await client.expect(
  `/api/audit/overview?year=${auditYear}&month=${month}&userId=${encodeURIComponent(aiweiAccount.id)}`,
  200,
  { cookie: admin.cookie },
);
const scopedAuditLogs = [...adminOverview.data.overview.accountLogs, ...aiweiOverview.data.overview.accountLogs];
const actions = new Set([...audit.data.logs, ...scopedAuditLogs].map((log) => log.action));
for (const action of ['salary.proxy_batch_submit', 'salary.proxy_submit', 'salary.rule_create', 'salary.approve', 'salary.reject']) {
  check(actions.has(action), `审计记录包含 ${action}`);
}
const adminOwnRecord = [...allRecords.values()].find((record) => record.accountKey === 'lingling');
const reviewerOwnRecord = [...allRecords.values()].find(
  (record) => record.accountKey === 'aiwei' && record.memo.includes(':aiwei-teaching:'),
);
check(
  adminOverview.data.overview.accountLogs.some((log) => log.action === 'salary.approve'
    && log.targetId === adminOwnRecord?.id
    && log.actorUserId === admin.account.id
    && log.detail.ownerUserId === admin.account.id),
  '管理员可审核本人申报且审计来源完整',
);
check(
  aiweiOverview.data.overview.accountLogs.some((log) => log.action === 'salary.approve'
    && log.targetId === reviewerOwnRecord?.id
    && log.actorUserId === aiweiAccount.id
    && log.detail.ownerUserId === aiweiAccount.id),
  '审核员可审核本人申报且审计来源完整',
);

const teacherA = sessions.get('teacher-a');
const reviewer = sessions.get('up');
await expectForbidden('/api/admin/users', teacherA.cookie, '普通员工不能查看账号权限');
await expectForbidden('/api/admin/gray-fixtures?detail=1', teacherA.cookie, '普通员工不能查看灰度维护详情');
await expectForbidden('/api/staff/payroll/users', teacherA.cookie, '普通员工不能为他人申报');
await expectForbidden('/api/staff/payroll/rules', teacherA.cookie, '普通员工不能查看自动规律');
await expectForbidden('/api/admin/gray-fixtures?detail=1', reviewer.cookie, '审核员不能进入破坏性灰度维护接口');
await client.expect('/api/staff/payroll/users', 200, { cookie: reviewer.cookie });
check(true, '审核员可查看代申报账号目录');

const bankKey = teacherA.account.profile.bankFileNames[0];
await client.expect(`/api/files?key=${encodeURIComponent(bankKey)}`, 200, { cookie: teacherA.cookie });
check(true, '员工可读取自己的附件');
await client.expect(`/api/files?key=${encodeURIComponent(bankKey)}`, 200, { cookie: reviewer.cookie });
check(true, '审核员可读取员工附件');
await client.expect(`/api/files?key=${encodeURIComponent(bankKey)}`, 200, { cookie: admin.cookie });
check(true, '管理员可读取员工附件');

const detail = await client.expect('/api/admin/gray-fixtures?detail=1', 200, { cookie: admin.cookie });
check(detail.data.counts.users === 12, '灰度维护统计账号数正确');
check(detail.data.counts.salaries === 35, '灰度维护统计工资数正确');
check(detail.data.counts.rules === 7, '灰度维护统计规律数正确');
check(detail.data.counts.marked >= 79, '灰度实体清单已登记');

process.stdout.write(`${JSON.stringify({
  result: 'PASS',
  baseUrl,
  month,
  checks: checks.length,
  accounts: managed.length,
  salaries: allRecords.size,
  rules: rules.length,
  statusCounts: countBy([...allRecords.values()], (record) => String(record.status)),
  currencyCounts: countBy([...allRecords.values()], (record) => record.currency),
  monthlyTotals: Object.fromEntries(monthlyTotals),
  fixtureMonthlyLimit: {
    jpyEquivalent: GRAY_MONTHLY_LIMIT_JPY_EQUIVALENT,
    cnyToJpy: GRAY_FIXTURE_CNY_TO_JPY,
  },
}, null, 2)}\n`);

async function expectForbidden(path, cookie, label) {
  const response = await client.request(path, { cookie });
  check(response.status === 403, label);
}

function check(condition, label) {
  assert(condition, `FAIL: ${label}`);
  checks.push(label);
}

function countBy(items, selector) {
  return items.reduce((counts, item) => {
    const key = selector(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function monthlyTotalsByAccount(records) {
  const totals = new Map();
  for (const record of records) {
    const current = totals.get(record.accountKey) || { JPY: 0, CNY: 0 };
    current[record.currency] += record.finalSalary;
    totals.set(record.accountKey, current);
  }
  return totals;
}
