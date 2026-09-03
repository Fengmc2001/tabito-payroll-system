import { env } from 'cloudflare:workers';
import {
  AccountRole,
  AccountStatus,
  AuditLogItem,
  AuditOverview,
  BOOTSTRAP_ADMIN_EMAIL,
  CurrencyAmounts,
  CurrencyCode,
  DepartmentOption,
  EmployeeDetail,
  EmployeeSummary,
  FixedPayrollSchedule,
  ManagedUser,
  ManagedUserUpdateInput,
  MonthlyPayrollSummary,
  PROFILE_TEXT_MAX_LENGTH,
  PayrollScheduleSession,
  Profile,
  ProxyPayrollBatchInput,
  RecurringPayrollRule,
  ReviewSalaryItem,
  SALARY_TEXT_MAX_LENGTH,
  SalaryRecord,
  SalaryStatus,
  StoredAccount,
  StoredFileInfo,
  TransferSheetRow,
  WorkManagerOption,
  birthdayIsValid,
  createEmptyProfile,
  currentMonth,
  dateIsValid,
  emptyCurrencyAmounts,
  expandFixedPayrollSchedule,
  getDepartmentLabel,
  getWorkMinutes,
  monthDateRange,
  monthIsValid,
  mutationRequestIsSameOrigin,
  profileBasicsAreReady,
  profileMissingRequirements,
  recalculateRecord,
} from '../payroll';

type UserRow = {
  id: string;
  email: string;
  password_digest: string;
  profile_json: string;
  role: string;
  status: string;
  last_login_at: string | null;
  failed_login_count: number;
  locked_until: number | null;
  work_manager: number;
  created_at: string;
  updated_at: string;
};

type RecordRow = {
  id: string;
  user_id: string;
  status: number;
  currency?: string;
  data_json: string;
};

type ReviewRow = RecordRow & {
  email: string;
  profile_json: string;
};

type SessionRow = {
  token: string;
  user_id: string;
  expires_at: number;
  email: string;
  role: string;
  status: string;
  profile_json: string;
};

type FileRow = {
  key: string;
  user_id: string;
  original_name: string;
  content_type: string;
  size: number;
  created_at: string;
};

type AuditRow = {
  id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  actor_profile_json: string | null;
  action: string;
  target_type: string;
  target_id: string;
  detail_json: string;
  subject_user_id?: string | null;
  business_month?: string | null;
  created_at: string;
};

