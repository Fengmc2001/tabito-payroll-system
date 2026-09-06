import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { RESET_KEY, LOCK_KEY, RESET_TABLES, objectKeyPath, acquireResetSql, freezeWritesSql,
  clearBusinessSql, finishResetSql, runServerRelease } from './deployment-reset-plan.mjs';

let checks = 0;
const equal = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
const db = new DatabaseSync(':memory:');
for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter((name) => name.endsWith('.sql')).sort()) {
  db.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
}
const userSql = `INSERT INTO payroll_users (id,email,password_digest,profile_json,role,status,created_at,updated_at)
  VALUES (?,?,'test-only','{}','admin','active','2026-09-06','2026-09-06')`;
db.prepare(userSql).run('old-admin', 'old@example.invalid');
function transaction(sql) {
  db.exec('BEGIN');
  try { db.exec(sql); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
}
function state() {
  return {
    phase: db.prepare('SELECT value FROM payroll_settings WHERE key = ?').get(RESET_KEY)?.value,
    owner: db.prepare('SELECT value FROM payroll_settings WHERE key = ?').get(LOCK_KEY)?.value,
  };
}
transaction(acquireResetSql('first'));
transaction(freezeWritesSql());
equal(state(), { phase: 'purging', owner: 'first' }, 'first deployment acquires maintenance ownership');
assert.throws(() => db.prepare(userSql).run('blocked', 'blocked@example.invalid'), /maintenance/); checks++;
assert.throws(() => db.exec("UPDATE payroll_users SET profile_json = '{}'"), /maintenance/); checks++;
transaction(acquireResetSql('second'));
equal(state().owner, 'first', 'concurrent deployment cannot steal ownership');
transaction(clearBusinessSql('wrong-owner', '2026-09-06'));
equal(db.prepare('SELECT count(*) AS n FROM payroll_users').get().n, 1, 'wrong owner cannot clear users');
assert.throws(() => transaction(clearBusinessSql('first', '2026-09-06') + ';SELECT * FROM missing_table')); checks++;
equal(db.prepare('SELECT count(*) AS n FROM payroll_users').get().n, 1, 'failed reset batch rolls back users');
equal(state().phase, 'purging', 'failed reset batch rolls back phase');
transaction(clearBusinessSql('first', '2026-09-06'));
equal(state().phase, 'cleared', 'reset recorded before publishing');
for (const table of RESET_TABLES.filter((table) => table !== 'payroll_departments')) {
  equal(db.prepare('SELECT count(*) AS n FROM ' + table).get().n, 0, 'cleared business table ' + table);
}
equal(db.prepare('SELECT count(*) AS n FROM payroll_departments').get().n, 5, 'default departments restored');
assert.throws(() => db.prepare(userSql).run('too-early', 'early@example.invalid'), /maintenance/); checks++;
transaction(acquireResetSql('resume', 'first'));
transaction(clearBusinessSql('resume', '2026-09-07'));
equal(state().phase, 'cleared', 'resume does not restart completed clearing');
transaction(finishResetSql('wrong-owner'));
equal(state().phase, 'cleared', 'wrong owner cannot unlock');
transaction(finishResetSql('resume'));
db.prepare(userSql).run('formal-admin', 'tabitoadimin01@tabitoedu.com');
transaction(clearBusinessSql('first', '2026-09-08'));
equal(db.prepare('SELECT id FROM payroll_users').get().id, 'formal-admin', 'late retry preserves new administrator');
equal(state().phase, 'complete', 'one-time completion persists');
equal(objectKeyPath('payroll/user/a b.pdf'), 'payroll/user/a%20b.pdf', 'R2 API deletion preserves literal key slashes');
assert.throws(() => objectKeyPath('payroll/../other/file')); checks++;
assert.throws(() => objectKeyPath('other/file')); checks++;
db.close();

function mock(phase = 'pending', overrides = {}) {
  const calls = [];
  let snapshot = { phase, owner: null };
  const ops = {
    owner: 'run', interactive: true, resume: false,
    preflight: async () => calls.push('preflight'),
    checkBootstrap: async () => calls.push('secret-check'),
    state: async () => ({ ...snapshot }),
    confirm: async () => { calls.push('confirm'); return 'y'; },
    build: async () => calls.push('build'),
    migrate: async () => calls.push('migrate'),
    acquire: async () => { calls.push('acquire'); snapshot = { phase: snapshot.phase === 'cleared' ? 'cleared' : 'purging', owner: 'run' }; },
    freeze: async () => calls.push('freeze'),
    maintenance: async () => calls.push('maintenance'),
    purgeFiles: async () => calls.push('files'),
    clear: async () => { calls.push('clear'); snapshot.phase = 'cleared'; },
    verifyEmpty: async () => calls.push('verify'),
    publish: async () => calls.push('publish'),
    finish: async () => { calls.push('finish'); snapshot.phase = 'complete'; },
    ...overrides,
  };
  return { ops, calls };
}
for (const answer of ['n', '', 'yes', 'no']) {
  const test = mock('pending', { confirm: async () => answer });
  await assert.rejects(() => runServerRelease(test.ops), /取消/); checks++;
  equal(test.calls, ['preflight', 'secret-check'], 'cancel before any writes');
}
const nonInteractive = mock('pending', { interactive: false });
await assert.rejects(() => runServerRelease(nonInteractive.ops), /交互/); checks++;
equal(nonInteractive.calls, ['preflight', 'secret-check'], 'no unattended first reset');
const happy = mock();
equal(await runServerRelease(happy.ops), 'reset-complete', 'first release completes');
equal(happy.calls, ['preflight', 'secret-check', 'confirm', 'build', 'migrate', 'acquire', 'freeze', 'maintenance', 'files', 'clear', 'verify', 'publish', 'finish'], 'writes follow confirmation and freeze');
const subsequent = mock('complete');
equal(await runServerRelease(subsequent.ops), 'updated-without-reset', 'subsequent release keeps business data');
equal(subsequent.calls, ['preflight', 'build', 'migrate', 'publish'], 'subsequent release has no destructive steps');
const resume = mock('cleared', { resume: true });
await runServerRelease(resume.ops);
equal(resume.calls.includes('clear') || resume.calls.includes('files'), false, 'publish retry never clears a second time');
const brokenBuild = mock('pending', { build: async () => { throw new Error('build failed'); } });
await assert.rejects(() => runServerRelease(brokenBuild.ops), /build failed/); checks++;
equal(brokenBuild.calls, ['preflight', 'secret-check', 'confirm'], 'build failure leaves remote state unchanged');
const brokenPublish = mock('pending', { publish: async () => { throw new Error('publish failed'); } });
await assert.rejects(() => runServerRelease(brokenPublish.ops), /publish failed/); checks++;
equal(brokenPublish.calls.includes('finish'), false, 'publish failure cannot unlock business writes');
equal((await brokenPublish.ops.state()).phase, 'cleared', 'publish failure retains retry marker');
process.stdout.write(JSON.stringify({ result: 'PASS', checks, database: 'memory-only', remoteCalls: 0 }) + '\n');
