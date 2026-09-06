export function accountAuditQuery(userId: string, month?: string) {
  // Payroll operates in Japan; event display and fallback month use the same zone.
  const effectiveMonth = "COALESCE(l.business_month, strftime('%Y-%m', l.created_at, '+9 hours'))";
  return {
    sql: `SELECT l.id, l.actor_user_id, u.email AS actor_email, u.profile_json AS actor_profile_json,
      l.action, l.target_type, l.target_id, l.detail_json, ${effectiveMonth} AS business_month, l.created_at
      FROM payroll_audit_logs l LEFT JOIN payroll_users u ON u.id = l.actor_user_id
      WHERE (
        l.subject_user_id = ? OR l.actor_user_id = ?
        OR (l.target_type = 'user' AND l.target_id = ?)
        OR (l.target_type = 'salary_record' AND EXISTS (
          SELECT 1 FROM payroll_salary_records r WHERE r.id = l.target_id AND r.user_id = ?))
        OR (l.target_type = 'file' AND EXISTS (
          SELECT 1 FROM payroll_files f WHERE f.key = l.target_id AND f.user_id = ?))
        OR (json_valid(l.detail_json) AND (
          json_extract(l.detail_json, '$.subjectUserId') = ?
          OR json_extract(l.detail_json, '$.ownerUserId') = ?))
      ) ${month ? `AND ${effectiveMonth} = ?` : ''}
      ORDER BY l.created_at DESC`,
    params: [userId, userId, userId, userId, userId, userId, userId, ...(month ? [month] : [])],
  };
}