type DepartmentRow = {
  id: string;
  label: string;
  active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type StaffFileRow = FileRow & { reference_types: string | null };

type RecurringRuleRow = {
  id: string;
  user_id: string;
  user_email: string;
  user_profile_json: string;
  user_status?: string;
  instance_rule_id?: string | null;
  title: string;
  active: number;
  submit_on_generate: number;
  start_month: string;
  end_month: string;
  template_json: string;
  schedule_json: string;
  created_by_user_id: string;
  creator_email: string | null;
  creator_profile_json: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_message: string;
  created_at: string;
  updated_at: string;
};

export type SessionActor = {
  token: string;
  userId: string;
  email: string;
  role: AccountRole;
  status: AccountStatus;
  expiresAt: number;
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const SESSION_COOKIE = 'xly_payroll_session';
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 120_000;
const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const MAX_BATCH_RECORDS = 62;
const MAX_RECURRING_RULES_PER_RUN = 4;
const MAX_FILES_PER_USER = 200;
const MAX_FILE_BYTES_PER_USER = 250 * 1024 * 1024;

let schemaPromise: Promise<void> | null = null;

async function database() {
  if (!env.DB) throw new ApiError(503, '数据库绑定不可用。');
  if (!schemaPromise) {
    schemaPromise = initializeSchema(env.DB).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
  return env.DB;
}

async function initializeSchema(db: D1Database) {
  try {
    await db.prepare(`SELECT
      u.work_manager,
      u.failed_login_count,
      session.expires_at,
      s.currency,
      stored_file.content_type,
      setting.updated_at,
      a.subject_user_id,
      a.business_month,
      b.payload_hash,
      r.submit_on_generate,
      instance.record_ids_json,
      f.reference_type,
      d.deleted_at,
      seed.seed_tag
    FROM payroll_users AS u
    LEFT JOIN payroll_sessions AS session ON 1 = 0
    LEFT JOIN payroll_salary_records AS s ON 1 = 0
    LEFT JOIN payroll_files AS stored_file ON 1 = 0
    LEFT JOIN payroll_settings AS setting ON 1 = 0
    LEFT JOIN payroll_audit_logs AS a ON 1 = 0
    LEFT JOIN payroll_salary_batches AS b ON 1 = 0
    LEFT JOIN payroll_recurring_rules AS r ON 1 = 0
    LEFT JOIN payroll_recurring_instances AS instance ON 1 = 0
    LEFT JOIN payroll_file_references AS f ON 1 = 0
    LEFT JOIN payroll_departments AS d ON 1 = 0
    LEFT JOIN payroll_seed_entities AS seed ON 1 = 0
    LIMIT 0`).all();
  } catch (error) {
    const message = String(error).toLowerCase();
    if (message.includes('no such table') || message.includes('no such column')) {
      throw new ApiError(503, '数据库尚未完成迁移，请先执行部署文档中的数据库迁移。');
    }
    throw error;
  }
}

export async function registerUser(email: string, passwordDigest: string, bootstrapSecret = '') {
  validateCredentialDigest(passwordDigest);
  const db = await database();
  const [count, retiredAtStart] = await db.batch([
    db.prepare('SELECT COUNT(*) AS count FROM payroll_users'),
    db.prepare("SELECT value FROM payroll_settings WHERE key = 'gray_maintenance_retired'"),
  ]);
  const countRow = count.results?.[0] as { count?: unknown } | undefined;
  const firstAccount = Number(countRow?.count ?? 0) === 0;
  const grayGeneration = String((retiredAtStart.results?.[0] as { value?: unknown } | undefined)?.value ?? '') === '1'
    ? '1'
    : '0';
  if (firstAccount) {
    const expectedSecret = String(env.BOOTSTRAP_SECRET ?? '');
    if (expectedSecret.length < 16) throw new ApiError(503, '服务器尚未配置首次设置密钥。');
    if (!safeEqual(String(bootstrapSecret), expectedSecret)) throw new ApiError(403, '首次设置密钥不正确。');
  }
  const normalized = firstAccount ? normalizeEmail(BOOTSTRAP_ADMIN_EMAIL) : validateEmail(email);
  const existing = await getUserByEmail(normalized);
  if (existing) throw new ApiError(409, '该邮箱已经注册。');

  if (!firstAccount && !(await registrationIsOpen(db))) {
    throw new ApiError(403, '管理员已关闭新账号注册。');
  }

  const id = newId('user');
  const now = new Date().toISOString();
  const profile = createEmptyProfile();
  const passwordHash = await hashCredential(passwordDigest);
  try {
    const insertion = await db.prepare(`INSERT INTO payroll_users (
      id, email, password_digest, profile_json, role, status, last_login_at,
      failed_login_count, locked_until, work_manager, created_at, updated_at
    ) SELECT ?, ?, ?, ?,
      CASE WHEN EXISTS (SELECT 1 FROM payroll_users LIMIT 1) THEN 'employee' ELSE 'admin' END,
      'active', ?, 0, NULL,
      CASE WHEN EXISTS (SELECT 1 FROM payroll_users LIMIT 1) THEN 0 ELSE 1 END,
      ?, ?
      WHERE COALESCE((SELECT value FROM payroll_settings WHERE key = 'gray_maintenance_retired'), '0') = ?
        AND (
          (NOT EXISTS (SELECT 1 FROM payroll_users) AND ? = 1 AND ? = ?)
          OR (EXISTS (SELECT 1 FROM payroll_users) AND ? = 0
            AND COALESCE((SELECT value FROM payroll_settings WHERE key = 'registration_open'), '1') <> '0')
        )
        AND (
          NOT EXISTS (SELECT 1 FROM payroll_settings WHERE key = 'gray_clear_plan_v1')
          OR ? = '1'
        )`)
      .bind(id, normalized, passwordHash, JSON.stringify(profile), now, now, now,
        grayGeneration, firstAccount ? 1 : 0, normalized, normalizeEmail(BOOTSTRAP_ADMIN_EMAIL),
        firstAccount ? 1 : 0, grayGeneration)
      .run();
    if (!insertion.meta.changes) throw new ApiError(409, '账号初始化状态已发生变化，请刷新后重试。');
  } catch (error) {
    if (String(error).toLowerCase().includes('unique')) throw new ApiError(409, '该邮箱已经注册。');
    throw error;
  }
  const user = await getUserById(id);
  if (!user) throw new ApiError(500, '账号创建失败。');
  await writeAudit(db, id, 'account.register', 'user', id, { role: user.role });
  const session = await issueSession(id);
  return { account: await getAccount(id), session };
}

export async function getBootstrapStatus() {
  const db = await database();
  const count = await db.prepare('SELECT COUNT(*) AS count FROM payroll_users').first<{ count: number }>();
  return {
    bootstrapRequired: Number(count?.count ?? 0) === 0,
    email: BOOTSTRAP_ADMIN_EMAIL,
  };
}

export async function loginUser(email: string, passwordDigest: string) {
  const normalized = normalizeEmail(email);
  validateCredentialDigest(passwordDigest, true);
  const db = await database();
  const user = await getUserByEmail(normalized);

  if (!user) throw new ApiError(401, '邮箱或密码错误。');
  if (toStatus(user.status) === 'disabled') throw new ApiError(403, '账号已停用，请联系管理员。');
  if (user.locked_until && user.locked_until > Date.now()) {
    throw new ApiError(429, `登录失败次数过多，请在 ${Math.ceil((user.locked_until - Date.now()) / 60_000)} 分钟后重试。`);
  }

  const valid = await verifyCredential(passwordDigest, user.password_digest);
  if (!valid) {
    const attemptAt = Date.now();
    const updatedAt = nextVersionTimestamp(user.updated_at);
    const auditId = newId('audit');
    const detail = { subjectUserId: user.id };
    const { subjectUserId, businessMonth } = auditDimensions('user', user.id, detail);
    await db.batch([
      db.prepare(`UPDATE payroll_users SET
        failed_login_count = CASE WHEN failed_login_count + 1 >= ? THEN 0 ELSE failed_login_count + 1 END,
        locked_until = CASE WHEN failed_login_count + 1 >= ? THEN ? ELSE NULL END,
        updated_at = ?
        WHERE id = ? AND password_digest = ? AND status = 'active'
          AND (locked_until IS NULL OR locked_until <= ?)`)
        .bind(LOGIN_FAILURE_LIMIT, LOGIN_FAILURE_LIMIT, attemptAt + LOGIN_LOCK_MS, updatedAt,
          user.id, user.password_digest, attemptAt),
      db.prepare(`INSERT INTO payroll_audit_logs
        (id, actor_user_id, action, target_type, target_id, detail_json, subject_user_id, business_month, created_at)
        SELECT ?, NULL, 'auth.login_failed', 'user', ?, ?, ?, ?, ? WHERE changes() = 1`)
        .bind(auditId, user.id, JSON.stringify(detail), subjectUserId, businessMonth, updatedAt),
    ]);
    throw new ApiError(401, '邮箱或密码错误。');
  }

  const upgradedHash = user.password_digest.startsWith('pbkdf2$')
    ? user.password_digest
    : await hashCredential(passwordDigest);
  const now = new Date().toISOString();
  const updatedAt = nextVersionTimestamp(user.updated_at);
  const token = newId('session');
  const tokenHash = await sessionTokenHash(token);
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  const auditId = newId('audit');
  const [login] = await db.batch([
    db.prepare(`UPDATE payroll_users
      SET password_digest = ?, failed_login_count = 0, locked_until = NULL, last_login_at = ?, updated_at = ?
      WHERE id = ? AND password_digest = ? AND status = 'active'
        AND (locked_until IS NULL OR locked_until <= ?)`)
      .bind(upgradedHash, now, updatedAt, user.id, user.password_digest, Date.now()),
    db.prepare(`INSERT INTO payroll_audit_logs
      (id, actor_user_id, action, target_type, target_id, detail_json, subject_user_id, business_month, created_at)
      SELECT ?, ?, 'auth.login', 'user', ?, '{}', ?, NULL, ? WHERE changes() = 1`)
      .bind(auditId, user.id, user.id, user.id, now),
    db.prepare(`INSERT INTO payroll_sessions (token, user_id, expires_at, created_at)
      SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM payroll_audit_logs WHERE id = ?)`)
      .bind(tokenHash, user.id, expiresAt, now, auditId),
    db.prepare('DELETE FROM payroll_sessions WHERE expires_at <= ?').bind(Date.now()),
  ]);
  if (!login.meta.changes) throw new ApiError(401, '邮箱或密码错误。');
  const session = { token, expiresAt };
  return { account: await getAccount(user.id), session };
}

export async function logoutSession(request: Request) {
  requireSameOriginMutation(request);
  const token = readSessionToken(request);
  if (!token) return;
  const db = await database();
  const tokenHash = await sessionTokenHash(token);
  const session = await db.prepare('SELECT user_id FROM payroll_sessions WHERE token = ?')
    .bind(tokenHash)
    .first<{ user_id: string }>();
  await db.prepare('DELETE FROM payroll_sessions WHERE token = ?').bind(tokenHash).run();
  if (session) await writeAudit(db, session.user_id, 'auth.logout', 'session', tokenHash.slice(0, 24));
}

export async function requireSession(
  request: Request,
  expectedUserId?: string,
  allowIncompleteProfile = false,
): Promise<SessionActor> {
  requireSameOriginMutation(request);
  const token = readSessionToken(request);
  if (!token) throw new ApiError(401, '缺少登录凭据。');
  const db = await database();
  const tokenHash = await sessionTokenHash(token);
  const session = await db.prepare(`SELECT s.token, s.user_id, s.expires_at, u.email, u.role, u.status, u.profile_json
    FROM payroll_sessions s
    JOIN payroll_users u ON u.id = s.user_id
    WHERE s.token = ?`)
    .bind(tokenHash)
    .first<SessionRow>();
  if (!session || session.expires_at <= Date.now()) {
    if (session) await db.prepare('DELETE FROM payroll_sessions WHERE token = ?').bind(tokenHash).run();
    throw new ApiError(401, '登录已过期。');
  }
  if (toStatus(session.status) === 'disabled') {
    await db.prepare('DELETE FROM payroll_sessions WHERE user_id = ?').bind(session.user_id).run();
    throw new ApiError(403, '账号已停用，请联系管理员。');
  }
  if (expectedUserId && session.user_id !== expectedUserId) {
    throw new ApiError(403, '没有操作该用户数据的权限。');
  }
  if (!allowIncompleteProfile && !profileBasicsAreReady(parseProfile(session.profile_json))) {
    throw new ApiError(428, '请先提交姓名、现住址和联系方式。');
  }
  return {
    token,
    userId: session.user_id,
    email: session.email,
    role: toRole(session.role),
    status: toStatus(session.status),
    expiresAt: session.expires_at,
  };
}

export async function getAccount(userId: string) {
  const user = await getUserById(userId);
  if (!user) throw new ApiError(404, '未找到用户。');
  const account = toAccount(user);
  account.salaryRecords = await listSalaryRecords(userId);
  return account;
}

export async function saveProfile(userId: string, input: Profile) {
  const db = await database();
  const profile = sanitizeProfile(input);
  const basicError = profileBasicsError(profile);
  if (basicError) throw new ApiError(400, basicError);
  await assertOwnedFiles(db, userId, [...profile.idFileNames, ...profile.bankFileNames]);
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    db.prepare("UPDATE payroll_users SET profile_json = ?, updated_at = ? WHERE id = ? AND status = 'active'")
      .bind(JSON.stringify(profile), now, userId),
    db.prepare("DELETE FROM payroll_file_references WHERE reference_type = 'profile_id' AND reference_id = ?")
      .bind(userId),
    ...profile.idFileNames.map((key) => validatedFileReferenceInsertStatement(
      db, userId, 'profile_id', userId, key, now,
    )),
    db.prepare("DELETE FROM payroll_file_references WHERE reference_type = 'profile_bank' AND reference_id = ?")
      .bind(userId),
    ...profile.bankFileNames.map((key) => validatedFileReferenceInsertStatement(
      db, userId, 'profile_bank', userId, key, now,
    )),
    auditStatement(db, userId, 'profile.update', 'user', userId, {}, now),
  ];
  const [result] = await db.batch(statements);
  if (!result.meta.changes) throw new ApiError(404, '未找到用户。');
  return getAccount(userId);
}

export async function resetPassword(
  actor: SessionActor,
  oldPasswordDigest: string,
  newPasswordDigest: string,
) {
  validateCredentialDigest(oldPasswordDigest, true);
  validateCredentialDigest(newPasswordDigest);
  if (oldPasswordDigest === newPasswordDigest) throw new ApiError(400, '新密码不能与旧密码相同。');
  const user = await getUserById(actor.userId);
  if (!user || !(await verifyCredential(oldPasswordDigest, user.password_digest))) {
    throw new ApiError(400, '旧密码不正确。');
  }
  const db = await database();
  const now = nextVersionTimestamp(user.updated_at);
  const auditId = newId('audit');
  const detail = { sessionsRevoked: true };
  const token = newId('session');
  const tokenHash = await sessionTokenHash(token);
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  const [passwordChange] = await db.batch([
    db.prepare(`UPDATE payroll_users
      SET password_digest = ?, failed_login_count = 0, locked_until = NULL, updated_at = ?
      WHERE id = ? AND password_digest = ? AND status = 'active'`)
      .bind(await hashCredential(newPasswordDigest), now, actor.userId, user.password_digest),
    db.prepare(`INSERT INTO payroll_audit_logs
      (id, actor_user_id, action, target_type, target_id, detail_json, subject_user_id, business_month, created_at)
      SELECT ?, ?, 'account.password_change', 'user', ?, ?, ?, NULL, ? WHERE changes() = 1`)
      .bind(auditId, actor.userId, actor.userId, JSON.stringify(detail), actor.userId, now),
    db.prepare(`DELETE FROM payroll_sessions
      WHERE user_id = ? AND EXISTS (SELECT 1 FROM payroll_audit_logs WHERE id = ?)`)
      .bind(actor.userId, auditId),
    db.prepare(`INSERT INTO payroll_sessions (token, user_id, expires_at, created_at)
      SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM payroll_audit_logs WHERE id = ?)`)
      .bind(tokenHash, actor.userId, expiresAt, now, auditId),
  ]);
  if (!passwordChange.meta.changes) {
    throw new ApiError(409, '密码或账号状态已发生变化，请重新登录。');
  }
  return { token, expiresAt };
}

export async function listSalaryRecords(userId: string) {
  const db = await database();
  const result = await db.prepare(`SELECT id, user_id, status, currency, data_json
    FROM payroll_salary_records
    WHERE user_id = ?
    ORDER BY work_date DESC, created_at DESC`)
    .bind(userId)
    .all<RecordRow>();
  return result.results.map(recordFromRow);
}

export async function getSalaryRecord(userId: string, id: string) {
  const db = await database();
  const row = await db.prepare(`SELECT id, user_id, status, currency, data_json
    FROM payroll_salary_records WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .first<RecordRow>();
  if (!row) throw new ApiError(404, '未找到工资记录。');
  return recordFromRow(row);
}

export async function saveSalaryRecord(userId: string, input: SalaryRecord) {
  if (!input || typeof input !== 'object' || input.userId !== userId) {
    throw new ApiError(400, '工资记录归属无效。');
  }
  const db = await database();
  const owner = await getUserById(userId);
  if (!owner) throw new ApiError(404, '未找到用户。');
  const anyOwner = await db.prepare('SELECT id, user_id, status, currency, data_json FROM payroll_salary_records WHERE id = ?')
    .bind(input.id)
    .first<RecordRow>();
  if (anyOwner && anyOwner.user_id !== userId) throw new ApiError(403, '没有操作该工资记录的权限。');
  const existing = anyOwner ? recordFromRow(anyOwner) : null;
  if (existing && existing.status !== 1) throw new ApiError(409, '已提交的工资记录不可修改。');
  if (existing && input.updatedAt !== existing.updatedAt) {
    throw new ApiError(409, '该记录已经发生变化，请刷新后重试。');
  }

  const sanitized = await sanitizeSalaryRecord(db, userId, input, existing);
  const record: SalaryRecord = {
    ...sanitized,
    createdByUserId: existing?.createdByUserId || userId,
    createdByName: existing?.createdByName || profileDisplayName(parseProfile(owner.profile_json), owner.email),
    source: existing?.source ?? 'self',
  };
  const serialized = JSON.stringify(record);
  const auditDetail = { subjectUserId: userId, businessMonth: record.workDate.slice(0, 7) };
  const auditId = newId('audit');
  if (existing) {
    const statements = [db.prepare(`UPDATE payroll_salary_records
      SET status = 1, work_date = ?, final_salary = ?, currency = ?, data_json = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND status = 1 AND updated_at = ?
        AND EXISTS (SELECT 1 FROM payroll_users WHERE id = ? AND status = 'active')`)
      .bind(record.workDate, record.finalSalary, record.currency, serialized, record.updatedAt,
        record.id, userId, existing.updatedAt, userId)];
    statements.push(changedSalaryAuditStatement(db, auditId, userId, 'salary.update', record.id, auditDetail, record.updatedAt));
    statements.push(...conditionalSalaryFileReferenceStatements(db, userId, record.id, record.attachments, auditId));
    const [mutation] = await db.batch(statements);
    if (!mutation.meta.changes) throw new ApiError(409, '该记录已经发生变化，请刷新后重试。');
  } else {
    const statements = [db.prepare(`INSERT INTO payroll_salary_records
      (id, user_id, status, work_date, final_salary, currency, data_json, created_at, updated_at)
      SELECT ?, ?, 1, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM payroll_users WHERE id = ? AND status = 'active')`)
      .bind(record.id, userId, record.workDate, record.finalSalary, record.currency, serialized,
        record.createdAt, record.updatedAt, userId)];
    statements.push(changedSalaryAuditStatement(db, auditId, userId, 'salary.create', record.id, auditDetail, record.updatedAt));
    statements.push(...conditionalSalaryFileReferenceStatements(db, userId, record.id, record.attachments, auditId));
    const [mutation] = await db.batch(statements);
    if (!mutation.meta.changes) throw new ApiError(409, '账号状态已发生变化，请刷新后重试。');
  }
  return record;
}

export async function deleteSalaryRecord(userId: string, id: string, expectedUpdatedAt?: string) {
  const db = await database();
  const existing = await getSalaryRecord(userId, id);
  if (existing.status !== 1) throw new ApiError(409, '仅未提交记录可以删除。');
  if (!expectedUpdatedAt || expectedUpdatedAt !== existing.updatedAt) {
    throw new ApiError(409, '该记录已经发生变化，请刷新后重试。');
  }
  const [mutation] = await db.batch(guardedSalaryDeleteStatements(db, userId, userId, existing, 'salary.delete'));
  if (!mutation.meta.changes) throw new ApiError(409, '该记录已经发生变化，请刷新后重试。');
}

export async function applySalaryRecords(userId: string, requestedMonth?: string) {
  const db = await database();
  const user = await getUserById(userId);
  if (!user) throw new ApiError(404, '未找到用户。');
  const profile = parseProfile(user.profile_json);
  const profileError = profileSubmissionError(profile);
  if (profileError) throw new ApiError(400, profileError);
  const month = requestedMonth ?? currentMonth();
  if (!monthIsValid(month)) throw new ApiError(400, '申报月份格式无效。');
  const draftRows = await db.prepare(`SELECT id, user_id, status, currency, data_json
    FROM payroll_salary_records
    WHERE user_id = ? AND status = 1 AND work_date LIKE ?
    ORDER BY work_date ASC, created_at ASC`)
    .bind(userId, `${month}-%`)
    .all<RecordRow>();
  const originalDrafts = draftRows.results.map(recordFromRow);
  const now = new Date().toISOString();
  const drafts = originalDrafts.map((record) => ({
      ...record,
      status: 2 as const,
      checkDate: null,
      auditMemo: '',
      submittedByUserId: userId,
      submittedByName: profileDisplayName(profile, user.email),
      updatedAt: now,
    }));
  if (drafts.length === 0) throw new ApiError(400, `${month} 没有可提交的工资记录。`);

  const recordIds = drafts.map((record) => record.id);
  const desired = drafts.map((record) => ({
    id: record.id,
    previousUpdatedAt: originalDrafts.find((item) => item.id === record.id)?.updatedAt ?? '',
    dataJson: JSON.stringify(record),
  }));
  const auditId = newId('audit');
  const auditDetail = { month, recordIds };
  const [mutation] = await db.batch([
    db.prepare(`WITH desired AS (
        SELECT json_extract(value, '$.id') AS id,
          json_extract(value, '$.previousUpdatedAt') AS previous_updated_at,
          json_extract(value, '$.dataJson') AS data_json
        FROM json_each(?)
      ), eligible AS (
        SELECT desired.id
        FROM desired
        JOIN payroll_salary_records current ON current.id = desired.id
        WHERE current.user_id = ? AND current.status = 1
          AND current.updated_at = desired.previous_updated_at
      )
      UPDATE payroll_salary_records
      SET status = 2,
        data_json = (SELECT desired.data_json FROM desired WHERE desired.id = payroll_salary_records.id),
        updated_at = ?
      WHERE user_id = ? AND id IN (SELECT id FROM desired)
        AND (SELECT COUNT(*) FROM desired) = ?
        AND (SELECT COUNT(*) FROM eligible) = ?
        AND EXISTS (SELECT 1 FROM payroll_users WHERE id = ? AND status = 'active')`)
      .bind(JSON.stringify(desired), userId, now, userId, drafts.length, drafts.length, userId),
    db.prepare(`INSERT INTO payroll_audit_logs
      (id, actor_user_id, action, target_type, target_id, detail_json, subject_user_id, business_month, created_at)
      SELECT ?, ?, 'salary.submit', 'user', ?, ?, ?, ?, ?
      WHERE changes() = ?`)
      .bind(auditId, userId, userId, JSON.stringify(auditDetail), userId, month, now, drafts.length),
  ]);
  if (Number(mutation.meta.changes ?? 0) !== drafts.length) {
    throw new ApiError(409, '工资记录已经发生变化，请刷新后重新提交。');
  }
  return drafts;
}

export async function listProxyPayrollUsers(actor: SessionActor): Promise<ManagedUser[]> {
  requireRole(actor, ['reviewer', 'admin']);
  const db = await database();
  const result = await db.prepare('SELECT * FROM payroll_users ORDER BY created_at ASC').all<UserRow>();
  return result.results.map(toManagedUser);
}

export async function listProxySalaryRecords(actor: SessionActor, targetUserId: string, requestedMonth: string) {
  requireRole(actor, ['reviewer', 'admin']);
  const month = requireMonth(requestedMonth);
  const db = await database();
  await requireTargetUser(db, targetUserId, false);
  const result = await db.prepare(`SELECT id, user_id, status, currency, data_json
    FROM payroll_salary_records WHERE user_id = ? AND work_date LIKE ?
    ORDER BY work_date DESC, created_at DESC`)
    .bind(targetUserId, `${month}-%`)
    .all<RecordRow>();
  return result.results.map(recordFromRow);
}

export async function saveProxySalaryRecord(
  actor: SessionActor,
  targetUserId: string,
  input: SalaryRecord,
  submit: boolean,
) {
  requireRole(actor, ['reviewer', 'admin']);
  if (actor.userId === targetUserId) throw new ApiError(400, '请在“本人申报”中处理自己的工资。');
  if (!input || typeof input !== 'object' || input.userId !== targetUserId) {
    throw new ApiError(400, '工资记录归属无效。');
  }
  const db = await database();
  const target = await requireTargetUser(db, targetUserId, true);
  if (submit) requireSubmittableProfile(target);
  const anyOwner = await db.prepare('SELECT id, user_id, status, currency, data_json FROM payroll_salary_records WHERE id = ?')
    .bind(input.id)
    .first<RecordRow>();
  if (anyOwner && anyOwner.user_id !== targetUserId) throw new ApiError(403, '没有操作该工资记录的权限。');
  const existing = anyOwner ? recordFromRow(anyOwner) : null;
  if (existing && existing.status !== 1) throw new ApiError(409, '已提交的工资记录不可修改。');
  if (existing && input.updatedAt !== existing.updatedAt) {
    throw new ApiError(409, '该记录已经发生变化，请刷新后重试。');
  }

  const actorName = await actorDisplayName(db, actor);
  const sanitized = await sanitizeSalaryRecord(db, targetUserId, input, existing);
  const now = sanitized.updatedAt;
  const record: SalaryRecord = {
    ...sanitized,
    status: submit ? 2 : 1,
    createdByUserId: existing?.createdByUserId || actor.userId,
    createdByName: existing?.createdByName || actorName,
    submittedByUserId: submit ? actor.userId : existing?.submittedByUserId || '',
    submittedByName: submit ? actorName : existing?.submittedByName || '',
    source: existing?.source ?? 'proxy-single',
    updatedAt: now,
  };
  const serialized = JSON.stringify(record);
  const auditDetail = {
    subjectUserId: targetUserId,
    businessMonth: record.workDate.slice(0, 7),
    source: record.source,
    submitted: submit,
  };
  const auditId = newId('audit');
  if (existing) {
    const statements = [db.prepare(`UPDATE payroll_salary_records SET status = ?, work_date = ?, final_salary = ?, currency = ?,
      data_json = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = 1 AND updated_at = ?
        AND EXISTS (SELECT 1 FROM payroll_users
          WHERE id = ? AND status = 'active' AND role IN ('reviewer', 'admin'))`)
      .bind(record.status, record.workDate, record.finalSalary, record.currency, serialized, now,
        record.id, targetUserId, existing.updatedAt, actor.userId)];
    statements.push(changedSalaryAuditStatement(
      db,
      auditId,
      actor.userId,
      submit ? 'salary.proxy_submit' : 'salary.proxy_update',
      record.id,
      auditDetail,
      now,
    ));
    statements.push(...conditionalSalaryFileReferenceStatements(db, targetUserId, record.id, record.attachments, auditId));
    const [mutation] = await db.batch(statements);
    if (!mutation.meta.changes) throw new ApiError(409, '该记录已经发生变化，请刷新后重试。');
  } else {
    const statements = [db.prepare(`INSERT INTO payroll_salary_records
      (id, user_id, status, work_date, final_salary, currency, data_json, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM payroll_users WHERE id = ? AND status = 'active')
        AND EXISTS (SELECT 1 FROM payroll_users
          WHERE id = ? AND status = 'active' AND role IN ('reviewer', 'admin'))`)
      .bind(record.id, targetUserId, record.status, record.workDate, record.finalSalary, record.currency,
        serialized, record.createdAt, now, targetUserId, actor.userId)];
    statements.push(changedSalaryAuditStatement(
      db,
      auditId,
      actor.userId,
      submit ? 'salary.proxy_submit' : 'salary.proxy_create',
      record.id,
      auditDetail,
      now,
    ));
    statements.push(...conditionalSalaryFileReferenceStatements(db, targetUserId, record.id, record.attachments, auditId));
    const [mutation] = await db.batch(statements);
    if (!mutation.meta.changes) throw new ApiError(409, '账号状态已发生变化，请刷新后重试。');
  }
  return record;
}

export async function deleteProxySalaryRecord(
  actor: SessionActor,
  targetUserId: string,
  id: string,
  expectedUpdatedAt?: string,
) {
  requireRole(actor, ['reviewer', 'admin']);
  const db = await database();
  await requireTargetUser(db, targetUserId, false);
  const existing = await salaryRecordForOwner(db, targetUserId, id);
  if (existing.status !== 1) throw new ApiError(409, '仅未提交记录可以删除。');
  if (!expectedUpdatedAt || expectedUpdatedAt !== existing.updatedAt) {
    throw new ApiError(409, '该记录已经发生变化，请刷新后重试。');
  }
  const [mutation] = await db.batch(guardedSalaryDeleteStatements(
    db,
    actor.userId,
    targetUserId,
    existing,
    'salary.proxy_delete',
  ));
  if (!mutation.meta.changes) throw new ApiError(409, '该记录已经发生变化，请刷新后重试。');
}

export async function createProxyPayrollBatch(actor: SessionActor, input: ProxyPayrollBatchInput) {
  requireRole(actor, ['reviewer', 'admin']);
  const requestId = cleanStringStrict(input?.requestId, 120, '批次请求编号');
  if (!/^batch-request-[a-zA-Z0-9-]{8,100}$/.test(requestId)) throw new ApiError(400, '批次请求编号无效。');
  const targetUserId = cleanStringStrict(input?.targetUserId, 120, '申报对象');
  if (actor.userId === targetUserId) throw new ApiError(400, '请在“本人申报”中处理自己的工资。');
  const month = requireMonth(input?.month);
  const payloadHash = await hashProxyPayrollBatchInput(input);
  const db = await database();
  const replay = await replaySalaryBatch(db, actor, targetUserId, requestId, payloadHash);
  if (replay) {
    const rule = replay[0]?.recurringRuleId
      ? await optionalRecurringPayrollRule(db, replay[0].recurringRuleId)
      : null;
    return { records: replay, rule, replayed: true };
  }
  const target = await requireTargetUser(db, targetUserId, true);
  if (input.submit) requireSubmittableProfile(target);
  if (input?.template?.attachments?.length) throw new ApiError(400, '多条申报不支持重复使用附件。');
  const schedule = sanitizeBatchSchedule(input, month);
  const actorName = await actorDisplayName(db, actor);
  const batchId = newId('batch');
  const now = new Date().toISOString();
  const recurring = sanitizeRecurringRequest(input, month);
  const ruleId = recurring ? newId('rule') : null;
  const recordIds = schedule.sessions.map(() => newId('salary'));
  const firstSession = schedule.sessions[0];
  const sanitizedTemplate = await sanitizeSalaryRecord(db, targetUserId, {
    ...input.template,
    id: recordIds[0],
    userId: targetUserId,
    workDate: firstSession.workDate,
    startTime: firstSession.startTime,
    endTime: firstSession.endTime,
    restHours: firstSession.restHours,
    attachments: [],
    status: 1,
    checkDate: null,
    auditMemo: '',
    createdAt: now,
    updatedAt: now,
  }, null);
  const records: SalaryRecord[] = schedule.sessions.map((session, index) => {
    const calculated = recalculateRecord({
      ...sanitizedTemplate,
      id: recordIds[index],
      workDate: session.workDate,
      startTime: session.startTime,
      endTime: session.endTime,
      restHours: session.restHours,
      status: input.submit ? 2 : 1,
      createdByUserId: actor.userId,
      createdByName: actorName,
      submittedByUserId: input.submit ? actor.userId : '',
      submittedByName: input.submit ? actorName : '',
      source: 'proxy-batch',
      batchId,
      recurringRuleId: ruleId,
    });
    assertCalculatedSalaryRecord(calculated);
    return calculated;
  });
  const statements: D1PreparedStatement[] = [salaryRecordsInsertStatement(db, records, undefined, actor.userId)];
  let rule: RecurringPayrollRule | null = null;
  if (recurring && ruleId && schedule.fixedSchedule) {
    statements.push(db.prepare(`INSERT INTO payroll_recurring_rules
      (id, user_id, title, active, submit_on_generate, start_month, end_month, template_json, schedule_json, created_by_user_id,
       last_run_at, last_run_status, last_run_message, created_at, updated_at, deleted_at)
      SELECT ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 'success', ?, ?, ?, NULL
      WHERE EXISTS (SELECT 1 FROM payroll_users WHERE id = ? AND status = 'active')
        AND EXISTS (SELECT 1 FROM payroll_users
          WHERE id = ? AND status = 'active' AND role IN ('reviewer', 'admin'))`)
      .bind(ruleId, targetUserId, recurring.title, input.submit ? 1 : 0, recurring.startMonth, recurring.endMonth,
        JSON.stringify(records[0]), JSON.stringify(schedule.fixedSchedule), actor.userId,
        now, `已生成 ${month} 的 ${records.length} 条记录。`, now, now, targetUserId, actor.userId));
    statements.push(db.prepare(`INSERT INTO payroll_recurring_instances
      (rule_id, month, record_ids_json, created_at)
      SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM payroll_recurring_rules WHERE id = ?)`)
      .bind(ruleId, month, JSON.stringify(records.map((record) => record.id)), now, ruleId));
    rule = {
      id: ruleId,
      userId: targetUserId,
      userDisplayName: profileDisplayName(parseProfile(target.profile_json), target.email),
      userEmail: target.email,
      title: recurring.title,
      active: true,
      submit: Boolean(input.submit),
      startMonth: recurring.startMonth,
      endMonth: recurring.endMonth,
      template: records[0],
      schedule: schedule.fixedSchedule,
      createdByUserId: actor.userId,
      createdByName: actorName,
      lastRunAt: now,
      lastRunStatus: 'success',
      lastRunMessage: `已生成 ${month} 的 ${records.length} 条记录。`,
      createdAt: now,
      updatedAt: now,
    };
  }
  statements.push(db.prepare(`INSERT INTO payroll_salary_batches
    (id, request_id, actor_user_id, target_user_id, payload_hash, record_ids_json, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM payroll_users
      WHERE id = ? AND status = 'active' AND role IN ('reviewer', 'admin'))
      AND EXISTS (SELECT 1 FROM payroll_users WHERE id = ? AND status = 'active')`)
    .bind(batchId, requestId, actor.userId, targetUserId, payloadHash,
      JSON.stringify(records.map((record) => record.id)), now, actor.userId, targetUserId));
  statements.push(auditStatement(
    db,
    actor.userId,
    input.submit ? 'salary.proxy_batch_submit' : 'salary.proxy_batch_create',
    'salary_batch',
    batchId,
    {
      subjectUserId: targetUserId,
      businessMonth: month,
      recordIds: records.map((record) => record.id),
      recurringRuleId: ruleId,
    },
    now,
  ));
  if (ruleId) {
    statements.push(auditStatement(db, actor.userId, 'salary.rule_create', 'recurring_rule', ruleId, {
      subjectUserId: targetUserId,
      businessMonth: month,
      title: recurring?.title,
      submit: Boolean(input.submit),
    }, now));
  }
  try {
    const [recordInsertion] = await db.batch(statements);
    if (Number(recordInsertion.meta.changes ?? 0) !== records.length) {
      throw new ApiError(409, '账号或工资数据状态已发生变化，请刷新后重试。');
    }
  } catch (error) {
    const concurrentReplay = await replaySalaryBatch(db, actor, targetUserId, requestId, payloadHash);
    if (concurrentReplay) {
      const concurrentRule = concurrentReplay[0]?.recurringRuleId
        ? await optionalRecurringPayrollRule(db, concurrentReplay[0].recurringRuleId)
        : null;
      return { records: concurrentReplay, rule: concurrentRule, replayed: true };
    }
    throw error;
  }
  return { records, rule, replayed: false };
}

export async function listRecurringPayrollRules(actor: SessionActor, targetUserId?: string) {
  requireRole(actor, ['reviewer', 'admin']);
  const db = await database();
  const where = targetUserId ? 'WHERE r.user_id = ? AND r.deleted_at IS NULL' : 'WHERE r.deleted_at IS NULL';
  const statement = db.prepare(`SELECT r.*, u.email AS user_email, u.profile_json AS user_profile_json,
    c.email AS creator_email, c.profile_json AS creator_profile_json
    FROM payroll_recurring_rules r
    JOIN payroll_users u ON u.id = r.user_id
    LEFT JOIN payroll_users c ON c.id = r.created_by_user_id
    ${where} ORDER BY r.active DESC, r.updated_at DESC`);
  const result = targetUserId
    ? await statement.bind(targetUserId).all<RecurringRuleRow>()
    : await statement.all<RecurringRuleRow>();
  return result.results.map(toRecurringPayrollRule);
}

export async function updateRecurringPayrollRule(
  actor: SessionActor,
  id: string,
  input: { active?: boolean; title?: string; endMonth?: string; expectedUpdatedAt?: string },
) {
  requireRole(actor, ['reviewer', 'admin']);
  const db = await database();
  const existing = await recurringRuleRow(db, id);
  if (!input.expectedUpdatedAt || input.expectedUpdatedAt !== existing.updated_at) {
    throw new ApiError(409, '该规律已发生变化，请刷新后重试。');
  }
  const title = input.title === undefined ? existing.title : cleanStringStrict(input.title, 100, '规律名称');
  if (!title) throw new ApiError(400, '请填写规律名称。');
  const endMonth = input.endMonth === undefined ? existing.end_month : cleanStringStrict(input.endMonth, 7, '结束月份');
  if (endMonth && (!monthIsValid(endMonth) || endMonth < existing.start_month)) throw new ApiError(400, '结束月份无效。');
  const active = input.active === undefined ? Boolean(existing.active) : Boolean(input.active);
  const now = nextVersionTimestamp(existing.updated_at);
  const auditId = newId('audit');
  const detail = {
    subjectUserId: existing.user_id,
    title,
    active,
  };
  const [mutation] = await db.batch([
    db.prepare(`UPDATE payroll_recurring_rules SET title = ?, active = ?, end_month = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL AND updated_at = ?
        AND EXISTS (SELECT 1 FROM payroll_users
          WHERE id = ? AND status = 'active' AND role IN ('reviewer', 'admin'))`)
      .bind(title, active ? 1 : 0, endMonth, now, id, existing.updated_at, actor.userId),
    db.prepare(`INSERT INTO payroll_audit_logs
      (id, actor_user_id, action, target_type, target_id, detail_json, subject_user_id, business_month, created_at)
      SELECT ?, ?, ?, 'recurring_rule', ?, ?, ?, NULL, ? WHERE changes() = 1`)
      .bind(auditId, actor.userId, active ? 'salary.rule_update' : 'salary.rule_pause', id,
        JSON.stringify(detail), existing.user_id, now),
  ]);
  if (!mutation.meta.changes) throw new ApiError(409, '该规律已发生变化，请刷新后重试。');
  return toRecurringPayrollRule(await recurringRuleRow(db, id));
}

export async function deleteRecurringPayrollRule(actor: SessionActor, id: string, expectedUpdatedAt?: string) {
  requireRole(actor, ['reviewer', 'admin']);
  const db = await database();
  const existing = await recurringRuleRow(db, id);
  if (!expectedUpdatedAt || expectedUpdatedAt !== existing.updated_at) {
    throw new ApiError(409, '该规律已发生变化，请刷新后重试。');
  }
  const now = nextVersionTimestamp(existing.updated_at);
  const auditId = newId('audit');
  const detail = {
    subjectUserId: existing.user_id,
    title: existing.title,
  };
  const [mutation] = await db.batch([
    db.prepare(`UPDATE payroll_recurring_rules SET active = 0, deleted_at = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL AND updated_at = ?
        AND EXISTS (SELECT 1 FROM payroll_users
          WHERE id = ? AND status = 'active' AND role IN ('reviewer', 'admin'))`)
      .bind(now, now, id, existing.updated_at, actor.userId),
    db.prepare(`INSERT INTO payroll_audit_logs
      (id, actor_user_id, action, target_type, target_id, detail_json, subject_user_id, business_month, created_at)
      SELECT ?, ?, 'salary.rule_delete', 'recurring_rule', ?, ?, ?, NULL, ? WHERE changes() = 1`)
      .bind(auditId, actor.userId, id, JSON.stringify(detail), existing.user_id, now),
  ]);
  if (!mutation.meta.changes) throw new ApiError(409, '该规律已发生变化，请刷新后重试。');
}

export async function runDueRecurringPayrollRules(
  requestedMonth?: string,
  trigger: 'scheduled' | 'manual' = 'scheduled',
  targetUserId?: string,
  actor: SessionActor | null = null,
) {
  const month = requestedMonth ? requireMonth(requestedMonth) : tokyoMonth();
  const db = await database();
  if (targetUserId) await requireTargetUser(db, targetUserId, false);
  const submitterName = actor ? await actorDisplayName(db, actor) : '系统自动';
  const result = await db.prepare(`SELECT r.*, u.email AS user_email, u.profile_json AS user_profile_json,
    u.status AS user_status, c.email AS creator_email, c.profile_json AS creator_profile_json,
    i.rule_id AS instance_rule_id
    FROM payroll_recurring_rules r
    JOIN payroll_users u ON u.id = r.user_id
    LEFT JOIN payroll_users c ON c.id = r.created_by_user_id
    LEFT JOIN payroll_recurring_instances i ON i.rule_id = r.id AND i.month = ?
    WHERE r.active = 1 AND r.deleted_at IS NULL AND r.start_month <= ?
      AND (r.end_month = '' OR r.end_month >= ?)
      AND (? = '' OR r.user_id = ?)
    ORDER BY CASE WHEN i.rule_id IS NULL THEN 0 ELSE 1 END, r.updated_at ASC, r.created_at ASC
    LIMIT ?`).bind(month, month, month, targetUserId ?? '', targetUserId ?? '', MAX_RECURRING_RULES_PER_RUN)
    .all<RecurringRuleRow>();
  let generatedRules = 0;
  let generatedRecords = 0;
  let skippedRules = 0;
  const errors: Array<{ ruleId: string; message: string }> = [];
  for (const row of result.results) {
    if (row.instance_rule_id) {
      skippedRules += 1;
      continue;
    }
    try {
      if (toStatus(row.user_status ?? 'disabled') !== 'active') {
        throw new ApiError(409, '该账号已停用，不能新增工资。');
      }
      const profileError = profileSubmissionError(parseProfile(row.user_profile_json));
      if (profileError) throw new ApiError(400, `该员工${profileError}`);
      const rule = toRecurringPayrollRule(row);
      const schedule = scheduleForMonth(rule.schedule, month);
      const sessions = expandFixedPayrollSchedule(month, schedule);
      if (sessions.length === 0 || sessions.length > MAX_BATCH_RECORDS) throw new ApiError(400, '本月规律没有可生成的日期。');
      sessions.forEach((session) => validateScheduledSession(session, rule.template.applyType));
      const runAt = new Date().toISOString();
      const version = nextVersionTimestamp(row.updated_at);
      const creatorName = rule.createdByName || '系统';
      const recordIds = sessions.map(() => newId('salary'));
      const firstSession = sessions[0];
      const sanitizedTemplate = await sanitizeSalaryRecord(db, rule.userId, {
        ...rule.template,
        id: recordIds[0],
        userId: rule.userId,
        workDate: firstSession.workDate,
        startTime: firstSession.startTime,
        endTime: firstSession.endTime,
        restHours: firstSession.restHours,
        attachments: [],
        status: rule.submit ? 2 : 1,
        checkDate: null,
        auditMemo: '',
        createdAt: runAt,
        updatedAt: runAt,
      }, null);
      const records: SalaryRecord[] = sessions.map((session, index) => {
        const calculated = recalculateRecord({
          ...sanitizedTemplate,
          id: recordIds[index],
          workDate: session.workDate,
          startTime: session.startTime,
          endTime: session.endTime,
          restHours: session.restHours,
          status: rule.submit ? 2 : 1,
          createdByUserId: rule.createdByUserId,
          createdByName: creatorName,
          submittedByUserId: rule.submit && actor ? actor.userId : '',
          submittedByName: rule.submit ? submitterName : '',
          source: 'recurring',
          batchId: `recurring-${rule.id}-${month}`,
          recurringRuleId: rule.id,
        });
        assertCalculatedSalaryRecord(calculated);
        return calculated;
      });
      const recordIdsJson = JSON.stringify(records.map((record) => record.id));
      const claim = { ruleId: rule.id, month, recordIdsJson, createdAt: runAt };
      const auditId = newId('audit');
      const auditDetail = {
        subjectUserId: rule.userId,
        businessMonth: month,
        trigger,
        submitted: rule.submit,
        recordIds: records.map((record) => record.id),
      };
      const statements: D1PreparedStatement[] = [db.prepare(`INSERT INTO payroll_recurring_instances
        (rule_id, month, record_ids_json, created_at)
        SELECT ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM payroll_recurring_rules current
          JOIN payroll_users owner ON owner.id = current.user_id
          WHERE current.id = ? AND current.active = 1 AND current.deleted_at IS NULL
            AND current.updated_at = ? AND current.start_month <= ?
            AND (current.end_month = '' OR current.end_month >= ?)
            AND owner.status = 'active'
        ) AND (? IS NULL OR EXISTS (
          SELECT 1 FROM payroll_users current_actor
          WHERE current_actor.id = ? AND current_actor.status = 'active'
            AND current_actor.role IN ('reviewer', 'admin')
        )) AND NOT EXISTS (
          SELECT 1 FROM payroll_recurring_instances existing
          WHERE existing.rule_id = ? AND existing.month = ?
        )`).bind(rule.id, month, recordIdsJson, runAt, rule.id, row.updated_at, month, month,
          actor?.userId ?? null, actor?.userId ?? null, rule.id, month)];
      statements.push(salaryRecordsInsertStatement(db, records, claim, actor?.userId));
      statements.push(db.prepare(`UPDATE payroll_recurring_rules
        SET last_run_at = ?, last_run_status = 'success', last_run_message = ?, updated_at = ?
        WHERE id = ? AND EXISTS (
          SELECT 1 FROM payroll_recurring_instances instance
          WHERE instance.rule_id = ? AND instance.month = ?
            AND instance.record_ids_json = ? AND instance.created_at = ?
        )`).bind(runAt, `已生成 ${month} 的 ${records.length} 条记录。`, version,
        rule.id, rule.id, month, recordIdsJson, runAt));
      statements.push(db.prepare(`INSERT INTO payroll_audit_logs
        (id, actor_user_id, action, target_type, target_id, detail_json, subject_user_id, business_month, created_at)
        SELECT ?, ?, 'salary.rule_generate', 'recurring_rule', ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM payroll_recurring_instances instance
          WHERE instance.rule_id = ? AND instance.month = ?
            AND instance.record_ids_json = ? AND instance.created_at = ?
        )`).bind(auditId, actor?.userId ?? null, rule.id, JSON.stringify(auditDetail), rule.userId, month, runAt,
        rule.id, month, recordIdsJson, runAt));
      try {
        const [claimResult] = await db.batch(statements);
        if (!claimResult.meta.changes) {
          skippedRules += 1;
          continue;
        }
      } catch (error) {
        const completed = await db.prepare('SELECT rule_id FROM payroll_recurring_instances WHERE rule_id = ? AND month = ?')
          .bind(rule.id, month).first<{ rule_id: string }>();
        if (completed) {
          skippedRules += 1;
          continue;
        }
        throw error;
      }
      generatedRules += 1;
      generatedRecords += records.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : '规律生成失败。';
      errors.push({ ruleId: row.id, message });
      const runAt = new Date().toISOString();
      const version = nextVersionTimestamp(row.updated_at);
      const auditId = newId('audit');
      await db.batch([
        db.prepare(`UPDATE payroll_recurring_rules
          SET last_run_at = ?, last_run_status = 'error', last_run_message = ?, updated_at = ?
          WHERE id = ? AND active = 1 AND deleted_at IS NULL AND updated_at = ?`)
          .bind(runAt, message.slice(0, 500), version, row.id, row.updated_at),
        db.prepare(`INSERT INTO payroll_audit_logs
          (id, actor_user_id, action, target_type, target_id, detail_json, subject_user_id, business_month, created_at)
          SELECT ?, ?, 'salary.rule_generate_failed', 'recurring_rule', ?, ?, ?, ?, ? WHERE changes() = 1`)
          .bind(auditId, actor?.userId ?? null, row.id, JSON.stringify({
            subjectUserId: row.user_id,
            businessMonth: month,
            trigger,
            error: message.slice(0, 500),
          }), row.user_id, month, runAt),
      ]);
    }
  }
  return { month, generatedRules, generatedRecords, skippedRules, errors };
}

export async function runRecurringPayrollRulesManually(actor: SessionActor, requestedMonth?: string, targetUserId?: string) {
  requireRole(actor, ['reviewer', 'admin']);
  return runDueRecurringPayrollRules(requestedMonth, 'manual', targetUserId, actor);
}

export async function listReviewSalaryRecords(
  actor: SessionActor,
  status?: SalaryStatus,
): Promise<ReviewSalaryItem[]> {
  requireRole(actor, ['reviewer', 'admin']);
  const db = await database();
  const allowedStatuses: SalaryStatus[] = [2, 3, 4];
  if (status && !allowedStatuses.includes(status)) throw new ApiError(400, '审核状态筛选无效。');
  const query = status
    ? `SELECT r.id, r.user_id, r.status, r.currency, r.data_json, u.email, u.profile_json
       FROM payroll_salary_records r JOIN payroll_users u ON u.id = r.user_id
       WHERE r.status = ? ORDER BY r.work_date DESC, r.updated_at DESC`
    : `SELECT r.id, r.user_id, r.status, r.currency, r.data_json, u.email, u.profile_json
       FROM payroll_salary_records r JOIN payroll_users u ON u.id = r.user_id
       WHERE r.status IN (2, 3, 4) ORDER BY r.status ASC, r.work_date DESC, r.updated_at DESC`;
  const statement = db.prepare(query);
  const result = status
    ? await statement.bind(status).all<ReviewRow>()
    : await statement.all<ReviewRow>();
  return result.results.map((row) => ({
    user: {
      id: row.user_id,
      email: row.email,
      displayName: profileDisplayName(parseProfile(row.profile_json), row.email),
    },
    record: recordFromRow(row),
  }));
}

export async function reviewSalaryRecord(
  actor: SessionActor,
  id: string,
  decision: 'approve' | 'reject',
  auditMemo: string,
) {
  requireRole(actor, ['reviewer', 'admin']);
  if (!['approve', 'reject'].includes(decision)) throw new ApiError(400, '审核动作无效。');
  const memo = cleanStringStrict(auditMemo, 1000, '审核备注');
  if (decision === 'reject' && !memo) throw new ApiError(400, '驳回时必须填写审核备注。');
  const db = await database();
  const row = await db.prepare('SELECT id, user_id, status, currency, data_json FROM payroll_salary_records WHERE id = ?')
    .bind(id)
    .first<RecordRow>();
  if (!row) throw new ApiError(404, '未找到工资记录。');
  const existing = recordFromRow(row);
  if (existing.status !== 2) throw new ApiError(409, '只有待审核记录可以执行审核。');
  const now = nextVersionTimestamp(existing.updatedAt);
  const status: SalaryStatus = decision === 'approve' ? 3 : 4;
  const record: SalaryRecord = { ...existing, status, checkDate: now, auditMemo: memo, updatedAt: now };
  const auditDetail = {
    ownerUserId: row.user_id,
    businessMonth: existing.workDate.slice(0, 7),
    auditMemo: memo,
  };
  const auditId = newId('audit');
  const { subjectUserId, businessMonth } = auditDimensions('salary_record', id, auditDetail);
  const [result] = await db.batch([
    db.prepare(`UPDATE payroll_salary_records
      SET status = ?, data_json = ?, updated_at = ?
      WHERE id = ? AND status = 2 AND updated_at = ?
        AND EXISTS (SELECT 1 FROM payroll_users
          WHERE id = ? AND status = 'active' AND role IN ('reviewer', 'admin'))`)
      .bind(status, JSON.stringify(record), now, id, existing.updatedAt, actor.userId),
    db.prepare(`INSERT INTO payroll_audit_logs
      (id, actor_user_id, action, target_type, target_id, detail_json, subject_user_id, business_month, created_at)
      SELECT ?, ?, ?, 'salary_record', ?, ?, ?, ?, ? WHERE changes() = 1`)
      .bind(auditId, actor.userId, `salary.${decision}`, id, JSON.stringify(auditDetail),
        subjectUserId, businessMonth, now),
  ]);
  if (!result.meta.changes) throw new ApiError(409, '该记录已被其他审核员处理，请刷新。');
  return record;
}

export async function listManagedUsers(actor: SessionActor): Promise<ManagedUser[]> {
  requireRole(actor, ['admin']);
  const db = await database();
  const result = await db.prepare('SELECT * FROM payroll_users ORDER BY created_at ASC').all<UserRow>();
  return result.results.map(toManagedUser);
}

export async function updateManagedUser(
  actor: SessionActor,
  targetUserId: string,
  input: ManagedUserUpdateInput,
) {
  requireRole(actor, ['admin']);
  if (!input || typeof input !== 'object') throw new ApiError(400, '账号权限请求无效。');
  const db = await database();
  const target = await db.prepare('SELECT * FROM payroll_users WHERE id = ?').bind(targetUserId).first<UserRow>();
  if (!target) throw new ApiError(404, '未找到用户。');
  const expectedUpdatedAt = cleanStringStrict(input.expectedUpdatedAt, 40, '账号版本');
  if (!expectedUpdatedAt) throw new ApiError(400, '缺少账号版本，请刷新后重试。');
  if (expectedUpdatedAt !== target.updated_at) throw new ApiError(409, '账号权限已发生变化，请刷新后重试。');
  const nextRole = input.role ?? toRole(target.role);
  const nextStatus = input.status ?? toStatus(target.status);
  const nextWorkManager = typeof input.workManager === 'boolean' ? input.workManager : Boolean(target.work_manager);
  if (!isRole(nextRole) || !isStatus(nextStatus)) throw new ApiError(400, '账号角色或状态无效。');
  if (actor.userId === targetUserId && nextStatus === 'disabled') {
    throw new ApiError(400, '管理员不能停用自己的账号。');
  }

  const now = nextVersionTimestamp(target.updated_at);
  const sessionsRevoked = Boolean(input.revokeSessions || nextStatus === 'disabled');
  const auditDetail = {
    from: { role: toRole(target.role), status: toStatus(target.status), workManager: Boolean(target.work_manager) },
    to: { role: nextRole, status: nextStatus, workManager: nextWorkManager },
    sessionsRevoked,
  };
  const { subjectUserId, businessMonth } = auditDimensions('user', targetUserId, auditDetail);
  const [update] = await db.batch([
    db.prepare(`UPDATE payroll_users
      SET role = ?, status = ?, work_manager = ?, updated_at = ?
      WHERE id = ? AND updated_at = ? AND (
        role <> 'admin' OR status <> 'active'
        OR (? = 'admin' AND ? = 'active')
        OR EXISTS (
          SELECT 1 FROM payroll_users AS other
          WHERE other.id <> ? AND other.role = 'admin' AND other.status = 'active'
        )
      ) AND EXISTS (SELECT 1 FROM payroll_users current_actor
        WHERE current_actor.id = ? AND current_actor.status = 'active' AND current_actor.role = 'admin')`)
      .bind(nextRole, nextStatus, nextWorkManager ? 1 : 0, now, targetUserId, expectedUpdatedAt,
        nextRole, nextStatus, targetUserId, actor.userId),
    db.prepare(`DELETE FROM payroll_sessions
      WHERE user_id = ? AND ? = 1
        AND EXISTS (SELECT 1 FROM payroll_users WHERE id = ? AND updated_at = ?)`)
      .bind(targetUserId, sessionsRevoked ? 1 : 0, targetUserId, now),
    db.prepare(`INSERT INTO payroll_audit_logs
      (id, actor_user_id, action, target_type, target_id, detail_json, subject_user_id, business_month, created_at)
      SELECT ?, ?, 'account.permission_update', 'user', ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM payroll_users WHERE id = ? AND updated_at = ?)`)
      .bind(newId('audit'), actor.userId, targetUserId, JSON.stringify(auditDetail), subjectUserId, businessMonth,
        now, targetUserId, now),
  ]);
  if (!update.meta.changes) {
    const latest = await db.prepare('SELECT updated_at FROM payroll_users WHERE id = ?')
      .bind(targetUserId)
      .first<{ updated_at: string }>();
    if (latest && latest.updated_at !== expectedUpdatedAt) {
      throw new ApiError(409, '账号权限已发生变化，请刷新后重试。');
    }
    throw new ApiError(409, '系统必须保留至少一个正常状态的管理员。');
  }
  const updated = await db.prepare('SELECT * FROM payroll_users WHERE id = ?').bind(targetUserId).first<UserRow>();
  if (!updated) throw new ApiError(404, '未找到用户。');
  return toManagedUser(updated);
}

export async function adminResetPassword(
  actor: SessionActor,
  targetUserId: string,
  newPasswordDigest: string,
  expectedUpdatedAt: string,
) {
  requireRole(actor, ['admin']);
  validateCredentialDigest(newPasswordDigest);
  const expectedVersion = cleanStringStrict(expectedUpdatedAt, 40, '账号版本');
  if (!expectedVersion) throw new ApiError(400, '缺少账号版本，请刷新后重试。');
  const target = await getUserById(targetUserId);
  if (!target) throw new ApiError(404, '未找到用户。');
  if (target.updated_at !== expectedVersion) throw new ApiError(409, '账号状态已发生变化，请刷新后重试。');
  const db = await database();
  const now = nextVersionTimestamp(target.updated_at);
  const auditId = newId('audit');
  const detail = { sessionsRevoked: true };
  const [passwordReset] = await db.batch([
    db.prepare(`UPDATE payroll_users
      SET password_digest = ?, failed_login_count = 0, locked_until = NULL, updated_at = ?
      WHERE id = ? AND updated_at = ?
        AND EXISTS (SELECT 1 FROM payroll_users current_actor
          WHERE current_actor.id = ? AND current_actor.status = 'active' AND current_actor.role = 'admin')`)
      .bind(await hashCredential(newPasswordDigest), now, targetUserId, expectedVersion, actor.userId),
    db.prepare(`INSERT INTO payroll_audit_logs
      (id, actor_user_id, action, target_type, target_id, detail_json, subject_user_id, business_month, created_at)
      SELECT ?, ?, 'account.password_admin_reset', 'user', ?, ?, ?, NULL, ? WHERE changes() = 1`)
      .bind(auditId, actor.userId, targetUserId, JSON.stringify(detail), targetUserId, now),
    db.prepare(`DELETE FROM payroll_sessions
      WHERE user_id = ? AND EXISTS (SELECT 1 FROM payroll_audit_logs WHERE id = ?)`)
      .bind(targetUserId, auditId),
  ]);
  if (!passwordReset.meta.changes) throw new ApiError(409, '账号状态已发生变化，请刷新后重试。');
}

export async function getAdminSettings(actor: SessionActor) {
  requireRole(actor, ['admin']);
  const db = await database();
  return { registrationOpen: await registrationIsOpen(db) };
}

export async function updateAdminSettings(actor: SessionActor, input: { registrationOpen?: boolean }) {
  requireRole(actor, ['admin']);
  if (typeof input.registrationOpen !== 'boolean') throw new ApiError(400, '注册开关设置无效。');
  const db = await database();
  const now = new Date().toISOString();
  const update = await db.prepare(`INSERT INTO payroll_settings (key, value, updated_by, updated_at)
    SELECT 'registration_open', ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM payroll_users WHERE id = ? AND status = 'active' AND role = 'admin')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .bind(input.registrationOpen ? '1' : '0', actor.userId, now, actor.userId)
    .run();
  if (!update.meta.changes) throw new ApiError(409, '账号状态已发生变化，请重新登录。');
  await writeAudit(db, actor.userId, 'settings.registration_update', 'setting', 'registration_open', {
    registrationOpen: input.registrationOpen,
  });
  return { registrationOpen: input.registrationOpen };
}

