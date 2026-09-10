// Execute the entire plan in one D1 batch. Keep its guard alive until the
// terminal marker is written, so a second in-flight request is a no-op.
export function grayRetirementPlan(now: string, clearPlan: string, departments: ReadonlyArray<{ key: string; label: string }>) {
  const guard = `NOT EXISTS (SELECT 1 FROM payroll_settings WHERE key = 'gray_maintenance_retired' AND value = '1')
    AND EXISTS (SELECT 1 FROM payroll_settings WHERE key = 'gray_clear_plan_v1' AND value = ?)`;
  const tables = ['payroll_access_grants', 'payroll_record_history', 'payroll_seed_entities', 'payroll_recurring_instances', 'payroll_recurring_rules',
    'payroll_salary_batches', 'payroll_file_references', 'payroll_salary_records', 'payroll_files',
    'payroll_audit_logs', 'payroll_sessions', 'payroll_departments', 'payroll_users'];
  return [
    ...tables.map((table) => ({ sql: `DELETE FROM ${table} WHERE ${guard}`, params: [clearPlan] })),
    { sql: `DELETE FROM payroll_settings WHERE key NOT IN ('gray_clear_plan_v1', 'gray_maintenance_retired') AND ${guard}`, params: [clearPlan] },
    { sql: `INSERT INTO payroll_settings (key, value, updated_by, updated_at)
        SELECT 'registration_open', '1', NULL, ? WHERE ${guard}`, params: [now, clearPlan] },
    ...departments.map((department, index) => ({
      sql: `INSERT INTO payroll_departments (id, label, active, sort_order, created_at, updated_at, deleted_at)
        SELECT ?, ?, 1, ?, ?, ?, NULL WHERE ${guard}`,
      params: [department.key, department.label, index, now, now, clearPlan],
    })),
    { sql: `INSERT INTO payroll_settings (key, value, updated_by, updated_at)
        SELECT 'gray_maintenance_retired', '1', NULL, ? WHERE ${guard}
        ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = excluded.updated_at
        WHERE payroll_settings.value != '1'`, params: [now, clearPlan] },
  ];
}
