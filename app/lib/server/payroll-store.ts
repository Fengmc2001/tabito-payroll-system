import { env } from 'cloudflare:workers';
import {
  AccountRole,
  AccountStatus,
  AuditLogItem,
  AuditOverview,
  BOOTSTRAP_ADMIN_EMAIL,
  CHECK_USERS,
  CurrencyAmounts,
  CurrencyCode,
  DEFAULT_DEPARTMENTS,
  DepartmentOption,
  EmployeeDetail,
  EmployeeSummary,
  ManagedUser,
  MonthlyPayrollSummary,
  Profile,
  ReviewSalaryItem,
  SalaryRecord,
  SalaryStatus,
  StoredAccount,
  StoredFileInfo,
  createEmptyProfile,
  emptyCurrencyAmounts,
  getDepartmentLabel,
  profileBasicsAreReady,
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
  action: string;
  target_type: string;
  target_id: string;
  detail_json: string;
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
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS payroll_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_digest TEXT NOT NULL,
      profile_json TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'employee',
      status TEXT NOT NULL DEFAULT 'active',
      last_login_at TEXT,
      failed_login_count INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS payroll_sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS payroll_salary_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      status INTEGER NOT NULL,
      work_date TEXT NOT NULL,
      final_salary INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'JPY',
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS payroll_files (
      key TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      original_name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS payroll_file_references (
      file_key TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      reference_type TEXT NOT NULL,
      reference_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (file_key, reference_type, reference_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS payroll_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_by TEXT,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS payroll_audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS payroll_departments (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`),
  ]);

  await ensureUserColumns(db);
  await ensureSalaryColumns(db);

  await db.batch([
    db.prepare('DROP INDEX IF EXISTS payroll_salary_records_user_idx'),
    db.prepare('DROP INDEX IF EXISTS idx_payroll_salary_user_date'),
    db.prepare('DROP INDEX IF EXISTS idx_payroll_salary_status_date'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_payroll_users_role_status ON payroll_users (role, status)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_payroll_sessions_user ON payroll_sessions (user_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_payroll_sessions_expires ON payroll_sessions (expires_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_payroll_salary_user_date_created ON payroll_salary_records (user_id, work_date DESC, created_at DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_payroll_salary_status_date_updated ON payroll_salary_records (status ASC, work_date DESC, updated_at DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_payroll_salary_currency_status_date ON payroll_salary_records (currency, status, work_date DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_payroll_files_user ON payroll_files (user_id, created_at DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_payroll_file_refs_file ON payroll_file_references (file_key, reference_type)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_payroll_file_refs_reference ON payroll_file_references (reference_type, reference_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_payroll_audit_created ON payroll_audit_logs (created_at DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_payroll_audit_actor ON payroll_audit_logs (actor_user_id, created_at DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_payroll_departments_active_sort ON payroll_departments (active DESC, sort_order ASC)'),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_departments_active_label ON payroll_departments (label) WHERE active = 1'),
    db.prepare("UPDATE payroll_users SET role = 'employee' WHERE role NOT IN ('employee', 'reviewer', 'admin')"),
    db.prepare("UPDATE payroll_users SET status = 'active' WHERE status NOT IN ('active', 'disabled')"),
    db.prepare("INSERT OR IGNORE INTO payroll_settings (key, value, updated_by, updated_at) VALUES ('registration_open', '1', NULL, ?)")
      .bind(new Date().toISOString()),
  ]);

  const departmentSeedTime = new Date().toISOString();
  await db.batch(DEFAULT_DEPARTMENTS.map((department, index) => db.prepare(`INSERT OR IGNORE INTO payroll_departments
    (id, label, active, sort_order, created_at, updated_at, deleted_at) VALUES (?, ?, 1, ?, ?, ?, NULL)`)
    .bind(department.key, department.label, index, departmentSeedTime, departmentSeedTime)));

  const adminCount = await db.prepare("SELECT COUNT(*) AS count FROM payroll_users WHERE role = 'admin'")
    .first<{ count: number }>();
  if (Number(adminCount?.count ?? 0) === 0) {
    await db.prepare(`UPDATE payroll_users SET role = 'admin', updated_at = ?
      WHERE id = (SELECT id FROM payroll_users ORDER BY created_at ASC LIMIT 1)`)
      .bind(new Date().toISOString())
      .run();
  }

  const referenceBackfill = await db.prepare("SELECT value FROM payroll_settings WHERE key = 'file_references_backfilled_v1'")
    .first<{ value: string }>();
  if (referenceBackfill?.value !== '1') {
    await backfillFileReferences(db);
    await db.prepare(`INSERT INTO payroll_settings (key, value, updated_by, updated_at)
      VALUES ('file_references_backfilled_v1', '1', NULL, ?)
      ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = excluded.updated_at`)
      .bind(new Date().toISOString())
      .run();
  }

  // Older preview builds stored raw bearer tokens. Once hashed-token sessions
  // are enabled, invalidate those rows instead of keeping reusable credentials.
  await db.prepare('DELETE FROM payroll_sessions WHERE length(token) <> 64 OR expires_at <= ?').bind(Date.now()).run();
  await db.prepare('PRAGMA optimize').run();
}

async function ensureSalaryColumns(db: D1Database) {
  const result = await db.prepare('PRAGMA table_info(payroll_salary_records)').all<{ name: string }>();
  const existing = new Set(result.results.map((column) => column.name));
  if (!existing.has('currency')) {
    await db.prepare("ALTER TABLE payroll_salary_records ADD COLUMN currency TEXT NOT NULL DEFAULT 'JPY'").run();
  }
  await db.prepare("UPDATE payroll_salary_records SET currency = 'JPY' WHERE currency NOT IN ('JPY', 'CNY') OR currency IS NULL").run();
}

async function ensureUserColumns(db: D1Database) {
  const result = await db.prepare('PRAGMA table_info(payroll_users)').all<{ name: string }>();
  const existing = new Set(result.results.map((column) => column.name));
  const additions: Array<[string, string]> = [
    ['role', "TEXT NOT NULL DEFAULT 'employee'"],
    ['status', "TEXT NOT NULL DEFAULT 'active'"],
    ['last_login_at', 'TEXT'],
    ['failed_login_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['locked_until', 'INTEGER'],
  ];
  for (const [name, definition] of additions) {
    if (!existing.has(name)) {
      await db.prepare(`ALTER TABLE payroll_users ADD COLUMN ${name} ${definition}`).run();
    }
  }
}

export async function registerUser(email: string, passwordDigest: string) {
  validateCredentialDigest(passwordDigest);
  const db = await database();
  const count = await db.prepare('SELECT COUNT(*) AS count FROM payroll_users').first<{ count: number }>();
  const firstAccount = Number(count?.count ?? 0) === 0;
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
    await db.prepare(`INSERT INTO payroll_users (
      id, email, password_digest, profile_json, role, status, last_login_at,
      failed_login_count, locked_until, created_at, updated_at
    ) SELECT ?, ?, ?, ?,
      CASE WHEN EXISTS (SELECT 1 FROM payroll_users LIMIT 1) THEN 'employee' ELSE 'admin' END,
      'active', ?, 0, NULL, ?, ?`)
      .bind(id, normalized, passwordHash, JSON.stringify(profile), now, now, now)
      .run();
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
    const nextFailures = Number(user.failed_login_count ?? 0) + 1;
    const shouldLock = nextFailures >= LOGIN_FAILURE_LIMIT;
    await db.prepare('UPDATE payroll_users SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE id = ?')
      .bind(shouldLock ? 0 : nextFailures, shouldLock ? Date.now() + LOGIN_LOCK_MS : null, new Date().toISOString(), user.id)
      .run();
    await writeAudit(db, user.id, 'auth.login_failed', 'user', user.id, { locked: shouldLock });
    throw new ApiError(401, '邮箱或密码错误。');
  }

  const now = new Date().toISOString();
  const upgradedHash = user.password_digest.startsWith('pbkdf2$')
    ? user.password_digest
    : await hashCredential(passwordDigest);
  await db.prepare(`UPDATE payroll_users
    SET password_digest = ?, failed_login_count = 0, locked_until = NULL, last_login_at = ?, updated_at = ?
    WHERE id = ?`)
    .bind(upgradedHash, now, now, user.id)
    .run();
  await writeAudit(db, user.id, 'auth.login', 'user', user.id);
  const session = await issueSession(user.id);
  return { account: await getAccount(user.id), session };
}

export async function logoutSession(request: Request) {
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
  const result = await db.prepare('UPDATE payroll_users SET profile_json = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(profile), now, userId)
    .run();
  if (!result.meta.changes) throw new ApiError(404, '未找到用户。');
  await replaceFileReferences(db, userId, 'profile_id', userId, profile.idFileNames);
  await replaceFileReferences(db, userId, 'profile_bank', userId, profile.bankFileNames);
  await writeAudit(db, userId, 'profile.update', 'user', userId);
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
  await db.batch([
    db.prepare('UPDATE payroll_users SET password_digest = ?, failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?')
      .bind(await hashCredential(newPasswordDigest), new Date().toISOString(), actor.userId),
    db.prepare('DELETE FROM payroll_sessions WHERE user_id = ? AND token <> ?')
      .bind(actor.userId, await sessionTokenHash(actor.token)),
  ]);
  await writeAudit(db, actor.userId, 'account.password_change', 'user', actor.userId);
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
  const anyOwner = await db.prepare('SELECT id, user_id, status, currency, data_json FROM payroll_salary_records WHERE id = ?')
    .bind(input.id)
    .first<RecordRow>();
  if (anyOwner && anyOwner.user_id !== userId) throw new ApiError(403, '没有操作该工资记录的权限。');
  const existing = anyOwner ? recordFromRow(anyOwner) : null;
  if (existing && existing.status !== 1) throw new ApiError(409, '已提交的工资记录不可修改。');

  const record = await sanitizeSalaryRecord(db, userId, input, existing);
  const serialized = JSON.stringify(record);
  if (existing) {
    await db.prepare(`UPDATE payroll_salary_records
      SET status = 1, work_date = ?, final_salary = ?, currency = ?, data_json = ?, updated_at = ?
      WHERE id = ? AND user_id = ?`)
      .bind(record.workDate, record.finalSalary, record.currency, serialized, record.updatedAt, record.id, userId)
      .run();
    await writeAudit(db, userId, 'salary.update', 'salary_record', record.id);
  } else {
    await db.prepare(`INSERT INTO payroll_salary_records
      (id, user_id, status, work_date, final_salary, currency, data_json, created_at, updated_at)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`)
      .bind(record.id, userId, record.workDate, record.finalSalary, record.currency, serialized, record.createdAt, record.updatedAt)
      .run();
    await writeAudit(db, userId, 'salary.create', 'salary_record', record.id);
  }
  await replaceFileReferences(db, userId, 'salary', record.id, record.attachments);
  return record;
}

export async function deleteSalaryRecord(userId: string, id: string) {
  const db = await database();
  const existing = await getSalaryRecord(userId, id);
  if (existing.status !== 1) throw new ApiError(409, '仅未提交记录可以删除。');
  await db.prepare('DELETE FROM payroll_salary_records WHERE id = ? AND user_id = ?').bind(id, userId).run();
  await db.prepare("DELETE FROM payroll_file_references WHERE reference_type = 'salary' AND reference_id = ?").bind(id).run();
  await writeAudit(db, userId, 'salary.delete', 'salary_record', id);
}

export async function applySalaryRecords(userId: string) {
  const db = await database();
  const user = await getUserById(userId);
  if (!user) throw new ApiError(404, '未找到用户。');
  const profileError = profileSubmissionError(parseProfile(user.profile_json));
  if (profileError) throw new ApiError(400, profileError);
  const records = await listSalaryRecords(userId);
  const now = new Date().toISOString();
  const drafts = records
    .filter((record) => record.status === 1)
    .map((record) => ({ ...record, status: 2 as const, checkDate: null, auditMemo: '', updatedAt: now }));
  if (drafts.length === 0) throw new ApiError(400, '没有可提交的工资记录。');

  await db.batch(drafts.map((record) => db.prepare(`UPDATE payroll_salary_records
    SET status = 2, data_json = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = 1`)
    .bind(JSON.stringify(record), now, record.id, userId)));
  await writeAudit(db, userId, 'salary.submit', 'user', userId, { recordIds: drafts.map((record) => record.id) });
  return drafts;
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
  const memo = cleanString(auditMemo, 1000);
  if (decision === 'reject' && !memo) throw new ApiError(400, '驳回时必须填写审核备注。');
  const db = await database();
  const row = await db.prepare('SELECT id, user_id, status, currency, data_json FROM payroll_salary_records WHERE id = ?')
    .bind(id)
    .first<RecordRow>();
  if (!row) throw new ApiError(404, '未找到工资记录。');
  const existing = recordFromRow(row);
  if (existing.status !== 2) throw new ApiError(409, '只有待审核记录可以执行审核。');
  const now = new Date().toISOString();
  const status: SalaryStatus = decision === 'approve' ? 3 : 4;
  const record: SalaryRecord = { ...existing, status, checkDate: now, auditMemo: memo, updatedAt: now };
  const result = await db.prepare(`UPDATE payroll_salary_records
    SET status = ?, data_json = ?, updated_at = ? WHERE id = ? AND status = 2`)
    .bind(status, JSON.stringify(record), now, id)
    .run();
  if (!result.meta.changes) throw new ApiError(409, '该记录已被其他审核员处理，请刷新。');
  await writeAudit(db, actor.userId, `salary.${decision}`, 'salary_record', id, {
    ownerUserId: row.user_id,
    auditMemo: memo,
  });
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
  input: { role?: AccountRole; status?: AccountStatus; revokeSessions?: boolean },
) {
  requireRole(actor, ['admin']);
  const db = await database();
  const target = await getUserById(targetUserId);
  if (!target) throw new ApiError(404, '未找到用户。');
  const nextRole = input.role ?? toRole(target.role);
  const nextStatus = input.status ?? toStatus(target.status);
  if (!isRole(nextRole) || !isStatus(nextStatus)) throw new ApiError(400, '账号角色或状态无效。');
  if (actor.userId === targetUserId && nextStatus === 'disabled') {
    throw new ApiError(400, '管理员不能停用自己的账号。');
  }

  const removesActiveAdmin = toRole(target.role) === 'admin'
    && toStatus(target.status) === 'active'
    && (nextRole !== 'admin' || nextStatus !== 'active');
  if (removesActiveAdmin) {
    const otherAdmins = await db.prepare(`SELECT COUNT(*) AS count FROM payroll_users
      WHERE role = 'admin' AND status = 'active' AND id <> ?`)
      .bind(targetUserId)
      .first<{ count: number }>();
    if (Number(otherAdmins?.count ?? 0) === 0) throw new ApiError(409, '系统必须保留至少一个正常状态的管理员。');
  }

  const now = new Date().toISOString();
  await db.prepare('UPDATE payroll_users SET role = ?, status = ?, updated_at = ? WHERE id = ?')
    .bind(nextRole, nextStatus, now, targetUserId)
    .run();
  if (nextStatus === 'disabled' || input.revokeSessions) {
    await db.prepare('DELETE FROM payroll_sessions WHERE user_id = ?').bind(targetUserId).run();
  }
  await writeAudit(db, actor.userId, 'account.permission_update', 'user', targetUserId, {
    from: { role: toRole(target.role), status: toStatus(target.status) },
    to: { role: nextRole, status: nextStatus },
    sessionsRevoked: Boolean(input.revokeSessions || nextStatus === 'disabled'),
  });
  const updated = await getUserById(targetUserId);
  if (!updated) throw new ApiError(404, '未找到用户。');
  return toManagedUser(updated);
}

export async function adminResetPassword(actor: SessionActor, targetUserId: string, newPasswordDigest: string) {
  requireRole(actor, ['admin']);
  validateCredentialDigest(newPasswordDigest);
  const target = await getUserById(targetUserId);
  if (!target) throw new ApiError(404, '未找到用户。');
  const db = await database();
  await db.batch([
    db.prepare(`UPDATE payroll_users
      SET password_digest = ?, failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?`)
      .bind(await hashCredential(newPasswordDigest), new Date().toISOString(), targetUserId),
    db.prepare('DELETE FROM payroll_sessions WHERE user_id = ?').bind(targetUserId),
  ]);
  await writeAudit(db, actor.userId, 'account.password_admin_reset', 'user', targetUserId, { sessionsRevoked: true });
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
  await db.prepare(`INSERT INTO payroll_settings (key, value, updated_by, updated_at)
    VALUES ('registration_open', ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .bind(input.registrationOpen ? '1' : '0', actor.userId, now)
    .run();
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

export async function listAdminDepartments(actor: SessionActor): Promise<DepartmentOption[]> {
  requireRole(actor, ['admin']);
  const db = await database();
  const result = await db.prepare(`SELECT id, label, active, sort_order, created_at, updated_at
    FROM payroll_departments ORDER BY active DESC, sort_order ASC, created_at ASC`).all<DepartmentRow>();
  return result.results.map(toDepartmentOption);
}

export async function createDepartment(actor: SessionActor, input: { label?: string }) {
  requireRole(actor, ['admin']);
  const label = cleanString(input.label, 80);
  if (!label) throw new ApiError(400, '请填写部门选项名称。');
  const db = await database();
  const duplicate = await db.prepare('SELECT id FROM payroll_departments WHERE label = ? AND active = 1')
    .bind(label).first<{ id: string }>();
  if (duplicate) throw new ApiError(409, '已存在同名的有效部门选项。');
  const max = await db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS value FROM payroll_departments WHERE active = 1')
    .first<{ value: number }>();
  const id = newId('department');
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO payroll_departments
    (id, label, active, sort_order, created_at, updated_at, deleted_at) VALUES (?, ?, 1, ?, ?, ?, NULL)`)
    .bind(id, label, Number(max?.value ?? -1) + 1, now, now).run();
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
  await db.prepare('UPDATE payroll_departments SET active = 0, updated_at = ?, deleted_at = ? WHERE id = ?')
    .bind(now, now, id).run();
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
  const records = result.results.map(recordFromRow);
  const monthRecords = records.filter((record) => record.workDate.startsWith(month));
  const departments = new Map<string, SalaryRecord[]>();
  for (const record of monthRecords) {
    const label = getDepartmentLabel(record.departmentKey, record.departmentLabel);
    departments.set(label, [...(departments.get(label) ?? []), record]);
  }
  const employees = await listStaffEmployeesInternal(db);
  if (input.userId && !employees.some((employee) => employee.id === input.userId)) {
    throw new ApiError(404, '未找到要追踪的账号。');
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
  if (!env.FILES) throw new ApiError(503, '文件存储绑定不可用。');
  const body = await request.formData();
  const file = body.get('file');
  if (!(file instanceof File)) throw new ApiError(400, '缺少文件。');
  if (file.size <= 0) throw new ApiError(400, '不能上传空文件。');
  if (file.size > 10 * 1024 * 1024) throw new ApiError(400, '单个文件不能超过 10MB。');
  if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
    throw new ApiError(400, '只支持图片或 PDF。');
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'file';
  const key = `payroll/${actor.userId}/${Date.now()}-${newId('file')}-${safeName}`;
  await env.FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  const db = await database();
  await db.prepare(`INSERT INTO payroll_files
    (key, user_id, original_name, content_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(key, actor.userId, cleanString(file.name, 255), file.type, file.size, new Date().toISOString())
    .run();
  await writeAudit(db, actor.userId, 'file.upload', 'file', key, { name: file.name, size: file.size });
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
  headers.set('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.original_name)}`);
  headers.set('cache-control', 'private, no-store');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(object.body, { headers });
}

export async function deleteFile(request: Request, key: string) {
  const actor = await requireSession(request);
  const db = await database();
  const file = await db.prepare('SELECT * FROM payroll_files WHERE key = ?').bind(key).first<FileRow>();
  if (!file) throw new ApiError(404, '未找到附件。');
  if (actor.userId !== file.user_id && actor.role !== 'admin') throw new ApiError(403, '没有删除该附件的权限。');
  const reference = await db.prepare('SELECT reference_id FROM payroll_file_references WHERE file_key = ? LIMIT 1')
    .bind(key)
    .first<{ reference_id: string }>();
  if (reference) throw new ApiError(409, '附件仍被资料或工资记录引用，不能删除。');
  if (!env.FILES) throw new ApiError(503, '文件存储绑定不可用。');
  await env.FILES.delete(key);
  await db.batch([
    db.prepare('DELETE FROM payroll_file_references WHERE file_key = ?').bind(key),
    db.prepare('DELETE FROM payroll_files WHERE key = ?').bind(key),
  ]);
  await writeAudit(db, actor.userId, 'file.delete', 'file', key, { ownerUserId: file.user_id });
}

export function sessionCookie(request: Request, token: string, expiresAt: number) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}; Expires=${new Date(expiresAt).toUTCString()}${secure}`;
}

export function clearSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`;
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
  await db.batch([
    db.prepare('DELETE FROM payroll_sessions WHERE expires_at <= ?').bind(Date.now()),
    db.prepare('INSERT INTO payroll_sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .bind(tokenHash, userId, expiresAt, now),
  ]);
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
    mutable[key] = cleanString(source[key], 500);
  }
  profile.gender = ['', '男', '女', '其他'].includes(profile.gender) ? profile.gender : '';
  profile.idType = ['', 'residence', 'china-id', 'passport'].includes(profile.idType) ? profile.idType : '';
  profile.activityPermission = ['', '有', '无'].includes(profile.activityPermission) ? profile.activityPermission : '';
  profile.dependents = ['', '有', '无'].includes(profile.dependents) ? profile.dependents : '';
  profile.bankType = ['', 'jp-bank', 'cn-bank', 'alipay'].includes(profile.bankType) ? profile.bankType : '';
  profile.payeeIsSelf = ['', '是', '否'].includes(profile.payeeIsSelf) ? profile.payeeIsSelf : '';
  profile.idFileNames = cleanFileKeys(source.idFileNames, 2);
  profile.bankFileNames = cleanFileKeys(source.bankFileNames, 2);
  return profile;
}

async function sanitizeSalaryRecord(
  db: D1Database,
  userId: string,
  input: SalaryRecord,
  existing: SalaryRecord | null,
) {
  const id = cleanString(input.id, 120);
  if (!/^salary-[a-zA-Z0-9-]{8,110}$/.test(id)) throw new ApiError(400, '工资记录编号无效。');
  const workDate = cleanString(input.workDate, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate) || Number.isNaN(Date.parse(`${workDate}T00:00:00Z`))) {
    throw new ApiError(400, '工作日期无效。');
  }
  const departmentKey = cleanString(input.departmentKey, 120);
  const department = await db.prepare(`SELECT id, label FROM payroll_departments
    WHERE id = ? AND active = 1`).bind(departmentKey).first<{ id: string; label: string }>();
  const applyType = Number(input.applyType) as SalaryRecord['applyType'];
  if (!department || ![1, 2, 3, 4, 5, 6, 7].includes(applyType)) throw new ApiError(400, '部门或计费方式无效。');
  const currency = sanitizeCurrency(input.currency);
  const checkUser = cleanString(input.checkUser, 100);
  if (!CHECK_USERS.includes(checkUser)) throw new ApiError(400, '工作负责人无效。');
  const attachments = cleanFileKeys(input.attachments, 8);
  await assertOwnedFiles(db, userId, attachments);
  const now = new Date().toISOString();
  const record = recalculateRecord({
    id,
    userId,
    workDate,
    checkUser,
    departmentKey: department.id,
    departmentLabel: department.label,
    currency,
    applyType,
    workContent: cleanString(input.workContent, 2000),
    memo: cleanString(input.memo, 2000),
    rate: boundedNumber(input.rate, 0, 10_000_000),
    startTime: cleanString(input.startTime, 5),
    endTime: cleanString(input.endTime, 5),
    amount: boundedNumber(input.amount, 0, 10_000_000),
    travelStart: cleanString(input.travelStart, 300),
    travelEnd: cleanString(input.travelEnd, 300),
    travelFee: boundedNumber(input.travelFee, 0, 10_000_000),
    workHours: 0,
    restHours: 0,
    finalSalary: 0,
    attachments,
    status: 1,
    checkDate: null,
    auditMemo: '',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  if ((applyType === 1 || applyType === 7) && record.workHours <= 0) {
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
    return {
      ...parsed,
      currency,
      departmentLabel: getDepartmentLabel(parsed.departmentKey ?? '', parsed.departmentLabel),
      attachments: Array.isArray(parsed.attachments) ? parsed.attachments : [],
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

async function replaceFileReferences(
  db: D1Database,
  ownerUserId: string,
  referenceType: 'profile_id' | 'profile_bank' | 'salary',
  referenceId: string,
  keys: string[],
) {
  await db.prepare('DELETE FROM payroll_file_references WHERE reference_type = ? AND reference_id = ?')
    .bind(referenceType, referenceId)
    .run();
  if (keys.length === 0) return;
  const now = new Date().toISOString();
  await db.batch(keys.map((key) => db.prepare(`INSERT OR IGNORE INTO payroll_file_references
    (file_key, owner_user_id, reference_type, reference_id, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(key, ownerUserId, referenceType, referenceId, now)));
}

async function backfillFileReferences(db: D1Database) {
  const users = await db.prepare('SELECT id, profile_json FROM payroll_users').all<{ id: string; profile_json: string }>();
  for (const user of users.results) {
    const profile = parseProfile(user.profile_json);
    await replaceFileReferences(db, user.id, 'profile_id', user.id, profile.idFileNames.filter(isStoredFileKey));
    await replaceFileReferences(db, user.id, 'profile_bank', user.id, profile.bankFileNames.filter(isStoredFileKey));
  }
  const records = await db.prepare('SELECT id, user_id, data_json FROM payroll_salary_records')
    .all<{ id: string; user_id: string; data_json: string }>();
  for (const row of records.results) {
    const record = parseRecord(row.data_json);
    if (record) await replaceFileReferences(db, row.user_id, 'salary', row.id, record.attachments.filter(isStoredFileKey));
  }
}

function isStoredFileKey(value: string) {
  return /^payroll\/[a-zA-Z0-9._/-]+$/.test(value);
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
  await db.prepare(`INSERT INTO payroll_audit_logs
    (id, actor_user_id, action, target_type, target_id, detail_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(newId('audit'), actorUserId, action, targetType, targetId, JSON.stringify(detail), new Date().toISOString())
    .run();
}

async function queryAuditLogs(db: D1Database, limit: number) {
  const result = await db.prepare(`SELECT l.id, l.actor_user_id, u.email AS actor_email,
    l.action, l.target_type, l.target_id, l.detail_json, l.created_at
    FROM payroll_audit_logs l
    LEFT JOIN payroll_users u ON u.id = l.actor_user_id
    ORDER BY l.created_at DESC LIMIT ?`).bind(limit).all<AuditRow>();
  return result.results.map(toAuditLogItem);
}

async function queryAccountAuditLogs(db: D1Database, userId: string, month?: string) {
  const monthClause = month ? 'AND l.created_at LIKE ?' : '';
  const statement = db.prepare(`SELECT l.id, l.actor_user_id, u.email AS actor_email,
    l.action, l.target_type, l.target_id, l.detail_json, l.created_at
    FROM payroll_audit_logs l
    LEFT JOIN payroll_users u ON u.id = l.actor_user_id
    WHERE (
      l.actor_user_id = ?
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
  const bindings: Array<string> = [userId, userId, userId, userId, `%${userId}%`];
  if (month) bindings.push(`${month}-%`);
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
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    actorEmail: row.actor_email,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    detail: parseJsonObject(row.detail_json),
    createdAt: row.created_at,
  };
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
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
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
  const basicError = profileBasicsError(profile);
  if (basicError) return basicError;
  if (!profile.birthday || !profile.idType || !profile.bankType) {
    return '请先完善生日、证件类型和工资收款方式。';
  }
  const expectedIdFiles = profile.idType === 'passport' ? 1 : 2;
  if (profile.idFileNames.length !== expectedIdFiles) {
    return `身份证件需要上传 ${expectedIdFiles} 个文件。`;
  }
  if (!profile.dependents) return '请填写抚养信息。';
  if (profile.idType === 'residence' && (!profile.residentStatus || !profile.activityPermission)) {
    return '请填写在留资格和资格外活动许可。';
  }
  if (profile.idType === 'china-id' && (
    !profile.nationality || !profile.idNumber || !profile.idExpiryDate
    || !profile.address || !profile.addressOfLicense || !profile.tel
  )) {
    return '请补全中国居民身份证及联系信息。';
  }
  if (!profile.bankName || !profile.bankAccountNumber || !profile.bankAccountHolder) {
    return '请补全工资收款账户名称、账号和账户姓名。';
  }
  if ((profile.bankType === 'cn-bank' || profile.bankType === 'alipay') && !profile.payeeIsSelf) {
    return '请确认收款人是否本人。';
  }
  if (profile.payeeIsSelf === '否' && !profile.payeeName) return '请填写收款人姓名。';
  return null;
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