export async function listPayrollDepartments(actor: SessionActor): Promise<DepartmentOption[]> {
  requireRole(actor, ['employee', 'reviewer', 'admin']);
  const db = await database();
  const result = await db.prepare(`SELECT id, label, active, sort_order, created_at, updated_at
    FROM payroll_departments WHERE active = 1 ORDER BY sort_order ASC, created_at ASC`).all<DepartmentRow>();
  return result.results.map(toDepartmentOption);
}

export async function listPayrollWorkManagers(actor: SessionActor): Promise<WorkManagerOption[]> {
  requireRole(actor, ['employee', 'reviewer', 'admin']);
  const db = await database();
  return activeWorkManagers(db);
}

export async function listAdminDepartments(actor: SessionActor): Promise<DepartmentOption[]> {
  requireRole(actor, ['admin']);
  const db = await database();
  const result = await db.prepare(`SELECT id, label, active, sort_order, created_at, updated_at
    FROM payroll_departments ORDER BY active DESC, sort_order ASC, created_at ASC`).all<DepartmentRow>();
  return result.results.map(toDepartmentOption);
}

export async function createDepartment(actor: SessionActor, input: { label?: string }) {
  requireRole(actor, ['admin']);
  const label = cleanStringStrict(input.label, 80, '部门名称');
  if (!label) throw new ApiError(400, '请填写部门选项名称。');
  const db = await database();
  const duplicate = await db.prepare('SELECT id FROM payroll_departments WHERE label = ? AND active = 1')
    .bind(label).first<{ id: string }>();
  if (duplicate) throw new ApiError(409, '已存在同名的有效部门选项。');
  const max = await db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS value FROM payroll_departments WHERE active = 1')
    .first<{ value: number }>();
  const id = newId('department');
  const now = new Date().toISOString();
  const insertion = await db.prepare(`INSERT INTO payroll_departments
    (id, label, active, sort_order, created_at, updated_at, deleted_at)
    SELECT ?, ?, 1, ?, ?, ?, NULL
    WHERE EXISTS (SELECT 1 FROM payroll_users WHERE id = ? AND status = 'active' AND role = 'admin')`)
    .bind(id, label, Number(max?.value ?? -1) + 1, now, now, actor.userId).run();
  if (!insertion.meta.changes) throw new ApiError(409, '账号状态已发生变化，请重新登录。');
  await writeAudit(db, actor.userId, 'department.create', 'department', id, { label });
  return toDepartmentOption({ id, label, active: 1, sort_order: Number(max?.value ?? -1) + 1, created_at: now, updated_at: now });
}

