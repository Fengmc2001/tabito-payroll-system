import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { appPath } from '../app/lib/app-path.ts';
import { accountAuditQuery } from '../app/lib/account-audit-query.ts';
import { createRecord, createEmptyProfile, DEFAULT_DEPARTMENTS, effectivePayee, normalizePayeeProfile,
  profileMissingRequirements, recalculateRecord, sumWorkTime, resolveWorkManager, monthIsValid, dateIsValid } from '../app/lib/payroll.ts';
import { grayRetirementPlan } from '../app/lib/gray-retirement.ts';

let checks = 0;
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const base = createRecord('isolated-calculation');
for (const currency of ['JPY', 'CNY']) {
  for (const rate of [100, 120, 500, 1000, 1200, 1500, 1560, 1800, 2000, 2400, 3000]) {
    for (let minutes = 5; minutes < 1440; minutes += 5) {
      const endTime = String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
      const result = recalculateRecord({ ...base, currency, rate, startTime: '00:00', endTime });
      equal(result.finalSalary, Number(BigInt(minutes) * BigInt(rate) / 60n), currency + ' exact minute salary');
    }
  }
}
equal(appPath('/api/files?key=a%2Fb.pdf', ''), '/api/files?key=a%2Fb.pdf', 'root attachment path');
equal(appPath('/api/files?key=a%2Fb.pdf', '/payroll/'), '/payroll/api/files?key=a%2Fb.pdf', 'subdirectory attachment path');
equal(appPath('/payroll/api/files?key=a%2Fb.pdf', '/payroll'), '/payroll/api/files?key=a%2Fb.pdf', 'do not duplicate deployment prefix');
const sameNames = [{ id: 'earlier', label: '同名', email: 'a@example.invalid' }, { id: 'later', label: '同名', email: 'b@example.invalid' }];
equal(resolveWorkManager(sameNames, 'later', '同名')?.id, 'later', 'existing manager ID wins over earlier duplicate name');
equal(resolveWorkManager(sameNames, 'deleted', '同名'), undefined, 'missing ID is not silently rebound by name');
equal(resolveWorkManager(sameNames, '', '同名'), undefined, 'ambiguous legacy name requires explicit choice');
equal(resolveWorkManager([sameNames[0]], '', '同名')?.id, 'earlier', 'unique legacy name remains supported');
const fiveMinutes = recalculateRecord({ ...base, startTime: '09:00', endTime: '09:05' });
equal(sumWorkTime(Array(12).fill(fiveMinutes)), { workHours: 1, restHours: 0 }, 'sum minutes before rounding');
const withRest = recalculateRecord({ ...base, startTime: '09:00', endTime: '10:00', restHours: 0.08 });
equal(sumWorkTime(Array(12).fill(withRest)), { workHours: 11, restHours: 1 }, 'rest minutes accumulate exactly');
const traffic = recalculateRecord({ ...base, applyType: 5, startTime: '18:00', endTime: '20:00', travelFee: 300 });
equal([traffic.finalSalary, traffic.workHours, traffic.totalHours, traffic.restHours, traffic.startTime], [300, 0, 0, 0, ''], 'traffic does not carry hidden hours');
equal(sumWorkTime([{ ...traffic, startTime: '18:00', endTime: '20:00', workHours: 2 }]).workHours, 0, 'legacy traffic hours excluded without changing stored salary');
const profile = { ...createEmptyProfile(), bankType: 'cn-bank', payeeIsSelf: '否', payeeName: '代收人', payeeIdNumber: '001234', idNumber: '009876' };
equal(effectivePayee(profile, '员工'), { name: '代收人', idNumber: '001234' }, 'other payee retained');
equal(effectivePayee({ ...profile, payeeIsSelf: '是' }, '员工'), { name: '员工', idNumber: '009876' }, 'self payment ignores stale payee fields');
equal(normalizePayeeProfile({ ...profile, bankType: 'jp-bank' }).payeeName, '', 'hidden payee cleared');
equal(profileMissingRequirements({ ...profile, bankType: 'jp-bank', payeeName: '' }).includes('收款人姓名'), false, 'no hidden mandatory payee field');

