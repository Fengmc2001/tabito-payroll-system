import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, readdirSync} from 'node:fs';
import {assertBindingsMatch, assertNoInterruptedReset, assertPreservingMigrations, runPreservingRelease} from './deployment-preserve-plan.mjs';

let checks = 0;
const equal = (a, b, label) => {assert.deepEqual(a, b, label); checks++;};
const migrations = readdirSync(new URL('../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort().map(name => ({name, sql: readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8')}));
assertPreservingMigrations(migrations); checks++;
for (const name of ['0005_old_inertia.sql', '0006_dry_winter_soldier.sql']) {
  const audited = migrations.find(migration => migration.name === name);
  assert.throws(() => assertPreservingMigrations([{...audited, sql: audited.sql + '\nDELETE FROM payroll_users;'}]), /非增量/); checks++;
}
for (const sql of ['DELETE FROM payroll_users', 'DROP TABLE payroll_salary_records', 'UPDATE payroll_salary_records SET final_salary = 0', 'ALTER TABLE payroll_users DROP COLUMN profile_json']) {
  assert.throws(() => assertPreservingMigrations([{name: 'unsafe.sql', sql}]), /非增量/); checks++;
}
const config = {d1_databases: [{binding: 'DB', database_id: 'existing-db'}], r2_buckets: [{binding: 'FILES', bucket_name: 'existing-files'}]};
const bindings = [{name: 'DB', type: 'd1', id: 'existing-db'}, {name: 'FILES', type: 'r2_bucket', bucket_name: 'existing-files'}];
assertBindingsMatch(config, bindings); checks++;
for (const bad of [[], [{...bindings[0], id: 'new-empty-db'}, bindings[1]], [bindings[0], {...bindings[1], bucket_name: 'new-files'}], [bindings[0], {...bindings[1], jurisdiction: 'eu'}]]) {
  assert.throws(() => assertBindingsMatch(config, bad), /绑定/); checks++;
}
for (const key of ['production_reset_20260906_v1', 'production_reset_20260913_v1']) {
  for (const phase of ['purging', 'clearing', 'cleared', 'unexpected']) {
    assert.throws(() => assertNoInterruptedReset([{key, value: phase}]), /尚未完成/); checks++;
  }
  for (const phase of [undefined, 'pending', 'complete']) {assertNoInterruptedReset(phase ? [{key, value: phase}] : []); checks++;}
  assert.throws(() => assertNoInterruptedReset([{key, value: 'pending'}, {key: key + '_owner', value: 'old-process'}])); checks++;
}
const db = new DatabaseSync(':memory:');
for (const migration of migrations.slice(0, 7)) db.exec(migration.sql);
const stamp = '2026-09-01T00:00:00.000Z';
const oldJson = JSON.stringify({id: 'legacy-record', finalSalary: 5091, travelFee: 91, attachments: ['legacy-file'], memo: '历史金额不可重算'});
db.prepare('INSERT INTO payroll_users (id,email,password_digest,profile_json,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('legacy-user', 'preserve@example.invalid', 'TEST-ONLY', '{"firstNameCn":"原员工"}', 'admin', stamp, stamp);
db.prepare('INSERT INTO payroll_salary_records (id,user_id,status,work_date,final_salary,currency,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run('legacy-record', 'legacy-user', 3, '2026-09-01', 5091, 'JPY', oldJson, stamp, stamp);
db.prepare('INSERT INTO payroll_files (key,user_id,original_name,content_type,size,created_at) VALUES (?,?,?,?,?,?)').run('legacy-file', 'legacy-user', '工资凭证.pdf', 'application/pdf', 123, stamp);
db.prepare('INSERT INTO payroll_audit_logs (id,actor_user_id,action,target_type,target_id,detail_json,subject_user_id,created_at) VALUES (?,?,?,?,?,?,?,?)').run('legacy-audit', 'legacy-user', 'salary.approve', 'salary_record', 'legacy-record', '{}', 'legacy-user', stamp);
const tables = ['payroll_users', 'payroll_salary_records', 'payroll_files', 'payroll_audit_logs', 'payroll_sessions', 'payroll_settings'];
const snapshot = () => Object.fromEntries(tables.map(table => [table, db.prepare('SELECT * FROM ' + table).all()]));
const before = snapshot();
const calls = [];
await runPreservingRelease({
  async preflight() {calls.push('preflight'); assertNoInterruptedReset(db.prepare('SELECT key,value FROM payroll_settings').all());},
  async build() {calls.push('build');},
  async migrate() {calls.push('migrate'); for (const migration of migrations.slice(7)) db.exec(migration.sql);},
  async publish() {calls.push('publish');},
  async clear() {throw new Error('must never clear');}, async purgeFiles() {throw new Error('must never delete files');},
});
equal(calls, ['preflight', 'build', 'migrate', 'preflight', 'publish'], 'normal release only migrates and publishes, without any marker');
const after = snapshot();
for (const table of tables) {
  for (let index = 0; index < before[table].length; index++) {
    for (const [key, value] of Object.entries(before[table][index])) equal(after[table][index][key], value, `${table}.${key} retained`);
  }
  equal(after[table].length, before[table].length, `${table} row count retained`);
}
equal(db.prepare('SELECT data_json FROM payroll_salary_records').get().data_json, oldJson, 'salary JSON byte-for-byte unchanged');
equal(db.prepare('SELECT final_salary FROM payroll_salary_records').get().final_salary, 5091, 'historical salary amount unchanged');
for (const failing of ['preflight', 'build', 'migrate', 'publish']) {
  const visited = [];
  const ops = Object.fromEntries(['preflight', 'build', 'migrate', 'publish'].map(name => [name, async () => {visited.push(name); if (name === failing) throw Error('failure');}]));
  await assert.rejects(() => runPreservingRelease(ops)); checks++;
  if (failing !== 'publish') equal(visited.includes('publish'), false, 'failure blocks publication');
}
const script = readFileSync(new URL('./deploy-cloudflare.mjs', import.meta.url), 'utf8');
equal(/clearBusinessSql|purgeFiles|acquireResetSql|runServerRelease|method: 'DELETE'/.test(script), false, 'production entrypoint has no reset or attachment deletion path');
db.close();
console.log(JSON.stringify({result: 'PASS', checks, database: 'memory-only', remoteCalls: 0}));