export async function deactivateDepartment(actor: SessionActor, id: string) {
  requireRole(actor, ['admin']);
  const db = await database();
  const department = await db.prepare(`SELECT id, label, active, sort_order, created_at, updated_at
    FROM payroll_departments WHERE id = ?`).bind(id).first<DepartmentRow>();
  if (!department) throw new ApiError(404, '未找到部门选项。');
  if (!department.active) return toDepartmentOption(department);
  const now = new Date().toISOString();
  const update = await db.prepare(`UPDATE payroll_departments SET active = 0, updated_at = ?, deleted_at = ?
    WHERE id = ? AND EXISTS (SELECT 1 FROM payroll_users
      WHERE id = ? AND status = 'active' AND role = 'admin')`)
    .bind(now, now, id, actor.userId).run();
  if (!update.meta.changes) throw new ApiError(409, '部门或账号状态已发生变化，请刷新后重试。');
  await writeAudit(db, actor.userId, 'department.delete', 'department', id, {
    label: department.label,
    historicalRecordsPreserved: true,
  });
  return toDepartmentOption({ ...department, active: 0, updated_at: now });
}

export async function listRecentAuditLogs(actor: SessionActor, limit = 10): Promise<AuditLogItem[]> {
  requireRole(actor, ['reviewer', 'admin']);
  return queryAuditLogs(await database(), Math.min(Math.max(Math.floor(limit) || 10, 1), 10));
}