// Use the actual schema and actual retirement SQL, exclusively in memory.
const db = new DatabaseSync(':memory:');
for (const name of readdirSync(new URL('../drizzle/', import.meta.url)).filter((name) => name.endsWith('.sql')).sort()) {
  db.exec(readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
}
const now = '2026-09-06T00:00:00Z';
function insertUser(id) {
  db.prepare(`INSERT INTO payroll_users (id,email,password_digest,profile_json,role,status,created_at,updated_at)
    VALUES (?,?,'local-test','{}','admin','active',?,?)`).run(id, id + '@example.invalid', now, now);
}
insertUser('gray-admin');
db.prepare("INSERT INTO payroll_settings (key,value,updated_at) VALUES ('gray_clear_plan_v1','[]',?)").run(now);
const plan = grayRetirementPlan(now, '[]', DEFAULT_DEPARTMENTS);
function runPlan(statements) {
  db.exec('BEGIN');
  try {
    const results = statements.map(({ sql, params }) => db.prepare(sql).run(...params));
    db.exec('COMMIT');
    return results;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
equal(runPlan(grayRetirementPlan(now, 'wrong-plan', DEFAULT_DEPARTMENTS)).at(-1).changes, 0, 'mismatched generation is a no-op');
equal(db.prepare('SELECT count(*) AS n FROM payroll_users').get().n, 1, 'mismatched plan preserves users');
assert.throws(() => runPlan([...plan, { sql: 'SELECT * FROM intentionally_missing_test_table', params: [] }])); checks++;
equal(db.prepare('SELECT count(*) AS n FROM payroll_users').get().n, 1, 'transaction failure rolls back deletion');
equal(runPlan(plan).at(-1).changes, 1, 'first retirement completes exactly once');
equal(db.prepare('SELECT count(*) AS n FROM payroll_users').get().n, 0, 'gray users removed in isolated fixture');
insertUser('formal-admin');
equal(runPlan(plan).every((result) => result.changes === 0), true, 'late duplicate retirement is entirely a no-op');
equal(db.prepare('SELECT id FROM payroll_users').get().id, 'formal-admin', 'new formal administrator survives late duplicate');
equal(db.prepare('SELECT count(*) AS n FROM payroll_departments').get().n, DEFAULT_DEPARTMENTS.length, 'structural defaults preserved');
// Account log membership never comes from arbitrary free-text mentions.
insertUser('other-user');
const logInsert = db.prepare(`INSERT INTO payroll_audit_logs
  (id, actor_user_id, action, target_type, target_id, detail_json, subject_user_id, business_month, created_at)
  VALUES (?, ?, 'salary.review', 'salary_record', 'missing-record', ?, ?, ?, ?)`);
logInsert.run('mentioned-only', 'other-user', JSON.stringify({ memo: 'formal-admin' }), 'other-user', '2026-09', now);
logInsert.run('boundary', 'formal-admin', '{}', null, null, '2026-08-31T16:30:00Z');
logInsert.run('explicit-business', 'formal-admin', '{}', null, '2026-08', '2026-09-01T00:00:00Z');
logInsert.run('structured-legacy', 'other-user', JSON.stringify({ ownerUserId: 'formal-admin' }), null, null, now);
const september = accountAuditQuery('formal-admin', '2026-09');
const septemberRows = db.prepare(september.sql).all(...september.params);
equal(septemberRows.map((row) => row.id).sort(), ['boundary', 'structured-legacy'], 'precise membership and Japan fallback month');
const august = accountAuditQuery('formal-admin', '2026-08');
equal(db.prepare(august.sql).all(...august.params).map((row) => row.id), ['explicit-business'], 'business month overrides event month');
equal(new Date('2026-08-31T16:30:00Z').toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }), '2026-09-01', 'display date matches audit fallback month');

// Execute the actual auditStatement implementation against the real SQLite schema.
const serverSource = ts.createSourceFile('payroll-store.ts', readFileSync(new URL('../app/lib/server/payroll-store.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
function actualFunction(name, dependencies, sourceFile = serverSource) {
  const node = sourceFile.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, 'production function exists: ' + name);
  const js = ts.transpileModule(node.getText(sourceFile).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(dependencies), js + '; return ' + name)(...Object.values(dependencies));
}
const adapter = {
  prepare(sql) {
    return { bind(...params) {
      return {
        run() { const result = db.prepare(sql).run(...params); return { ...result, meta: { changes: result.changes } }; },
        first() { return db.prepare(sql).get(...params) ?? null; },
        all() { return { results: db.prepare(sql).all(...params) }; },
      };
    } };
  },
  batch(statements) {
    db.exec('BEGIN');
    try { const results = statements.map((statement) => statement.run()); db.exec('COMMIT'); return results; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  },
};
let auditSequence = 0;
const dimensions = actualFunction('auditDimensions', { monthIsValid, dateIsValid });
const auditStatement = actualFunction('auditStatement', { newId: () => 'regression-audit-' + ++auditSequence, auditDimensions: dimensions });
for (const targetType of ['salary_batch', 'recurring_rule']) {
  const result = auditStatement(adapter, 'formal-admin', 'salary.proxy_batch_create', targetType, 'never-created', {
    subjectUserId: 'other-user', businessMonth: '2026-09',
  }, now).run();
  equal(result.changes, 0, 'failed ' + targetType + ' does not produce a success audit');
}
equal(auditStatement(adapter, 'formal-admin', 'profile.update', 'user', 'formal-admin', {}, now).run().changes, 1, 'ordinary existing-target audit still writes');
// Force deactivation after the service preflight but before its draft UPDATE.
const proxyExisting = { ...createRecord('other-user'), id: 'proxy-race', status: 1, finalSalary: 500 };
db.prepare(`INSERT INTO payroll_salary_records (id,user_id,status,work_date,final_salary,currency,data_json,created_at,updated_at)
  VALUES (?, ?, 1, ?, 500, 'JPY', ?, ?, ?)`).run(proxyExisting.id, 'other-user', proxyExisting.workDate, JSON.stringify(proxyExisting), now, proxyExisting.updatedAt);
class LocalApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const changedAudit = actualFunction('changedSalaryAuditStatement', { auditDimensions: dimensions });
const conditionalReferences = actualFunction('conditionalSalaryFileReferenceStatements', {});
const saveProxy = actualFunction('saveProxySalaryRecord', {
  requireRole() {}, ApiError: LocalApiError, database: async () => adapter,
  requireTargetUser: async () => ({ id: 'other-user', status: 'active' }),
  requireSubmittableProfile() {},
  recordFromRow: (row) => JSON.parse(row.data_json),
  actorDisplayName: async () => '测试审核员',
  sanitizeSalaryRecord: async () => {
    db.prepare("UPDATE payroll_users SET status = 'disabled' WHERE id = 'other-user'").run();
    return { ...proxyExisting, finalSalary: 800, updatedAt: '2030-01-01T00:00:00Z' };
  },
  newId: () => 'regression-audit-' + ++auditSequence,
  changedSalaryAuditStatement: changedAudit,
  conditionalSalaryFileReferenceStatements: conditionalReferences,
});
const countBeforeRace = db.prepare('SELECT count(*) AS n FROM payroll_audit_logs').get().n;
await assert.rejects(() => saveProxy({ userId: 'formal-admin', role: 'admin' }, 'other-user', proxyExisting, true), (error) => error.status === 409);
checks++;
equal({ ...db.prepare("SELECT status, final_salary FROM payroll_salary_records WHERE id = 'proxy-race'").get() }, { status: 1, final_salary: 500 }, 'deactivated employee draft amount and submission state remain unchanged');
equal(db.prepare('SELECT count(*) AS n FROM payroll_audit_logs').get().n, countBeforeRace, 'rejected concurrent proxy save writes no audit');
const transferSource = ts.createSourceFile('TransferSheetWorkspace.tsx', readFileSync(new URL('../app/components/TransferSheetWorkspace.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let exportedBlob, exportedName;
const anchor = { click() { exportedName = this.download; }, remove() {} };
const exportSheet = actualFunction('downloadTransferSheet', {
  effectivePayee,
  paymentMethodLabel: actualFunction('paymentMethodLabel', {}, transferSource),
  escapeXml: actualFunction('escapeXml', {}, transferSource),
  Blob,
  URL: { createObjectURL(blob) { exportedBlob = blob; return 'blob:test'; }, revokeObjectURL() {} },
  document: { createElement() { return anchor; }, body: { appendChild() {} } },
  window: { setTimeout(callback) { callback(); } },
}, transferSource);
exportSheet([{
  user: { displayName: '姓名<&>' },
  profile: { ...profile, payeeIsSelf: '是', tel: '电话\\n微信', bankAccountNumber: '0001234567890123456789', bankAccountHolder: '=1+1' },
  approvedAmounts: { JPY: 1690, CNY: 200 },
}], '2026-09');
const workbook = await exportedBlob.text();
equal(exportedName, '旅人教育-工资汇总-2026-09.xls', 'export keeps expected filename');
equal((workbook.match(/<Row>/g) ?? []).length, 2, 'one header row and one employee row');
equal((workbook.match(/<Cell>/g) ?? []).length, 22, '11 columns and no PDF column');
equal(workbook.includes('<Data ss:Type="String">0001234567890123456789</Data>'), true, 'long account and leading zeros remain text');
equal(workbook.includes('<Data ss:Type="String">=1+1</Data>'), true, 'formula-looking text is not exported as a formula');
equal(workbook.includes('姓名&lt;&amp;&gt;'), true, 'XML special characters escaped');
equal(workbook.includes('代收人'), false, 'export never reuses stale third-party payee');
equal(workbook.includes('<Data ss:Type="Number">1690</Data>') && workbook.includes('<Data ss:Type="Number">200</Data>'), true, 'currency amounts remain separate numeric cells');
const auditSource = ts.createSourceFile('AuditWorkspace.tsx', readFileSync(new URL('../app/components/AuditWorkspace.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let loadCallback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(auditSource) === 'load'
    && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(auditSource) === 'useCallback') {
    loadCallback = node.initializer.arguments[0].getText(auditSource);
  }
  ts.forEachChild(node, visit);
}
visit(auditSource);
assert.ok(loadCallback);
const revision = { current: 0 };
const requests = [];
const displayed = [];
const scopes = [];
const loadingStates = [];
function loadFor(month, userId) {
  const dependencies = {
    requestRevision: revision, month, userId, URLSearchParams,
    apiRequest: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    setOverview: (value) => displayed.push(value), setLoadedScope: (value) => scopes.push(value),
    setMessage() {}, setLoading: (value) => loadingStates.push(value), errorText: (error) => error.message,
  };
  const js = ts.transpileModule('const load = ' + loadCallback, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), js + ';return load')(...Object.values(dependencies));
}
const oldLoad = loadFor('2026-08', 'old-user')();
revision.current++;
const newLoad = loadFor('2026-09', 'new-user')();
requests[1].resolve({ overview: { id: 'new-user' } }); await newLoad;
requests[0].resolve({ overview: { id: 'old-user' } }); await oldLoad;
equal(displayed, [{ id: 'new-user' }], 'late manual-refresh response cannot replace a newer account/month result');
equal(scopes, ['2026-09:new-user'], 'audit result scope remains paired with selected filters');
equal(loadingStates, [false], 'stale request cannot change loading state');
db.close();
process.stdout.write(JSON.stringify({ result: 'PASS', checks, salaryCombinations: 6314, database: 'memory-only' }, null, 2) + '\n');
