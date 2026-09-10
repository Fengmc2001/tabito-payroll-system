import { AccountAccess, AccountRole, AccessFeatures, defaultFeatures } from '../payroll';
import { ApiError, type SessionActor } from './payroll-store';

export const sqlText = (value: string) => "'" + value.replaceAll("'", "''") + "'";
export function fullAccessSql(actor: SessionActor, owner: string) {
  const id = sqlText(actor.userId);
  return `(EXISTS (SELECT 1 FROM payroll_users access_actor WHERE access_actor.id = ${id} AND access_actor.status = 'active' AND (
    access_actor.role = 'admin' OR ${owner} = access_actor.id OR EXISTS (
      SELECT 1 FROM payroll_access_grants grant_row WHERE grant_row.viewer_user_id = access_actor.id AND grant_row.subject_user_id = ${owner}
    ))))`;
}
export function reviewAccessSql(actor: SessionActor, alias = 'r') {
  return `EXISTS (SELECT 1 FROM payroll_users review_actor WHERE review_actor.id = ${sqlText(actor.userId)}
    AND review_actor.status = 'active' AND (review_actor.role = 'admin' OR
      (review_actor.role = 'reviewer' AND ${alias}.reviewer_user_id = review_actor.id)))`;
}
export function recordAccessSql(actor: SessionActor, alias = 'r') {
  return `(${alias}.user_id = ${sqlText(actor.userId)} OR
    EXISTS (SELECT 1 FROM payroll_users admin_actor WHERE admin_actor.id = ${sqlText(actor.userId)} AND admin_actor.status = 'active' AND admin_actor.role = 'admin')
    OR (${alias}.status != 1 AND (${fullAccessSql(actor, alias + '.user_id')} OR ${reviewAccessSql(actor, alias)})))`;
}
export async function accountAccess(db: D1Database, userId: string, role: AccountRole): Promise<AccountAccess> {
  const [user, grants] = await Promise.all([
    db.prepare('SELECT features_json, reviewer_user_id FROM payroll_users WHERE id = ?').bind(userId)
      .first<{ features_json: string; reviewer_user_id: string | null }>(),
    db.prepare('SELECT subject_user_id FROM payroll_access_grants WHERE viewer_user_id = ? ORDER BY subject_user_id')
      .bind(userId).all<{ subject_user_id: string }>(),
  ]);
  return { features: featuresFromStored(role, user?.features_json), subjectUserIds: grants.results.map((g) => g.subject_user_id), reviewerUserId: user?.reviewer_user_id ?? null };
}
export function featuresFromStored(role: AccountRole, raw?: string) {
  let stored: Partial<AccessFeatures> = {};
  try { stored = JSON.parse(raw || '{}'); } catch { /* Invalid stored permissions fail closed. */ }
  const defaults = defaultFeatures(role);
  const features = Object.fromEntries(Object.keys(defaults).map((key) => [key, role === 'admin' || (
    typeof stored?.[key as keyof AccessFeatures] === 'boolean' ? stored[key as keyof AccessFeatures] : defaults[key as keyof AccessFeatures]
  )])) as AccessFeatures;
  return features;
}
export async function requireFeature(db: D1Database, actor: SessionActor, key: keyof AccessFeatures) {
  if (!(await accountAccess(db, actor.userId, actor.role)).features[key]) throw new ApiError(403, '没有访问此功能的权限。');
}
export function fileAccessSql(actor: SessionActor, file = 'f') {
  const id = sqlText(actor.userId);
  return `(${file}.user_id = ${id} OR EXISTS (SELECT 1 FROM payroll_users a WHERE a.id = ${id} AND a.status = 'active' AND a.role = 'admin')
    OR (${fullAccessSql(actor, file + '.user_id')} AND EXISTS (SELECT 1 FROM payroll_file_references ref
      WHERE ref.file_key = ${file}.key AND ref.reference_type IN ('profile_id','profile_bank')))
    OR EXISTS (SELECT 1 FROM payroll_salary_records r WHERE r.user_id = ${file}.user_id AND r.status != 1
      AND ${recordAccessSql(actor)} AND (EXISTS (SELECT 1 FROM json_each(r.data_json, '$.attachments') WHERE value = ${file}.key)
        OR EXISTS (SELECT 1 FROM payroll_record_history h, json_each(h.data_json, '$.attachments') attachment
          WHERE h.record_id = r.id AND h.status != 1 AND attachment.value = ${file}.key))))`;
}
export async function requireFullAccess(db: D1Database, actor: SessionActor, userId: string) {
  if (!await db.prepare(`SELECT id FROM payroll_users u WHERE id = ? AND ${fullAccessSql(actor, 'u.id')}`).bind(userId).first()) {
    throw new ApiError(403, '没有查看该员工完整资料的权限。');
  }
}
export function requirePayrollTarget(actor: SessionActor, userId: string) {
  if (actor.role !== 'admin' && actor.userId !== userId) throw new ApiError(403, '只有管理员可以为他人申报。');
}
export function recordLifecycleStatements(db: D1Database, ids: string[], auditId: string, assign = false) {
  const filter = "id IN (SELECT value FROM json_each(?)) AND EXISTS (SELECT 1 FROM payroll_audit_logs WHERE id = ?)";
  const statements: D1PreparedStatement[] = [];
  if (assign) statements.push(db.prepare(`UPDATE payroll_salary_records SET reviewer_user_id = (
      SELECT reviewer.id FROM payroll_users manager JOIN payroll_users reviewer ON reviewer.id = manager.reviewer_user_id
      WHERE manager.id = json_extract(payroll_salary_records.data_json, '$.checkUserId')
        AND manager.work_manager = 1 AND manager.status = 'active' AND reviewer.status = 'active'
        AND reviewer.role IN ('reviewer','admin')
    ) WHERE status = 2 AND ${filter}`).bind(JSON.stringify(ids), auditId));
  statements.push(db.prepare(`INSERT INTO payroll_record_history
    (record_id, actor_user_id, action, status, reviewer_user_id, data_json, created_at)
    SELECT r.id, a.actor_user_id, a.action, r.status, r.reviewer_user_id, r.data_json, a.created_at
      FROM payroll_salary_records r JOIN payroll_audit_logs a ON a.id = ?
      WHERE r.id IN (SELECT value FROM json_each(?))`).bind(auditId, JSON.stringify(ids)));
  return statements;
}