export async function listStaffEmployees(actor: SessionActor): Promise<EmployeeSummary[]> {
  requireRole(actor, ['reviewer', 'admin']);
  return listStaffEmployeesInternal(await database());
}

export async function getStaffEmployeeDetail(actor: SessionActor, targetUserId: string): Promise<EmployeeDetail> {
  requireRole(actor, ['reviewer', 'admin']);
  const db = await database();
  const userRow = await db.prepare('SELECT * FROM payroll_users WHERE id = ?').bind(targetUserId).first<UserRow>();
  if (!userRow) throw new ApiError(404, '未找到员工账号。');
  const salaryRecords = await listSalaryRecords(targetUserId);
  const filesResult = await db.prepare(`SELECT f.key, f.user_id, f.original_name, f.content_type, f.size, f.created_at,
    GROUP_CONCAT(DISTINCT r.reference_type) AS reference_types
    FROM payroll_files f LEFT JOIN payroll_file_references r ON r.file_key = f.key
    WHERE f.user_id = ? GROUP BY f.key ORDER BY f.created_at DESC`).bind(targetUserId).all<StaffFileRow>();
  return {
    user: toManagedUser(userRow),
    profile: parseProfile(userRow.profile_json),
    files: filesResult.results.map(toStoredFileInfo),
    salaryRecords,
    monthlySummaries: monthlySummaries(salaryRecords),
    auditLogs: await queryAccountAuditLogs(db, targetUserId),
  };
}

export async function getStaffTransferSheet(actor: SessionActor, requestedMonth?: string): Promise<TransferSheetRow[]> {
  requireRole(actor, ['reviewer', 'admin']);
  const month = requestedMonth || currentMonth();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError(400, '查看月份格式无效。');
  const db = await database();
  const [usersResult, recordsResult, filesResult] = await Promise.all([
    db.prepare('SELECT * FROM payroll_users ORDER BY created_at ASC').all<UserRow>(),
    db.prepare(`SELECT id, user_id, status, currency, data_json FROM payroll_salary_records
      WHERE status = 3 AND work_date LIKE ? ORDER BY work_date DESC, created_at DESC`)
      .bind(`${month}-%`).all<RecordRow>(),
    db.prepare(`SELECT f.key, f.user_id, f.original_name, f.content_type, f.size, f.created_at,
      GROUP_CONCAT(DISTINCT r.reference_type) AS reference_types
      FROM payroll_files f LEFT JOIN payroll_file_references r ON r.file_key = f.key
      WHERE f.content_type = 'application/pdf'
      GROUP BY f.key ORDER BY f.created_at DESC`).all<StaffFileRow>(),
  ]);
  const recordsByUser = new Map<string, SalaryRecord[]>();
  for (const row of recordsResult.results) {
    recordsByUser.set(row.user_id, [...(recordsByUser.get(row.user_id) ?? []), recordFromRow(row)]);
  }
  const filesByUser = new Map<string, StoredFileInfo[]>();
  for (const row of filesResult.results) {
    filesByUser.set(row.user_id, [...(filesByUser.get(row.user_id) ?? []), toStoredFileInfo(row)]);
  }
  return usersResult.results.map((row) => ({
    user: toManagedUser(row),
    profile: parseProfile(row.profile_json),
    approvedAmounts: sumByCurrency(recordsByUser.get(row.id) ?? []),
    pdfFiles: filesByUser.get(row.id) ?? [],
  }));
}

export async function getAuditOverview(
  actor: SessionActor,
  input: { year?: string; month?: string; userId?: string },
): Promise<AuditOverview> {
  requireRole(actor, ['reviewer', 'admin']);
  const now = new Date();
  const year = /^\d{4}$/.test(input.year ?? '') ? input.year! : String(now.getFullYear());
  const fallbackMonth = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const month = new RegExp(`^${year}-(0[1-9]|1[0-2])$`).test(input.month ?? '') ? input.month! : fallbackMonth;
  const db = await database();
  const result = await db.prepare(`SELECT id, user_id, status, currency, data_json
    FROM payroll_salary_records WHERE status IN (2, 3, 4) AND work_date LIKE ?
    ORDER BY work_date DESC, updated_at DESC`).bind(`${year}-%`).all<RecordRow>();
  const employees = await listStaffEmployeesInternal(db);
  if (input.userId && !employees.some((employee) => employee.id === input.userId)) {
    throw new ApiError(404, '未找到要追踪的账号。');
  }
  const allRecords = result.results.map(recordFromRow);
  const records = input.userId
    ? allRecords.filter((record) => record.userId === input.userId)
    : allRecords;
  const monthRecords = records.filter((record) => record.workDate.startsWith(month));
  const departments = new Map<string, SalaryRecord[]>();
  for (const record of monthRecords) {
    const label = getDepartmentLabel(record.departmentKey, record.departmentLabel);
    departments.set(label, [...(departments.get(label) ?? []), record]);
  }
  return {
    year,
    month,
    monthSummary: summarizeRecords(monthRecords, month),
    yearSummary: summarizeRecords(records, year),
    monthlySummaries: Array.from({ length: 12 }, (_, index) => {
      const key = `${year}-${String(index + 1).padStart(2, '0')}`;
      return summarizeRecords(records.filter((record) => record.workDate.startsWith(key)), key);
    }),
    departmentSummaries: [...departments.entries()].map(([departmentLabel, departmentRecords]) => ({
      departmentLabel,
      recordCount: departmentRecords.length,
      submittedAmounts: sumByCurrency(departmentRecords),
      approvedAmounts: sumByCurrency(departmentRecords.filter((record) => record.status === 3)),
    })).sort((left, right) => right.recordCount - left.recordCount),
    recentLogs: await queryAuditLogs(db, 10),
    employees,
    accountLogs: input.userId ? await queryAccountAuditLogs(db, input.userId, month) : [],
  };
}

export async function listAuditLogs(actor: SessionActor, limit = 100): Promise<AuditLogItem[]> {
  requireRole(actor, ['admin']);
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 200) : 100;
  return queryAuditLogs(await database(), safeLimit);
}

export async function uploadFile(request: Request) {
  const actor = await requireSession(request);
  return storeUploadedFile(request, actor, actor.userId);
}

export async function uploadFileForUser(request: Request, targetUserId: string) {
  const actor = await requireSession(request);
  requireRole(actor, ['reviewer', 'admin']);
  const db = await database();
  await requireTargetUser(db, targetUserId, true);
  return storeUploadedFile(request, actor, targetUserId);
}

async function storeUploadedFile(request: Request, actor: SessionActor, ownerUserId: string) {
  if (!env.FILES) throw new ApiError(503, '文件存储绑定不可用。');
  const db = await database();
  const body = await request.formData();
  const file = body.get('file');
  if (!(file instanceof File)) throw new ApiError(400, '缺少文件。');
  if (file.size <= 0) throw new ApiError(400, '不能上传空文件。');
  if (file.size > 10 * 1024 * 1024) throw new ApiError(400, '单个文件不能超过 10MB。');
  const bytes = await file.arrayBuffer();
  validateUploadedFile(file.type, new Uint8Array(bytes));
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'file';
  const key = `payroll/${ownerUserId}/${Date.now()}-${newId('file')}-${safeName}`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: file.type } });
  const createdAt = new Date().toISOString();
  const auditDetail = {
    name: file.name,
    size: file.size,
    subjectUserId: ownerUserId,
  };
  const auditId = newId('audit');
  const auditAction = ownerUserId === actor.userId ? 'file.upload' : 'file.upload_privileged';
  const { subjectUserId, businessMonth } = auditDimensions('file', key, auditDetail);
  let metadataResult: D1Result<unknown>;
  try {
    [metadataResult] = await db.batch([
      db.prepare(`INSERT INTO payroll_files
        (key, user_id, original_name, content_type, size, created_at)
        SELECT ?, ?, ?, ?, ?, ?
        WHERE (SELECT COUNT(*) FROM payroll_files WHERE user_id = ?) < ?
          AND (SELECT COALESCE(SUM(size), 0) FROM payroll_files WHERE user_id = ?) + ? <= ?
          AND EXISTS (SELECT 1 FROM payroll_users WHERE id = ? AND status = 'active')
          AND EXISTS (SELECT 1 FROM payroll_users actor
            WHERE actor.id = ? AND actor.status = 'active'
              AND (actor.id = ? OR actor.role IN ('reviewer', 'admin')))
          AND (
            NOT EXISTS (SELECT 1 FROM payroll_settings WHERE key = 'gray_clear_plan_v1')
            OR COALESCE((SELECT value FROM payroll_settings WHERE key = 'gray_maintenance_retired'), '0') = '1'
          )`)
        .bind(key, ownerUserId, cleanString(file.name, 255), file.type, file.size, createdAt,
          ownerUserId, MAX_FILES_PER_USER, ownerUserId, file.size, MAX_FILE_BYTES_PER_USER,
          ownerUserId, actor.userId, ownerUserId),
      db.prepare(`INSERT INTO payroll_audit_logs
        (id, actor_user_id, action, target_type, target_id, detail_json, subject_user_id, business_month, created_at)
        SELECT ?, ?, ?, 'file', ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM payroll_files WHERE key = ?)`)
        .bind(auditId, actor.userId, auditAction, key, JSON.stringify(auditDetail),
          subjectUserId, businessMonth, createdAt, key),
    ]);
  } catch (error) {
    let metadataCommitted = false;
    let metadataStateKnown = false;
    try {
      metadataCommitted = Boolean(await db.prepare('SELECT key FROM payroll_files WHERE key = ?').bind(key).first());
      metadataStateKnown = true;
    } catch (stateError) {
      console.error('Unable to confirm D1 state after a failed upload transaction.', { key, stateError });
    }
    if (metadataCommitted) {
      return { key, name: file.name, contentType: file.type, size: file.size };
    }
    if (metadataStateKnown) {
      try {
        await env.FILES.delete(key);
      } catch (cleanupError) {
        console.error('Unable to compensate an R2 object after a failed upload transaction.', { key, cleanupError });
      }
    }
    throw error;
  }
  if (!metadataResult.meta.changes) {
    try {
      await env.FILES.delete(key);
    } catch (cleanupError) {
      console.error('Unable to compensate an R2 object rejected by the account quota.', { key, cleanupError });
    }
    const uploadStillAuthorized = await db.prepare(`SELECT owner.id
      FROM payroll_users owner JOIN payroll_users actor ON actor.id = ?
      WHERE owner.id = ? AND owner.status = 'active' AND actor.status = 'active'
        AND (actor.id = owner.id OR actor.role IN ('reviewer', 'admin'))`)
      .bind(actor.userId, ownerUserId)
      .first<{ id: string }>();
    if (!uploadStillAuthorized) throw new ApiError(409, '账号或权限状态已发生变化，请重新登录。');
    throw new ApiError(413, '该账号的附件存储空间已满，请删除未使用的附件或联系管理员。');
  }
  return { key, name: file.name, contentType: file.type, size: file.size };
}

