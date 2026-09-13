import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';

// Load the production SQL builders; unrelated module dependencies are not used.
const exports = {};
const source=readFileSync(new URL('../app/lib/server/access-control.ts',import.meta.url),'utf8');
runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{
  exports, require:()=>({}),
});
const {reviewAccessSql}=exports;
const db=new DatabaseSync(':memory:');
db.exec(`CREATE TABLE payroll_users(id TEXT, role TEXT, status TEXT);
CREATE TABLE payroll_access_grants(viewer_user_id TEXT, subject_user_id TEXT);
CREATE TABLE payroll_salary_records(id TEXT, user_id TEXT, reviewer_user_id TEXT, status INTEGER, updated_at TEXT);
INSERT INTO payroll_users VALUES ('admin','admin','active'),('assigned','reviewer','active'),('other','reviewer','active'),('grantee','employee','active'),('owner','employee','active');
INSERT INTO payroll_salary_records VALUES ('assigned-line','owner','assigned',2,'v1'),('unassigned-line','owner',NULL,2,'v1'),('unrelated-line','other','other',2,'v1');`);
let checks=0;
const equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
const can=(actor,id)=>Boolean(db.prepare(`SELECT id FROM payroll_salary_records r WHERE id=? AND ${reviewAccessSql({userId:actor,role:'admin'})}`).get(id));
// Deliberately stale actor.role must never override the role in the database.
equal(can('grantee','assigned-line'),false,'forged/stale admin role is ignored');
equal(can('owner','assigned-line'),false,'own profile visibility does not imply self approval');
equal(can('assigned','assigned-line'),true,'designated reviewer allowed');
equal(can('assigned','unassigned-line'),false,'unassigned wages are not public');
db.exec("INSERT INTO payroll_access_grants VALUES ('grantee','owner')");
equal(can('grantee','assigned-line'),true,'employee grant covers another designated reviewer');
equal(can('grantee','unassigned-line'),true,'employee grant covers unassigned wages');
equal(can('grantee','unrelated-line'),false,'grant stays employee-scoped');
const update=db.prepare(`UPDATE payroll_salary_records SET status=3, updated_at='v2' WHERE id=? AND status=2 AND updated_at='v1' AND ${reviewAccessSql({userId:'grantee',role:'employee'},'payroll_salary_records')}`);
equal(can('grantee','assigned-line'),true,'authorization initially passes');
db.exec("DELETE FROM payroll_access_grants WHERE viewer_user_id='grantee'");
equal(update.run('assigned-line').changes,0,'grant revoked after read is denied at write');
db.exec("INSERT INTO payroll_access_grants VALUES ('grantee','owner'); UPDATE payroll_users SET status='disabled' WHERE id='grantee'");
equal(update.run('assigned-line').changes,0,'account disabled after read is denied at write');
db.exec("UPDATE payroll_users SET status='active' WHERE id='grantee'");
equal(update.run('assigned-line').changes,1,'active employee grant can commit');
equal(update.run('assigned-line').changes,0,'second decision cannot overwrite completed review');
db.exec("UPDATE payroll_users SET role='employee' WHERE id='assigned'");
equal(can('assigned','assigned-line'),false,'demoted reviewer loses assignment-only authority');
db.exec("INSERT INTO payroll_access_grants VALUES ('assigned','owner')");
equal(can('assigned','assigned-line'),true,'explicit employee grant remains independent of role');
db.exec("UPDATE payroll_users SET status='disabled' WHERE id='admin'");
equal(can('admin','assigned-line'),false,'disabled administrator cannot approve');
db.close();
console.log(JSON.stringify({result:'PASS',checks,database:'memory-only',remoteCalls:0}));
