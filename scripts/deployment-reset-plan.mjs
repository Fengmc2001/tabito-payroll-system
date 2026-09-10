import { DEFAULT_DEPARTMENTS } from '../app/lib/payroll.ts';

export const RESET_KEY = 'production_reset_20260906_v1';
export const LOCK_KEY = RESET_KEY + '_owner';
export const RESET_TABLES = [
  'payroll_access_grants', 'payroll_record_history',
  'payroll_seed_entities', 'payroll_recurring_instances', 'payroll_recurring_rules',
  'payroll_salary_batches', 'payroll_file_references', 'payroll_salary_records',
  'payroll_files', 'payroll_audit_logs', 'payroll_sessions', 'payroll_departments', 'payroll_users',
];
export const objectKeyPath = (key) => {
  if (!key.startsWith('payroll/') || key.split('/').some((part) => part === '.' || part === '..')) throw new Error('附件路径超出工资系统范围。');
  return key.split('/').map(encodeURIComponent).join('/');
};
export const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const phase = `(SELECT value FROM payroll_settings WHERE key = '${RESET_KEY}')`;
const owned = (owner) => `EXISTS (SELECT 1 FROM payroll_settings WHERE key = '${LOCK_KEY}' AND value = ${quote(owner)})`;

export function acquireResetSql(owner, previousOwner) {
  const now = quote(new Date().toISOString());
  return [
    `INSERT OR IGNORE INTO payroll_settings (key,value,updated_at) VALUES ('${RESET_KEY}','pending',${now})`,
    previousOwner
      ? `UPDATE payroll_settings SET value = ${quote(owner)}, updated_at = ${now}
          WHERE key = '${LOCK_KEY}' AND value = ${quote(previousOwner)} AND ${phase} != 'complete'`
      : `INSERT OR IGNORE INTO payroll_settings (key,value,updated_at)
          SELECT '${LOCK_KEY}', ${quote(owner)}, ${now} WHERE ${phase} != 'complete'`,
    `UPDATE payroll_settings SET value = 'purging' WHERE key = '${RESET_KEY}'
      AND value IN ('pending','purging') AND ${owned(owner)}`,
  ].join(';');
}

export function freezeWritesSql() {
  return RESET_TABLES.flatMap((table) => ['INSERT', 'UPDATE', 'DELETE'].map((action) =>
    `CREATE TRIGGER IF NOT EXISTS reset_20260906_${table}_${action.toLowerCase()}
      BEFORE ${action} ON ${table}
      WHEN ${phase} IN ('purging','cleared')
      BEGIN SELECT RAISE(ABORT, 'Payroll maintenance in progress'); END`,
  )).join(';');
}

export function clearBusinessSql(owner, timestamp) {
  const guard = `${owned(owner)} AND ${phase} = 'clearing'`;
  const now = quote(timestamp);
  return [
    `UPDATE payroll_settings SET value = 'clearing' WHERE key = '${RESET_KEY}' AND value = 'purging' AND ${owned(owner)}`,
    ...RESET_TABLES.map((table) => `DELETE FROM ${table} WHERE ${guard}`),
    `DELETE FROM payroll_settings WHERE key NOT IN ('${RESET_KEY}','${LOCK_KEY}') AND ${guard}`,
    `INSERT INTO payroll_settings (key,value,updated_at) SELECT 'registration_open','1',${now} WHERE ${guard}`,
    `INSERT INTO payroll_settings (key,value,updated_at) SELECT 'gray_maintenance_retired','1',${now} WHERE ${guard}`,
    ...DEFAULT_DEPARTMENTS.map((department, index) =>
      `INSERT INTO payroll_departments (id,label,active,sort_order,created_at,updated_at)
        SELECT ${quote(department.key)},${quote(department.label)},1,${index},${now},${now} WHERE ${guard}`),
    `UPDATE payroll_settings SET value = 'cleared', updated_at = ${now}
      WHERE key = '${RESET_KEY}' AND ${guard}`,
  ].join(';');
}

export function finishResetSql(owner) {
  return `UPDATE payroll_settings SET value = 'complete'
    WHERE key = '${RESET_KEY}' AND value = 'cleared' AND ${owned(owner)};
    DELETE FROM payroll_settings WHERE key = '${LOCK_KEY}' AND value = ${quote(owner)} AND ${phase} = 'complete'`;
}

export async function runServerRelease(ops) {
  await ops.preflight();
  let state = await ops.state();
  if (state.phase === 'complete') {
    await ops.build();
    await ops.migrate();
    await ops.publish();
    return 'updated-without-reset';
  }
  await ops.checkBootstrap();
  if (!ops.interactive) throw new Error('首次重置必须在交互终端确认；未更改服务器。');
  if (state.owner && !ops.resume) throw new Error('检测到未完成的发布。先确认其他部署进程已停止，再使用 --resume。');
  if ((await ops.confirm()).trim().toLowerCase() !== 'y') throw new Error('已取消，未更改服务器。');
  await ops.build();
  await ops.migrate();
  await ops.acquire(state.owner);
  state = await ops.state();
  if (state.owner !== ops.owner || !['purging', 'cleared'].includes(state.phase)) throw new Error('另一项部署已取得锁，本次已中止。');
  await ops.freeze();
  await ops.maintenance();
  if (state.phase !== 'cleared') {
    await ops.purgeFiles();
    await ops.clear();
  }
  // A retry after data has been cleared only republishes; it never clears again.
  await ops.verifyEmpty();
  await ops.publish();
  await ops.finish();
  return 'reset-complete';
}