export async function downloadFile(request: Request, key: string) {
  const actor = await requireSession(request);
  const db = await database();
  const file = await db.prepare('SELECT * FROM payroll_files WHERE key = ?').bind(key).first<FileRow>();
  if (!file) throw new ApiError(404, '未找到附件。');
  if (!(await canReadFile(db, actor, file))) throw new ApiError(403, '没有读取该附件的权限。');
  if (!env.FILES) throw new ApiError(503, '文件存储绑定不可用。');
  const object = await env.FILES.get(key);
  if (!object) throw new ApiError(404, '附件对象不存在。');
  if (actor.userId !== file.user_id) {
    await writeAudit(db, actor.userId, 'file.read_privileged', 'file', key, { ownerUserId: file.user_id });
  }
  const headers = new Headers();
  headers.set('content-type', file.content_type || 'application/octet-stream');
  headers.set('content-length', String(file.size));
  headers.set('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.original_name)}`);
  headers.set('cache-control', 'private, no-store');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('content-security-policy', "sandbox; default-src 'none'");
  return new Response(object.body, { headers });
}

function validateUploadedFile(contentType: string, bytes: Uint8Array) {
  const matches = (...signature: number[]) => signature.every((value, index) => bytes[index] === value);
  const valid = contentType === 'application/pdf'
    ? matches(0x25, 0x50, 0x44, 0x46, 0x2d)
    : contentType === 'image/jpeg'
      ? matches(0xff, 0xd8, 0xff)
      : contentType === 'image/png'
        ? matches(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
        : contentType === 'image/webp'
          ? matches(0x52, 0x49, 0x46, 0x46)
            && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
          : false;
  if (!valid) throw new ApiError(400, '只支持有效的 JPG、PNG、WebP 或 PDF 文件。');
}

export async function deleteFile(request: Request, key: string) {
  const actor = await requireSession(request);
  const db = await database();
  const file = await db.prepare('SELECT * FROM payroll_files WHERE key = ?').bind(key).first<FileRow>();
  if (!env.FILES) throw new ApiError(503, '文件存储绑定不可用。');
  let ownerUserId: string;
  if (file) {
    ownerUserId = file.user_id;
    if (actor.userId !== ownerUserId && actor.role !== 'admin') throw new ApiError(403, '没有删除该附件的权限。');
    const now = new Date().toISOString();
    const detail = { ownerUserId, storageCleanupPending: true };
    const { subjectUserId, businessMonth } = auditDimensions('file', key, detail);
    const auditId = newId('audit');
    const [deletion] = await db.batch([
      db.prepare(`DELETE FROM payroll_files
        WHERE key = ? AND user_id = ?
          AND NOT EXISTS (SELECT 1 FROM payroll_file_references WHERE file_key = ?)
          AND EXISTS (SELECT 1 FROM payroll_users actor
            WHERE actor.id = ? AND actor.status = 'active'
              AND (actor.id = ? OR actor.role = 'admin'))`)
        .bind(key, ownerUserId, key, actor.userId, ownerUserId),
      db.prepare(`INSERT INTO payroll_audit_logs
        (id, actor_user_id, action, target_type, target_id, detail_json, subject_user_id, business_month, created_at)
        SELECT ?, ?, 'file.delete_requested', 'file', ?, ?, ?, ?, ? WHERE changes() = 1`)
        .bind(auditId, actor.userId, key, JSON.stringify(detail), subjectUserId, businessMonth, now),
    ]);
    if (!deletion.meta.changes) {
      const reference = await db.prepare('SELECT reference_id FROM payroll_file_references WHERE file_key = ? LIMIT 1')
        .bind(key)
        .first<{ reference_id: string }>();
      if (reference) throw new ApiError(409, '附件仍被资料或工资记录引用，不能删除。');
      throw new ApiError(409, '附件状态已发生变化，请重试。');
    }
  } else {
    const pending = await db.prepare(`SELECT action, detail_json FROM payroll_audit_logs
      WHERE target_type = 'file' AND target_id = ? AND action IN ('file.delete_requested', 'file.delete')
      ORDER BY created_at DESC, action = 'file.delete' DESC LIMIT 1`)
      .bind(key)
      .first<{ action: string; detail_json: string }>();
    if (!pending) throw new ApiError(404, '未找到附件。');
    const detail = parseJsonObject(pending.detail_json);
    ownerUserId = typeof detail.ownerUserId === 'string' ? detail.ownerUserId : '';
    if (!ownerUserId) throw new ApiError(404, '未找到附件。');
    if (actor.userId !== ownerUserId && actor.role !== 'admin') throw new ApiError(403, '没有删除该附件的权限。');
    if (pending.action === 'file.delete') return;
  }

  try {
    await env.FILES.delete(key);
  } catch (error) {
    console.error('R2 cleanup failed after the file was safely removed from D1.', { key, error });
    throw new ApiError(503, '附件已从系统移除，存储清理暂未完成，请重试删除。');
  }
  await writeAudit(db, actor.userId, 'file.delete', 'file', key, { ownerUserId, storageCleanupPending: false });
}

export function sessionCookie(request: Request, token: string, expiresAt: number) {
  const secure = secureCookieAttribute(request);
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}; Expires=${new Date(expiresAt).toUTCString()}${secure}`;
}

export function clearSessionCookie(request: Request) {
  const secure = secureCookieAttribute(request);
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`;
}

function secureCookieAttribute(request: Request) {
  const url = new URL(request.url);
  const localDevelopment = url.hostname === 'localhost'
    || url.hostname === '127.0.0.1'
    || url.hostname === '[::1]';
  return url.protocol === 'https:' || !localDevelopment ? '; Secure' : '';
}

export function requireSameOriginMutation(request: Request) {
  if (!mutationRequestIsSameOrigin(
    request.method,
    request.headers.get('origin'),
    new URL(request.url).origin,
    request.headers.get('sec-fetch-site'),
  )) {
    throw new ApiError(403, '请求来源无效。');
  }
}

export function json(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  return Response.json(data, { ...init, headers });
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) return json({ error: error.message }, { status: error.status });
  console.error(error);
  return json({ error: '服务器暂时无法处理请求。' }, { status: 500 });
}

async function getUserByEmail(email: string) {
  const db = await database();
  return db.prepare('SELECT * FROM payroll_users WHERE email = ?').bind(email).first<UserRow>();
}

async function getUserById(id: string) {
  const db = await database();
  return db.prepare('SELECT * FROM payroll_users WHERE id = ?').bind(id).first<UserRow>();
}

async function issueSession(userId: string) {
  const db = await database();
  const token = newId('session');
  const tokenHash = await sessionTokenHash(token);
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  const now = new Date().toISOString();
  const [, insertion] = await db.batch([
    db.prepare('DELETE FROM payroll_sessions WHERE expires_at <= ?').bind(Date.now()),
    db.prepare(`INSERT INTO payroll_sessions (token, user_id, expires_at, created_at)
      SELECT ?, ?, ?, ? WHERE EXISTS (
        SELECT 1 FROM payroll_users WHERE id = ? AND status = 'active'
      )`).bind(tokenHash, userId, expiresAt, now, userId),
  ]);
  if (!insertion.meta.changes) throw new ApiError(409, '账号状态已发生变化，请重新登录。');
  return { token, expiresAt };
}

function readSessionToken(request: Request) {
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return bearer;
  const cookies = request.headers.get('cookie') ?? '';
  for (const part of cookies.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) {
      try {
        return decodeURIComponent(value.join('='));
      } catch {
        return '';
      }
    }
  }
  return '';
}

function toAccount(row: UserRow): StoredAccount {
  return {
    id: row.id,
    email: row.email,
    role: toRole(row.role),
    status: toStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
    profile: parseProfile(row.profile_json),
    salaryRecords: [],
  };
}

function toManagedUser(row: UserRow): ManagedUser {
  const profile = parseProfile(row.profile_json);
  return {
    id: row.id,
    email: row.email,
    displayName: profileDisplayName(profile, row.email),
    role: toRole(row.role),
    status: toStatus(row.status),
    workManager: Boolean(row.work_manager),
    profileReady: profileMissingRequirements(profile).length === 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

function parseProfile(value: string): Profile {
  try {
    return { ...createEmptyProfile(), ...JSON.parse(value) } as Profile;
  } catch {
    return createEmptyProfile();
  }
}

function sanitizeProfile(input: Profile) {
  if (!input || typeof input !== 'object') throw new ApiError(400, '个人资料格式无效。');
  const profile = createEmptyProfile();
  const mutable = profile as unknown as Record<string, unknown>;
  const source = input as unknown as Record<string, unknown>;
  for (const key of Object.keys(profile)) {
    if (key === 'idFileNames' || key === 'bankFileNames') continue;
    if (typeof source[key] === 'string' && source[key].length > PROFILE_TEXT_MAX_LENGTH) {
      throw new ApiError(400, `个人资料中的文本每项不能超过 ${PROFILE_TEXT_MAX_LENGTH} 个字符。`);
    }
    mutable[key] = cleanString(source[key], PROFILE_TEXT_MAX_LENGTH);
  }
  profile.gender = ['', '男', '女', '其他'].includes(profile.gender) ? profile.gender : '';
  profile.idType = ['', 'residence', 'china-id', 'passport'].includes(profile.idType) ? profile.idType : '';
  profile.activityPermission = ['', '有', '无'].includes(profile.activityPermission) ? profile.activityPermission : '';
  profile.dependents = ['', '有', '无'].includes(profile.dependents) ? profile.dependents : '';
  profile.bankType = ['', 'jp-bank', 'cn-bank', 'alipay'].includes(profile.bankType) ? profile.bankType : '';
  profile.payeeIsSelf = ['', '是', '否'].includes(profile.payeeIsSelf) ? profile.payeeIsSelf : '';
  if (Array.isArray(source.bankFileNames) && source.bankFileNames.length > 2) {
    throw new ApiError(400, '银行卡正反面最多上传 2 个附件。');
  }
  profile.idFileNames = cleanFileKeys(source.idFileNames, 2);
  profile.bankFileNames = cleanFileKeys(source.bankFileNames, 2);
  if (profile.birthday && !birthdayIsValid(profile.birthday)) {
    throw new ApiError(400, '生日必须是有效且不晚于今天的日期。');
  }
  if (profile.idExpiryDate && !dateIsValid(profile.idExpiryDate)) {
    throw new ApiError(400, '证件有效期限无效。');
  }
  return profile;
}

async function sanitizeSalaryRecord(
  db: D1Database,
  userId: string,
  input: SalaryRecord,
  existing: SalaryRecord | null,
) {
  const id = cleanStringStrict(input.id, 120, '工资记录编号');
  if (!/^salary-[a-zA-Z0-9-]{8,110}$/.test(id)) throw new ApiError(400, '工资记录编号无效。');
  const workDate = cleanStringStrict(input.workDate, 10, '工作日期');
  if (!dateIsValid(workDate)) {
    throw new ApiError(400, '工作日期无效。');
  }
  const departmentKey = cleanStringStrict(input.departmentKey, 120, '工作所属部门');
  const department = await db.prepare(`SELECT id, label FROM payroll_departments
    WHERE id = ? AND active = 1`).bind(departmentKey).first<{ id: string; label: string }>();
  const applyType = Number(input.applyType) as SalaryRecord['applyType'];
  if (!department || ![1, 2, 3, 4, 5, 6, 7].includes(applyType)) throw new ApiError(400, '部门或计费方式无效。');
  const currency = sanitizeCurrency(input.currency);
  const workManager = await resolveWorkManager(db, input.checkUserId, input.checkUser);
  if (!workManager) throw new ApiError(400, '工作负责人无效或已停用。');
  const attachments = cleanFileKeys(input.attachments, 8);
  await assertOwnedFiles(db, userId, attachments);
  const now = existing ? nextVersionTimestamp(existing.updatedAt) : new Date().toISOString();
  const record = recalculateRecord({
    id,
    userId,
    workDate,
    checkUserId: workManager.id,
    checkUser: workManager.label,
    departmentKey: department.id,
    departmentLabel: department.label,
    currency,
    applyType,
    workContent: cleanStringStrict(input.workContent, SALARY_TEXT_MAX_LENGTH, '工作内容'),
    memo: cleanStringStrict(input.memo, SALARY_TEXT_MAX_LENGTH, '备注'),
    rate: boundedNumber(input.rate, 0, 10_000_000),
    startTime: cleanStringStrict(input.startTime, 5, '开始时间'),
    endTime: cleanStringStrict(input.endTime, 5, '结束时间'),
    amount: boundedNumber(input.amount, 0, 10_000_000),
    travelStart: cleanStringStrict(input.travelStart, 300, '交通出发地'),
    travelEnd: cleanStringStrict(input.travelEnd, 300, '交通到达地'),
    travelFee: boundedNumber(input.travelFee, 0, 10_000_000),
    totalHours: 0,
    workHours: 0,
    restHours: boundedNumber(input.restHours, 0, 24),
    finalSalary: 0,
    attachments,
    status: 1,
    checkDate: null,
    auditMemo: '',
    createdByUserId: existing?.createdByUserId ?? userId,
    createdByName: existing?.createdByName ?? '',
    submittedByUserId: existing?.submittedByUserId ?? '',
    submittedByName: existing?.submittedByName ?? '',
    source: existing?.source ?? 'self',
    batchId: existing?.batchId ?? null,
    recurringRuleId: existing?.recurringRuleId ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  if ((applyType === 1 || applyType === 7) && Math.round(record.restHours * 60) > getWorkMinutes(record.startTime, record.endTime)) {
    throw new ApiError(400, '中间休息时间不能超过开始至结束的总时长。');
  }
  if ((applyType === 1 || applyType === 7) && record.totalHours <= 0) {
    throw new ApiError(400, '开始和结束时间无效。');
  }
  if (applyType === 7 && !record.workContent) throw new ApiError(400, '“其他”计费方式必须填写工作内容。');
  if (department.id === 'dept-special' && !record.workContent && !record.memo) {
    throw new ApiError(400, '“特殊（具体备注）”必须填写具体工作内容或备注。');
  }
  if (record.finalSalary > 100_000_000) throw new ApiError(400, '工资金额超出允许范围。');
  return record;
}

function recordFromRow(row: Pick<RecordRow, 'data_json' | 'currency'>) {
  const record = parseRecord(row.data_json, row.currency);
  if (!record) throw new ApiError(500, '工资记录格式错误。');
  return record;
}

function parseRecord(value: string, rowCurrency?: string) {
  try {
    const parsed = JSON.parse(value) as Partial<SalaryRecord>;
    if (!parsed || typeof parsed !== 'object') return null;
    const currency = sanitizeCurrencyLenient(parsed.currency ?? rowCurrency);
    const restHours = Number.isFinite(Number(parsed.restHours)) ? Number(parsed.restHours) : 0;
    const workHours = Number.isFinite(Number(parsed.workHours)) ? Number(parsed.workHours) : 0;
    return {
      ...parsed,
      currency,
      checkUserId: typeof parsed.checkUserId === 'string' ? parsed.checkUserId : '',
      totalHours: Number.isFinite(Number(parsed.totalHours)) ? Number(parsed.totalHours) : workHours + restHours,
      workHours,
      restHours,
      departmentLabel: getDepartmentLabel(parsed.departmentKey ?? '', parsed.departmentLabel),
      attachments: Array.isArray(parsed.attachments) ? parsed.attachments : [],
      createdByUserId: typeof parsed.createdByUserId === 'string' ? parsed.createdByUserId : parsed.userId ?? '',
      createdByName: typeof parsed.createdByName === 'string' ? parsed.createdByName : '',
      submittedByUserId: typeof parsed.submittedByUserId === 'string' ? parsed.submittedByUserId : '',
      submittedByName: typeof parsed.submittedByName === 'string' ? parsed.submittedByName : '',
      source: ['self', 'proxy-single', 'proxy-batch', 'recurring', 'gray-seed'].includes(String(parsed.source))
        ? parsed.source
        : 'self',
      batchId: typeof parsed.batchId === 'string' ? parsed.batchId : null,
      recurringRuleId: typeof parsed.recurringRuleId === 'string' ? parsed.recurringRuleId : null,
    } as SalaryRecord;
  } catch {
    return null;
  }
}

async function assertOwnedFiles(db: D1Database, userId: string, keys: string[]) {
  for (const key of keys) {
    const file = await db.prepare('SELECT user_id FROM payroll_files WHERE key = ?').bind(key).first<{ user_id: string }>();
    if (!file || file.user_id !== userId) throw new ApiError(400, '附件不存在或不属于当前账号。');
  }
}

async function canReadFile(db: D1Database, actor: SessionActor, file: FileRow) {
  void db;
  return actor.userId === file.user_id || actor.role === 'admin' || actor.role === 'reviewer';
}

function validatedFileReferenceInsertStatement(
  db: D1Database,
  ownerUserId: string,
  referenceType: 'profile_id' | 'profile_bank' | 'salary',
  referenceId: string,
  key: string,
  createdAt: string,
) {
  return db.prepare(`INSERT INTO payroll_file_references
    (file_key, owner_user_id, reference_type, reference_id, created_at)
    SELECT f.key, f.user_id, ?, ?, ?
    FROM payroll_files f WHERE f.key = ? AND f.user_id = ?
    UNION ALL
    SELECT NULL, ?, ?, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM payroll_files WHERE key = ? AND user_id = ?)`)
    .bind(referenceType, referenceId, createdAt, key, ownerUserId,
      ownerUserId, referenceType, referenceId, createdAt, key, ownerUserId);
}

function conditionalSalaryFileReferenceStatements(
  db: D1Database,
  ownerUserId: string,
  referenceId: string,
  keys: string[],
  mutationAuditId: string,
) {
  const guardSql = 'EXISTS (SELECT 1 FROM payroll_audit_logs WHERE id = ?)';
  const statements: D1PreparedStatement[] = [
    db.prepare(`DELETE FROM payroll_file_references
      WHERE reference_type = 'salary' AND reference_id = ? AND ${guardSql}`)
      .bind(referenceId, mutationAuditId),
  ];
  const now = new Date().toISOString();
  for (const key of keys) {
    statements.push(db.prepare(`INSERT INTO payroll_file_references
      (file_key, owner_user_id, reference_type, reference_id, created_at)
      SELECT f.key, f.user_id, 'salary', ?, ?
      FROM payroll_files f
      WHERE f.key = ? AND f.user_id = ? AND ${guardSql}
      UNION ALL
      SELECT NULL, ?, 'salary', ?, ?
      WHERE ${guardSql}
        AND NOT EXISTS (SELECT 1 FROM payroll_files WHERE key = ? AND user_id = ?)`)
      .bind(
        referenceId, now, key, ownerUserId,
        mutationAuditId,
        ownerUserId, referenceId, now,
        mutationAuditId,
        key, ownerUserId,
      ));
  }
  return statements;
}

function guardedSalaryDeleteStatements(
  db: D1Database,
  actorUserId: string,
  ownerUserId: string,
  record: SalaryRecord,
  action: 'salary.delete' | 'salary.proxy_delete',
) {
  const auditId = newId('audit');
  const now = new Date().toISOString();
  const detail = { subjectUserId: ownerUserId, businessMonth: record.workDate.slice(0, 7) };
  const { subjectUserId, businessMonth } = auditDimensions('salary_record', record.id, detail);
  return [
    db.prepare(`DELETE FROM payroll_salary_records
      WHERE id = ? AND user_id = ? AND status = 1 AND updated_at = ?
        AND EXISTS (SELECT 1 FROM payroll_users actor
          WHERE actor.id = ? AND actor.status = 'active'
            AND (? = 'salary.delete' OR actor.role IN ('reviewer', 'admin')))`)
      .bind(record.id, ownerUserId, record.updatedAt, actorUserId, action),
    db.prepare(`INSERT INTO payroll_audit_logs
      (id, actor_user_id, action, target_type, target_id, detail_json, subject_user_id, business_month, created_at)
      SELECT ?, ?, ?, 'salary_record', ?, ?, ?, ?, ? WHERE changes() = 1`)
      .bind(auditId, actorUserId, action, record.id, JSON.stringify(detail), subjectUserId, businessMonth, now),
    db.prepare(`DELETE FROM payroll_file_references
      WHERE reference_type = 'salary' AND reference_id = ?
        AND EXISTS (SELECT 1 FROM payroll_audit_logs WHERE id = ?)`)
      .bind(record.id, auditId),
  ];
}

async function registrationIsOpen(db: D1Database) {
  const setting = await db.prepare("SELECT value FROM payroll_settings WHERE key = 'registration_open'")
    .first<{ value: string }>();
  return setting?.value !== '0';
}

async function writeAudit(
  db: D1Database,
  actorUserId: string | null,
  action: string,
  targetType: string,
  targetId: string,
  detail: Record<string, unknown> = {},
) {
  await auditStatement(db, actorUserId, action, targetType, targetId, detail).run();
}

function auditStatement(
  db: D1Database,
  actorUserId: string | null,
  action: string,
  targetType: string,
  targetId: string,
  detail: Record<string, unknown> = {},
  createdAt = new Date().toISOString(),
) {
  const { subjectUserId, businessMonth } = auditDimensions(targetType, targetId, detail);
  return db.prepare(`INSERT INTO payroll_audit_logs
    (id, actor_user_id, action, target_type, target_id, detail_json, subject_user_id, business_month, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE (? IS NULL OR EXISTS (SELECT 1 FROM payroll_users WHERE id = ?))
      AND (? IS NULL OR EXISTS (SELECT 1 FROM payroll_users WHERE id = ?))`)
    .bind(newId('audit'), actorUserId, action, targetType, targetId, JSON.stringify(detail),
      subjectUserId, businessMonth, createdAt,
      actorUserId, actorUserId, subjectUserId, subjectUserId);
}

function changedSalaryAuditStatement(
  db: D1Database,
  auditId: string,
  actorUserId: string | null,
  action: string,
  targetId: string,
  detail: Record<string, unknown>,
  createdAt = new Date().toISOString(),
) {
  const { subjectUserId, businessMonth } = auditDimensions('salary_record', targetId, detail);
  return db.prepare(`INSERT INTO payroll_audit_logs
    (id, actor_user_id, action, target_type, target_id, detail_json, subject_user_id, business_month, created_at)
    SELECT ?, ?, ?, 'salary_record', ?, ?, ?, ?, ? WHERE changes() = 1`)
    .bind(auditId, actorUserId, action, targetId, JSON.stringify(detail), subjectUserId, businessMonth, createdAt);
}

function auditDimensions(targetType: string, targetId: string, detail: Record<string, unknown>) {
  const subjectUserId = typeof detail.subjectUserId === 'string'
    ? detail.subjectUserId
    : typeof detail.ownerUserId === 'string'
      ? detail.ownerUserId
      : targetType === 'user'
        ? targetId
        : null;
  const businessMonth = typeof detail.businessMonth === 'string' && monthIsValid(detail.businessMonth)
    ? detail.businessMonth
    : typeof detail.workDate === 'string' && dateIsValid(detail.workDate)
      ? detail.workDate.slice(0, 7)
      : typeof detail.month === 'string' && monthIsValid(detail.month)
        ? detail.month
        : null;
  return { subjectUserId, businessMonth };
}

async function queryAuditLogs(db: D1Database, limit: number) {
  const result = await db.prepare(`SELECT l.id, l.actor_user_id, u.email AS actor_email, u.profile_json AS actor_profile_json,
    l.action, l.target_type, l.target_id, l.detail_json, l.created_at
    FROM payroll_audit_logs l
    LEFT JOIN payroll_users u ON u.id = l.actor_user_id
    ORDER BY l.created_at DESC LIMIT ?`).bind(limit).all<AuditRow>();
  return result.results.map(toAuditLogItem);
}

async function queryAccountAuditLogs(db: D1Database, userId: string, month?: string) {
  const monthClause = month ? "AND (l.business_month = ? OR (l.business_month IS NULL AND l.created_at LIKE ?))" : '';
  const statement = db.prepare(`SELECT l.id, l.actor_user_id, u.email AS actor_email, u.profile_json AS actor_profile_json,
    l.action, l.target_type, l.target_id, l.detail_json, l.created_at
    FROM payroll_audit_logs l
    LEFT JOIN payroll_users u ON u.id = l.actor_user_id
    WHERE (
      l.subject_user_id = ?
      OR l.actor_user_id = ?
      OR (l.target_type = 'user' AND l.target_id = ?)
      OR (l.target_type = 'salary_record' AND EXISTS (
        SELECT 1 FROM payroll_salary_records r WHERE r.id = l.target_id AND r.user_id = ?
      ))
      OR (l.target_type = 'file' AND EXISTS (
        SELECT 1 FROM payroll_files f WHERE f.key = l.target_id AND f.user_id = ?
      ))
      OR l.detail_json LIKE ?
    ) ${monthClause}
    ORDER BY l.created_at DESC`);
  const bindings: Array<string> = [userId, userId, userId, userId, userId, `%${userId}%`];
  if (month) bindings.push(month, `${month}-%`);
  const result = await statement.bind(...bindings).all<AuditRow>();
  return result.results.map(toAuditLogItem);
}

async function listStaffEmployeesInternal(db: D1Database): Promise<EmployeeSummary[]> {
  const [usersResult, recordsResult] = await Promise.all([
    db.prepare('SELECT * FROM payroll_users ORDER BY created_at ASC').all<UserRow>(),
    db.prepare(`SELECT id, user_id, status, currency, data_json FROM payroll_salary_records
      ORDER BY work_date DESC, created_at DESC`).all<RecordRow>(),
  ]);
  const recordsByUser = new Map<string, SalaryRecord[]>();
  for (const row of recordsResult.results) {
    recordsByUser.set(row.user_id, [...(recordsByUser.get(row.user_id) ?? []), recordFromRow(row)]);
  }
  return usersResult.results.map((row) => {
    const records = recordsByUser.get(row.id) ?? [];
    const submitted = records.filter((record) => record.status !== 1);
    return {
      ...toManagedUser(row),
      recordCount: records.length,
      submittedAmounts: sumByCurrency(submitted),
      approvedAmounts: sumByCurrency(records.filter((record) => record.status === 3)),
    };
  });
}

async function activeWorkManagers(db: D1Database): Promise<WorkManagerOption[]> {
  const result = await db.prepare(`SELECT * FROM payroll_users
    WHERE work_manager = 1 AND status = 'active' ORDER BY created_at ASC`).all<UserRow>();
  return result.results.map((row) => {
    const profile = parseProfile(row.profile_json);
    return { id: row.id, label: profileDisplayName(profile, row.email), email: row.email };
  });
}

async function resolveWorkManager(db: D1Database, requestedId: unknown, legacyLabel: unknown) {
  const managers = await activeWorkManagers(db);
  const id = cleanStringStrict(requestedId, 120, '工作负责人');
  if (id) return managers.find((manager) => manager.id === id) ?? null;
  const label = cleanStringStrict(legacyLabel, 100, '工作负责人');
  return managers.find((manager) => manager.label === label || manager.email === label) ?? null;
}

function monthlySummaries(records: SalaryRecord[]) {
  const months = new Set(records.map((record) => record.workDate.slice(0, 7)).filter(Boolean));
  return [...months].sort((left, right) => right.localeCompare(left))
    .map((month) => summarizeRecords(records.filter((record) => record.workDate.startsWith(month)), month));
}

function summarizeRecords(records: SalaryRecord[], month: string): MonthlyPayrollSummary {
  const submitted = records.filter((record) => record.status !== 1);
  return {
    month,
    recordCount: records.length,
    submittedAmounts: sumByCurrency(submitted),
    pendingAmounts: sumByCurrency(records.filter((record) => record.status === 2)),
    approvedAmounts: sumByCurrency(records.filter((record) => record.status === 3)),
    rejectedAmounts: sumByCurrency(records.filter((record) => record.status === 4)),
  };
}

function sumByCurrency(records: SalaryRecord[]): CurrencyAmounts {
  return records.reduce((totals, record) => {
    totals[record.currency] += record.finalSalary;
    return totals;
  }, emptyCurrencyAmounts());
}

function toDepartmentOption(row: DepartmentRow): DepartmentOption {
  return {
    key: row.id,
    label: row.label,
    active: Boolean(row.active),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toStoredFileInfo(row: StaffFileRow): StoredFileInfo {
  return {
    key: row.key,
    name: row.original_name,
    contentType: row.content_type,
    size: row.size,
    createdAt: row.created_at,
    referenceTypes: row.reference_types?.split(',').filter(Boolean) ?? [],
  };
}

function toAuditLogItem(row: AuditRow): AuditLogItem {
  const actorProfile = row.actor_profile_json ? parseProfile(row.actor_profile_json) : null;
  const actorDisplayName = actorProfile ? profileDisplayName(actorProfile, '') || null : null;
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    actorEmail: row.actor_email,
    actorDisplayName,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    detail: parseJsonObject(row.detail_json),
    createdAt: row.created_at,
  };
}

function requireMonth(value: unknown) {
  const month = cleanStringStrict(value, 7, '月份');
  if (!monthIsValid(month)) throw new ApiError(400, '月份格式无效。');
  return month;
}

async function requireTargetUser(db: D1Database, userId: string, requireActive: boolean) {
  const target = await db.prepare('SELECT * FROM payroll_users WHERE id = ?').bind(userId).first<UserRow>();
  if (!target) throw new ApiError(404, '未找到申报对象。');
  if (requireActive && toStatus(target.status) !== 'active') throw new ApiError(409, '该账号已停用，不能新增工资。');
  return target;
}

function requireSubmittableProfile(user: UserRow) {
  const error = profileSubmissionError(parseProfile(user.profile_json));
  if (error) throw new ApiError(400, `该员工${error}`);
}

async function actorDisplayName(db: D1Database, actor: SessionActor) {
  const row = await db.prepare('SELECT profile_json FROM payroll_users WHERE id = ?')
    .bind(actor.userId).first<{ profile_json: string }>();
  return row ? profileDisplayName(parseProfile(row.profile_json), actor.email) : actor.email;
}

async function salaryRecordForOwner(db: D1Database, userId: string, id: string) {
  const row = await db.prepare(`SELECT id, user_id, status, currency, data_json
    FROM payroll_salary_records WHERE id = ? AND user_id = ?`).bind(id, userId).first<RecordRow>();
  if (!row) throw new ApiError(404, '未找到工资记录。');
  return recordFromRow(row);
}

async function replaySalaryBatch(
  db: D1Database,
  actor: SessionActor,
  targetUserId: string,
  requestId: string,
  payloadHash: string,
) {
  const row = await db.prepare(`SELECT actor_user_id, target_user_id, payload_hash, record_ids_json
    FROM payroll_salary_batches WHERE request_id = ?`).bind(requestId).first<{
      actor_user_id: string;
      target_user_id: string;
      payload_hash: string;
      record_ids_json: string;
    }>();
  if (!row) return null;
  if (row.actor_user_id !== actor.userId || row.target_user_id !== targetUserId) {
    throw new ApiError(409, '批次请求编号已被其他操作使用。');
  }
  if (!row.payload_hash || row.payload_hash !== payloadHash) {
    throw new ApiError(409, '批次内容已经变更，请使用新的批次请求编号。');
  }
  const ids = parseStringArray(row.record_ids_json);
  if (ids.length === 0) return [];
  const result = await db.prepare(`SELECT records.id, records.user_id, records.status, records.currency, records.data_json
    FROM payroll_salary_records records
    JOIN json_each(?) requested ON records.id = CAST(requested.value AS TEXT)
    WHERE records.user_id = ?`)
    .bind(JSON.stringify(ids), targetUserId)
    .all<RecordRow>();
  const byId = new Map(result.results.map((record) => [record.id, recordFromRow(record)]));
  if (byId.size !== ids.length) throw new ApiError(409, '该批次的部分工资记录已被删除。');
  return ids.map((id) => byId.get(id)!);
}

function salaryRecordsInsertStatement(
  db: D1Database,
  records: SalaryRecord[],
  claim?: { ruleId: string; month: string; recordIdsJson: string; createdAt: string },
  actorUserId?: string,
) {
  const rows = records.map((record) => ({
    id: record.id,
    userId: record.userId,
    status: record.status,
    workDate: record.workDate,
    finalSalary: record.finalSalary,
    currency: record.currency,
    dataJson: JSON.stringify(record),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }));
  const claimGuard = claim ? `AND EXISTS (
    SELECT 1 FROM payroll_recurring_instances instance
    WHERE instance.rule_id = ? AND instance.month = ?
      AND instance.record_ids_json = ? AND instance.created_at = ?
  )` : '';
  const actorGuard = actorUserId
    ? "AND EXISTS (SELECT 1 FROM payroll_users actor WHERE actor.id = ? AND actor.status = 'active' AND actor.role IN ('reviewer', 'admin'))"
    : '';
  const statement = db.prepare(`INSERT INTO payroll_salary_records
    (id, user_id, status, work_date, final_salary, currency, data_json, created_at, updated_at)
    SELECT json_extract(value, '$.id'), json_extract(value, '$.userId'),
      CAST(json_extract(value, '$.status') AS INTEGER), json_extract(value, '$.workDate'),
      CAST(json_extract(value, '$.finalSalary') AS REAL), json_extract(value, '$.currency'),
      json_extract(value, '$.dataJson'), json_extract(value, '$.createdAt'), json_extract(value, '$.updatedAt')
    FROM json_each(?)
    WHERE EXISTS (
      SELECT 1 FROM payroll_users owner
      WHERE owner.id = json_extract(value, '$.userId') AND owner.status = 'active'
    ) ${actorGuard} ${claimGuard}`);
  const bindings = [JSON.stringify(rows)];
  if (actorUserId) bindings.push(actorUserId);
  if (claim) bindings.push(claim.ruleId, claim.month, claim.recordIdsJson, claim.createdAt);
  return statement.bind(...bindings);
}

function validateScheduledSession(session: PayrollScheduleSession, applyType: number) {
  if (applyType !== 1 && applyType !== 7) return;
  const totalMinutes = getWorkMinutes(session.startTime, session.endTime);
  if (totalMinutes <= 0) throw new ApiError(400, '开始和结束时间无效。');
  if (Math.round(session.restHours * 60) > totalMinutes) {
    throw new ApiError(400, '中间休息时间不能超过开始至结束的总时长。');
  }
}

function assertCalculatedSalaryRecord(record: SalaryRecord) {
  validateScheduledSession(record, record.applyType);
  if (record.finalSalary > 100_000_000) throw new ApiError(400, '工资金额超出允许范围。');
}

function sanitizeBatchSchedule(input: ProxyPayrollBatchInput, month: string): {
  sessions: PayrollScheduleSession[];
  fixedSchedule: FixedPayrollSchedule | null;
} {
  if (input.mode === 'fixed') {
    const source = input.fixedSchedule;
    if (!source || typeof source !== 'object') throw new ApiError(400, '请设置固定排课时间。');
    const range = monthDateRange(month)!;
    const fixedSchedule: FixedPayrollSchedule = {
      rangeStart: cleanStringStrict(source.rangeStart, 10, '开始日期'),
      rangeEnd: cleanStringStrict(source.rangeEnd, 10, '结束日期'),
      startsAtMonthStart: source.rangeStart === range.start,
      endsAtMonthEnd: source.rangeEnd === range.end,
      weekdays: Array.isArray(source.weekdays)
        ? [...new Set(source.weekdays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
        : [],
      startTime: cleanStringStrict(source.startTime, 5, '开始时间'),
      endTime: cleanStringStrict(source.endTime, 5, '结束时间'),
      restHours: boundedNumber(source.restHours, 0, 24),
    };
    if (!dateIsValid(fixedSchedule.rangeStart) || !dateIsValid(fixedSchedule.rangeEnd)
      || !fixedSchedule.rangeStart.startsWith(month) || !fixedSchedule.rangeEnd.startsWith(month)
      || fixedSchedule.rangeStart > fixedSchedule.rangeEnd) {
      throw new ApiError(400, '固定排课日期必须在所选月份内。');
    }
    if (fixedSchedule.weekdays.length === 0) throw new ApiError(400, '请至少选择一个星期。');
    const sessions = expandFixedPayrollSchedule(month, fixedSchedule);
    if (sessions.length === 0) throw new ApiError(400, '选定范围内没有可生成的日期。');
    if (sessions.length > MAX_BATCH_RECORDS) throw new ApiError(400, `每个批次最多生成 ${MAX_BATCH_RECORDS} 条记录。`);
    sessions.forEach((session) => validateScheduledSession(session, Number(input.template?.applyType)));
    return { sessions, fixedSchedule };
  }
  if (input.mode !== 'calendar') throw new ApiError(400, '多条申报方式无效。');
  if (!Array.isArray(input.calendarSessions) || input.calendarSessions.length === 0) {
    throw new ApiError(400, '请至少添加一个日历时段。');
  }
  if (input.calendarSessions.length > MAX_BATCH_RECORDS) throw new ApiError(400, `每个批次最多生成 ${MAX_BATCH_RECORDS} 条记录。`);
  const seen = new Set<string>();
  const sessions = input.calendarSessions.map((source) => {
    if (!source || typeof source !== 'object') throw new ApiError(400, '日历时段格式无效。');
    const session = {
      workDate: cleanStringStrict(source.workDate, 10, '工作日期'),
      startTime: cleanStringStrict(source.startTime, 5, '开始时间'),
      endTime: cleanStringStrict(source.endTime, 5, '结束时间'),
      restHours: boundedNumber(source.restHours, 0, 24),
    };
    if (!dateIsValid(session.workDate) || !session.workDate.startsWith(month)) {
      throw new ApiError(400, '日历时段必须在所选月份内。');
    }
    const key = `${session.workDate}|${session.startTime}|${session.endTime}`;
    if (seen.has(key)) throw new ApiError(400, '日历时段中存在重复记录。');
    seen.add(key);
    validateScheduledSession(session, Number(input.template?.applyType));
    return session;
  }).sort((left, right) => `${left.workDate}${left.startTime}`.localeCompare(`${right.workDate}${right.startTime}`));
  return { sessions, fixedSchedule: null };
}

function sanitizeRecurringRequest(input: ProxyPayrollBatchInput, month: string) {
  if (!input.recurring?.enabled) return null;
  if (input.mode !== 'fixed') throw new ApiError(400, '自动规律只能从固定排课创建。');
  const title = cleanStringStrict(input.recurring.title, 100, '规律名称');
  if (!title) throw new ApiError(400, '请填写规律名称。');
  const startMonth = requireMonth(input.recurring.startMonth || month);
  if (startMonth !== month) throw new ApiError(400, '规律的生效月份必须与本次生成月份一致。');
  const endMonth = cleanStringStrict(input.recurring.endMonth, 7, '结束月份');
  if (endMonth && (!monthIsValid(endMonth) || endMonth < startMonth)) throw new ApiError(400, '结束月份无效。');
  return { title, startMonth, endMonth };
}

function scheduleForMonth(schedule: FixedPayrollSchedule, month: string): FixedPayrollSchedule {
  const range = monthDateRange(month)!;
  const startDay = schedule.startsAtMonthStart ? 1 : Math.min(Number(schedule.rangeStart.slice(8, 10)) || 1, range.lastDay);
  const endDay = schedule.endsAtMonthEnd ? range.lastDay : Math.min(Number(schedule.rangeEnd.slice(8, 10)) || range.lastDay, range.lastDay);
  return {
    ...schedule,
    rangeStart: `${month}-${String(startDay).padStart(2, '0')}`,
    rangeEnd: `${month}-${String(Math.max(startDay, endDay)).padStart(2, '0')}`,
  };
}

function parseFixedSchedule(value: string) {
  const parsed = parseJsonObject(value) as Partial<FixedPayrollSchedule>;
  return {
    rangeStart: typeof parsed.rangeStart === 'string' ? parsed.rangeStart : '',
    rangeEnd: typeof parsed.rangeEnd === 'string' ? parsed.rangeEnd : '',
    startsAtMonthStart: Boolean(parsed.startsAtMonthStart),
    endsAtMonthEnd: Boolean(parsed.endsAtMonthEnd),
    weekdays: Array.isArray(parsed.weekdays) ? parsed.weekdays.map(Number).filter(Number.isInteger) : [],
    startTime: typeof parsed.startTime === 'string' ? parsed.startTime : '',
    endTime: typeof parsed.endTime === 'string' ? parsed.endTime : '',
    restHours: Number.isFinite(Number(parsed.restHours)) ? Number(parsed.restHours) : 0,
  } satisfies FixedPayrollSchedule;
}

function toRecurringPayrollRule(row: RecurringRuleRow): RecurringPayrollRule {
  const template = parseRecord(row.template_json);
  if (!template) throw new ApiError(500, '规律模板格式错误。');
  const creatorProfile = row.creator_profile_json ? parseProfile(row.creator_profile_json) : null;
  return {
    id: row.id,
    userId: row.user_id,
    userDisplayName: profileDisplayName(parseProfile(row.user_profile_json), row.user_email),
    userEmail: row.user_email,
    title: row.title,
    active: Boolean(row.active),
    submit: Boolean(row.submit_on_generate),
    startMonth: row.start_month,
    endMonth: row.end_month,
    template,
    schedule: parseFixedSchedule(row.schedule_json),
    createdByUserId: row.created_by_user_id,
    createdByName: creatorProfile ? profileDisplayName(creatorProfile, row.creator_email ?? '系统') : row.creator_email ?? '系统',
    lastRunAt: row.last_run_at,
    lastRunStatus: row.last_run_status === 'success' || row.last_run_status === 'error' ? row.last_run_status : null,
    lastRunMessage: row.last_run_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function recurringRuleRow(db: D1Database, id: string) {
  const row = await recurringRuleRowOrNull(db, id);
  if (!row) throw new ApiError(404, '未找到自动规律。');
  return row;
}

async function recurringRuleRowOrNull(db: D1Database, id: string) {
  return db.prepare(`SELECT r.*, u.email AS user_email, u.profile_json AS user_profile_json,
    c.email AS creator_email, c.profile_json AS creator_profile_json
    FROM payroll_recurring_rules r JOIN payroll_users u ON u.id = r.user_id
    LEFT JOIN payroll_users c ON c.id = r.created_by_user_id
    WHERE r.id = ? AND r.deleted_at IS NULL`).bind(id).first<RecurringRuleRow>();
}

async function optionalRecurringPayrollRule(db: D1Database, id: string) {
  const row = await recurringRuleRowOrNull(db, id);
  return row ? toRecurringPayrollRule(row) : null;
}

function tokyoMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return requireMonth(`${year}-${month}`);
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function requireRole(actor: SessionActor, roles: AccountRole[]) {
  if (!roles.includes(actor.role)) throw new ApiError(403, '账号角色没有执行该操作的权限。');
}

function normalizeEmail(email: string) {
  return String(email ?? '').trim().toLowerCase();
}

function validateEmail(email: string) {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) {
    throw new ApiError(400, '请输入有效邮箱。');
  }
  return normalized;
}

function validateCredentialDigest(value: string, login = false) {
  if (!/^[a-f0-9]{64}$/i.test(value ?? '')) {
    throw new ApiError(login ? 401 : 400, login ? '邮箱或密码错误。' : '密码格式无效。');
  }
}

async function hashCredential(credentialDigest: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveCredential(credentialDigest, salt, PASSWORD_ITERATIONS);
  return `pbkdf2$${PASSWORD_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

async function sessionTokenHash(token: string) {
  return sha256Hex(token);
}

async function sha256Hex(value: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashJson(value: unknown) {
  return sha256Hex(JSON.stringify(canonicalJsonValue(value)));
}

async function hashProxyPayrollBatchInput(input: ProxyPayrollBatchInput) {
  const template = input?.template ?? {} as SalaryRecord;
  const manager = normalizedHashString(template.checkUserId)
    ? { checkUserId: normalizedHashString(template.checkUserId) }
    : { checkUser: normalizedHashString(template.checkUser) };
  const templateFingerprint = {
    ...manager,
    departmentKey: normalizedHashString(template.departmentKey),
    currency: normalizedHashString(template.currency),
    applyType: normalizedHashNumber(template.applyType),
    workContent: normalizedHashString(template.workContent),
    memo: normalizedHashString(template.memo),
    rate: normalizedHashNumber(template.rate),
    amount: normalizedHashNumber(template.amount),
    travelStart: normalizedHashString(template.travelStart),
    travelEnd: normalizedHashString(template.travelEnd),
    travelFee: normalizedHashNumber(template.travelFee),
    attachments: Array.isArray(template.attachments)
      ? template.attachments.map(normalizedHashString).filter(Boolean).sort()
      : [],
  };
  const schedule = input.mode === 'fixed'
    ? {
      rangeStart: normalizedHashString(input.fixedSchedule?.rangeStart),
      rangeEnd: normalizedHashString(input.fixedSchedule?.rangeEnd),
      weekdays: Array.isArray(input.fixedSchedule?.weekdays)
        ? [...new Set(input.fixedSchedule.weekdays.map(normalizedHashNumber)
          .filter((day): day is number => day !== null))].sort((left, right) => left - right)
        : [],
      startTime: normalizedHashString(input.fixedSchedule?.startTime),
      endTime: normalizedHashString(input.fixedSchedule?.endTime),
      restHours: normalizedHashNumber(input.fixedSchedule?.restHours),
    }
    : Array.isArray(input.calendarSessions)
      ? input.calendarSessions.map((session) => ({
        workDate: normalizedHashString(session?.workDate),
        startTime: normalizedHashString(session?.startTime),
        endTime: normalizedHashString(session?.endTime),
        restHours: normalizedHashNumber(session?.restHours),
      })).sort((left, right) => `${left.workDate}|${left.startTime}|${left.endTime}`
        .localeCompare(`${right.workDate}|${right.startTime}|${right.endTime}`))
      : [];
  const recurring = input.recurring?.enabled
    ? {
      enabled: true,
      title: normalizedHashString(input.recurring.title),
      startMonth: normalizedHashString(input.recurring.startMonth),
      endMonth: normalizedHashString(input.recurring.endMonth),
    }
    : { enabled: false };
  return hashJson({
    targetUserId: normalizedHashString(input.targetUserId),
    month: normalizedHashString(input.month),
    mode: input.mode,
    submit: Boolean(input.submit),
    template: templateFingerprint,
    schedule,
    recurring,
  });
}

function normalizedHashString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizedHashNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalJsonValue(item)]));
  }
  return value;
}

async function verifyCredential(credentialDigest: string, stored: string) {
  if (!stored.startsWith('pbkdf2$')) return safeEqual(credentialDigest, stored);
  const [, iterationText, saltText, expectedText] = stored.split('$');
  const iterations = Number(iterationText);
  if (!iterations || !saltText || !expectedText) return false;
  try {
    const actual = await deriveCredential(credentialDigest, base64ToBytes(saltText), iterations);
    return safeEqual(bytesToBase64(actual), expectedText);
  } catch {
    return false;
  }
}

async function deriveCredential(credentialDigest: string, salt: Uint8Array, iterations: number) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(credentialDigest),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: Uint8Array.from(salt).buffer, iterations },
    material,
    256,
  );
  return new Uint8Array(bits);
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function cleanString(value: unknown, maximumLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maximumLength) : '';
}

function cleanStringStrict(value: unknown, maximumLength: number, label: string) {
  if (typeof value !== 'string') return '';
  if (value.length > maximumLength) {
    throw new ApiError(400, `${label}不能超过 ${maximumLength} 个字符。`);
  }
  return value.trim();
}

function nextVersionTimestamp(previous: string) {
  const previousTime = Date.parse(previous);
  return new Date(Number.isFinite(previousTime) ? Math.max(Date.now(), previousTime + 1) : Date.now()).toISOString();
}

function cleanFileKeys(value: unknown, maximum: number) {
  if (!Array.isArray(value)) return [];
  const keys = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => /^payroll\/[a-zA-Z0-9._/-]+$/.test(item));
  return [...new Set(keys)].slice(0, maximum);
}

function boundedNumber(value: unknown, minimum: number, maximum: number) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new ApiError(400, '数值字段超出允许范围。');
  }
  return number;
}

function sanitizeCurrency(value: unknown): CurrencyCode {
  if (value !== 'JPY' && value !== 'CNY') throw new ApiError(400, '货币必须选择日元或人民币。');
  return value;
}

function sanitizeCurrencyLenient(value: unknown): CurrencyCode {
  return value === 'CNY' ? 'CNY' : 'JPY';
}

function isRole(value: unknown): value is AccountRole {
  return value === 'employee' || value === 'reviewer' || value === 'admin';
}

function toRole(value: string): AccountRole {
  return isRole(value) ? value : 'employee';
}

function isStatus(value: unknown): value is AccountStatus {
  return value === 'active' || value === 'disabled';
}

function toStatus(value: string): AccountStatus {
  return isStatus(value) ? value : 'active';
}

function profileDisplayName(profile: Profile, fallback: string) {
  return `${profile.lastNameCn}${profile.firstNameCn}`.trim() || fallback;
}

function profileSubmissionError(profile: Profile) {
  const missing = profileMissingRequirements(profile);
  return missing.length > 0 ? `请先补全：${missing.join('、')}。` : null;
}

function profileBasicsError(profile: Profile) {
  if (!profile.lastNameCn.trim() || !profile.firstNameCn.trim()) return '请填写中文姓和中文名。';
  if (!profile.address.trim()) return '请填写现住址。';
  if (!profile.tel.trim()) return '请填写联系方式。';
  return null;
}

function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function newId(prefix: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return `${prefix}-${Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
