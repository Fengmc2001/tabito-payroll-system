import { env } from 'cloudflare:workers';
import {
  ApiError,
  errorResponse,
  json,
  requireSession,
} from '../../../lib/server/payroll-store';
import { BOOTSTRAP_ADMIN_EMAIL, DEFAULT_DEPARTMENTS } from '../../../lib/payroll';

const GRAY_STAGE = 'gray';
const GRAY_ENVIRONMENT_ID = 'tabito-payroll-isolated-gray-v1';
const GRAY_SEED_TAG = 'gray-v1';
const GRAY_RETIRED_SETTING = 'gray_maintenance_retired';
const GRAY_CLEAR_PLAN_SETTING = 'gray_clear_plan_v1';
const CLEAR_CONFIRMATION = 'DELETE-ALL-GRAY-PAYROLL-DATA';
const MAX_MANIFEST_ENTITIES = 500;
const REQUIRED_MANIFEST_USERS = 12;
const EXPECTED_GRAY_EMAILS = [
  BOOTSTRAP_ADMIN_EMAIL,
  'reviewer-aiwei@tabitoedu.test',
  'reviewer-up@tabitoedu.test',
  'reviewer-awen@tabitoedu.test',
  'reviewer-john@tabitoedu.test',
  'teacher-a@tabitoedu.test',
  'teacher-b@tabitoedu.test',
  'teacher-c@tabitoedu.test',
  'teacher-d@tabitoedu.test',
  'teacher-e@tabitoedu.test',
  'teacher-f@tabitoedu.test',
  'teacher-g@tabitoedu.test',
].map((email) => email.toLowerCase());

type ManifestEntity = {
  type?: unknown;
  id?: unknown;
};

const TABLES_TO_CLEAR = [
  'payroll_seed_entities',
  'payroll_recurring_instances',
  'payroll_recurring_rules',
  'payroll_salary_batches',
  'payroll_file_references',
  'payroll_salary_records',
  'payroll_files',
  'payroll_audit_logs',
  'payroll_sessions',
  'payroll_settings',
  'payroll_departments',
  'payroll_users',
] as const;

export async function GET(request: Request) {
  try {
    await requireActiveGrayMaintenance();
    const url = new URL(request.url);
    if (url.searchParams.get('detail') !== '1') {
      return noStoreJson({
        grayEnabled: true,
        environmentId: GRAY_ENVIRONMENT_ID,
        seedTag: GRAY_SEED_TAG,
        bootstrapEmail: BOOTSTRAP_ADMIN_EMAIL,
      });
    }

    const actor = await requireAdmin(request);
    const counts = await fixtureCounts();
    return noStoreJson({
      grayEnabled: true,
      environmentId: GRAY_ENVIRONMENT_ID,
      seedTag: GRAY_SEED_TAG,
      actorUserId: actor.userId,
      counts,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireActiveGrayMaintenance();
    await requireAdmin(request);
    const clearPlan = await requiredDatabase().prepare('SELECT value FROM payroll_settings WHERE key = ?')
      .bind(GRAY_CLEAR_PLAN_SETTING)
      .first<{ value: string }>();
    if (clearPlan) throw new ApiError(409, '灰度清除已经开始，不能再登记新数据。');
    const body = await request.json() as { seedTag?: unknown; entities?: unknown };
    if (body.seedTag !== GRAY_SEED_TAG) throw new ApiError(400, '灰度数据标记无效。');
    if (!Array.isArray(body.entities) || body.entities.length === 0 || body.entities.length > MAX_MANIFEST_ENTITIES) {
      throw new ApiError(400, `灰度实体清单必须包含 1–${MAX_MANIFEST_ENTITIES} 项。`);
    }

    const entities = normalizeManifest(body.entities as ManifestEntity[]);
    const now = new Date().toISOString();
    const db = requiredDatabase();
    await db.prepare(`INSERT OR IGNORE INTO payroll_seed_entities
      (seed_tag, entity_type, entity_id, created_at)
      SELECT ?, json_extract(value, '$.type'), json_extract(value, '$.id'), ?
      FROM json_each(?)
      WHERE NOT EXISTS (SELECT 1 FROM payroll_settings WHERE key = ?)`)
      .bind(GRAY_SEED_TAG, now, JSON.stringify(entities), GRAY_CLEAR_PLAN_SETTING)
      .run();
    const planAfterInsert = await db.prepare('SELECT value FROM payroll_settings WHERE key = ?')
      .bind(GRAY_CLEAR_PLAN_SETTING)
      .first<{ value: string }>();
    if (planAfterInsert) throw new ApiError(409, '灰度清除已经开始，不能再登记新数据。');
    return noStoreJson({
      ok: true,
      environmentId: GRAY_ENVIRONMENT_ID,
      seedTag: GRAY_SEED_TAG,
      registered: entities.length,
    }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireActiveGrayMaintenance();
    await requireAdmin(request);
    const body = await request.json() as { confirmation?: unknown; seedTag?: unknown };
    if (body.seedTag !== GRAY_SEED_TAG || body.confirmation !== CLEAR_CONFIRMATION) {
      throw new ApiError(400, '清除确认信息不匹配。');
    }

    await requireCompleteGrayManifest();
    const before = await fixtureCounts();
    const deletedObjects = await clearManifestObjectStorage();
    const db = requiredDatabase();
    const clearPlan = await db.prepare('SELECT value FROM payroll_settings WHERE key = ?')
      .bind(GRAY_CLEAR_PLAN_SETTING)
      .first<{ value: string }>();
    if (!clearPlan) throw new ApiError(409, '灰度附件清除计划已丢失。');

    // Recreate the few structural defaults needed for the fixed first-admin
    // bootstrap flow after all gray business data has been removed.
    // The retirement flag is one-way for this D1: even if DEPLOYMENT_STAGE stays
    // gray, the destructive maintenance endpoint disappears after this batch.
    const now = new Date().toISOString();
    await db.batch([
      ...TABLES_TO_CLEAR.map((table) => db.prepare(`DELETE FROM ${table}`)),
      db.prepare(`INSERT INTO payroll_settings (key, value, updated_by, updated_at)
        VALUES ('registration_open', '1', NULL, ?)`).bind(now),
      db.prepare(`INSERT INTO payroll_settings (key, value, updated_by, updated_at)
        VALUES (?, '1', NULL, ?)`).bind(GRAY_RETIRED_SETTING, now),
      ...DEFAULT_DEPARTMENTS.map((department, index) => db.prepare(`INSERT INTO payroll_departments
        (id, label, active, sort_order, created_at, updated_at, deleted_at)
        VALUES (?, ?, 1, ?, ?, ?, NULL)`)
        .bind(department.key, department.label, index, now, now)),
      // Keep the terminal plan as a one-way generation marker. New requests
      // can distinguish the post-clear database generation, while any request
      // that started before the clear cannot silently write into the new one.
      db.prepare(`INSERT INTO payroll_settings (key, value, updated_by, updated_at)
        VALUES (?, ?, NULL, ?)`).bind(GRAY_CLEAR_PLAN_SETTING, clearPlan.value, now),
    ]);

    await requireEmptyGrayBusinessTables();

    return noStoreJson({
      ok: true,
      cleared: before,
      deletedObjects,
      bootstrap: {
        bootstrapRequired: true,
        email: BOOTSTRAP_ADMIN_EMAIL,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

async function requireEmptyGrayBusinessTables() {
  const db = requiredDatabase();
  const tables = TABLES_TO_CLEAR.filter((table) => !['payroll_settings', 'payroll_departments'].includes(table));
  const results = await db.batch(tables.map((table) => db.prepare(`SELECT COUNT(*) AS count FROM ${table}`)));
  const residual = tables.filter((_, index) => resultCount(results[index]) !== 0);
  if (residual.length > 0) {
    throw new ApiError(500, `灰度数据清除后仍有业务数据残留：${residual.join('、')}。`);
  }
}

async function requireActiveGrayMaintenance() {
  if (String(env.DEPLOYMENT_STAGE ?? '').trim().toLowerCase() !== GRAY_STAGE
    || String(env.GRAY_ENVIRONMENT_ID ?? '') !== GRAY_ENVIRONMENT_ID) {
    // Deliberately hide this destructive maintenance surface unless both
    // independent gray deployment identifiers match their fixed values.
    throw new ApiError(404, '未找到该接口。');
  }
  try {
    const retired = await requiredDatabase().prepare('SELECT value FROM payroll_settings WHERE key = ?')
      .bind(GRAY_RETIRED_SETTING)
      .first<{ value: string }>();
    if (retired?.value === '1') throw new ApiError(404, '未找到该接口。');
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // A brand-new D1 may not have its runtime tables until bootstrap-status or
    // registration first initializes the schema. It is valid for preflight.
    if (!String(error).toLowerCase().includes('no such table')) throw error;
  }
}

async function requireAdmin(request: Request) {
  const actor = await requireSession(request, undefined, true);
  if (actor.role !== 'admin') throw new ApiError(403, '仅管理员可管理灰度数据。');
  return actor;
}

function requiredDatabase() {
  if (!env.DB) throw new ApiError(503, '数据库绑定不可用。');
  return env.DB;
}

function requiredFiles() {
  if (!env.FILES) throw new ApiError(503, '文件存储绑定不可用。');
  return env.FILES;
}

function normalizeManifest(input: ManifestEntity[]) {
  const seen = new Set<string>();
  const entities: Array<{ type: string; id: string }> = [];
  for (const item of input) {
    const type = typeof item?.type === 'string' ? item.type.trim() : '';
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    if (!/^(user|salary|batch|rule|file)$/.test(type) || !id || id.length > 500) {
      throw new ApiError(400, '灰度实体清单格式无效。');
    }
    const key = `${type}\u0000${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entities.push({ type, id });
  }
  if (entities.length === 0) throw new ApiError(400, '灰度实体清单为空。');
  return entities;
}

async function fixtureCounts() {
  const db = requiredDatabase();
  const [users, salaries, files, rules, batches, marked] = await db.batch([
    db.prepare('SELECT COUNT(*) AS count FROM payroll_users'),
    db.prepare('SELECT COUNT(*) AS count FROM payroll_salary_records'),
    db.prepare('SELECT COUNT(*) AS count FROM payroll_files'),
    db.prepare('SELECT COUNT(*) AS count FROM payroll_recurring_rules'),
    db.prepare('SELECT COUNT(*) AS count FROM payroll_salary_batches'),
    db.prepare('SELECT COUNT(*) AS count FROM payroll_seed_entities WHERE seed_tag = ?').bind(GRAY_SEED_TAG),
  ]);
  return {
    users: resultCount(users),
    salaries: resultCount(salaries),
    files: resultCount(files),
    rules: resultCount(rules),
    batches: resultCount(batches),
    marked: resultCount(marked),
  };
}

async function requireCompleteGrayManifest() {
  const db = requiredDatabase();
  const [markedUsers, existingMarkedUsers, fixedAdmin, totalUsers,
    markedFiles, existingMarkedFiles, totalFiles] = await db.batch([
    db.prepare(`SELECT COUNT(DISTINCT entity_id) AS count FROM payroll_seed_entities
      WHERE seed_tag = ? AND entity_type = 'user'`).bind(GRAY_SEED_TAG),
    db.prepare(`SELECT COUNT(DISTINCT s.entity_id) AS count
      FROM payroll_seed_entities s JOIN payroll_users u ON u.id = s.entity_id
      WHERE s.seed_tag = ? AND s.entity_type = 'user'`).bind(GRAY_SEED_TAG),
    db.prepare(`SELECT COUNT(*) AS count FROM payroll_users
      WHERE lower(email) = lower(?) AND role = 'admin' AND status = 'active'`).bind(BOOTSTRAP_ADMIN_EMAIL),
    db.prepare('SELECT COUNT(*) AS count FROM payroll_users'),
    db.prepare(`SELECT COUNT(DISTINCT entity_id) AS count FROM payroll_seed_entities
      WHERE seed_tag = ? AND entity_type = 'file'`).bind(GRAY_SEED_TAG),
    db.prepare(`SELECT COUNT(DISTINCT s.entity_id) AS count
      FROM payroll_seed_entities s JOIN payroll_files f ON f.key = s.entity_id
      WHERE s.seed_tag = ? AND s.entity_type = 'file'`).bind(GRAY_SEED_TAG),
    db.prepare('SELECT COUNT(*) AS count FROM payroll_files'),
  ]);
  const markedCount = resultCount(markedUsers);
  const existingCount = resultCount(existingMarkedUsers);
  const manifestedEmails = await db.prepare(`SELECT lower(u.email) AS email
    FROM payroll_seed_entities s JOIN payroll_users u ON u.id = s.entity_id
    WHERE s.seed_tag = ? AND s.entity_type = 'user'`).bind(GRAY_SEED_TAG).all<{ email: string }>();
  const actualEmails = new Set(manifestedEmails.results.map((row) => row.email));
  const exactFixtureAccounts = actualEmails.size === EXPECTED_GRAY_EMAILS.length
    && EXPECTED_GRAY_EMAILS.every((email) => actualEmails.has(email));
  if (markedCount !== REQUIRED_MANIFEST_USERS || existingCount !== markedCount
    || resultCount(totalUsers) !== REQUIRED_MANIFEST_USERS
    || resultCount(markedFiles) !== resultCount(totalFiles)
    || resultCount(existingMarkedFiles) !== resultCount(totalFiles)
    || resultCount(fixedAdmin) !== 1 || !exactFixtureAccounts) {
    throw new ApiError(
      409,
      `未验证到完整的 ${REQUIRED_MANIFEST_USERS} 个灰度账号清单，拒绝清空 D1/R2。`,
    );
  }
}

function resultCount(result: D1Result<unknown>) {
  const row = result.results?.[0] as { count?: unknown } | undefined;
  return Number(row?.count ?? 0);
}

async function clearManifestObjectStorage() {
  const db = requiredDatabase();
  const files = requiredFiles();
  const result = await db.prepare(`SELECT DISTINCT entity_id AS key FROM payroll_seed_entities
    WHERE seed_tag = ? AND entity_type = 'file' ORDER BY entity_id ASC`)
    .bind(GRAY_SEED_TAG)
    .all<{ key: string }>();
  const keys = result.results.map((row) => row.key);
  const existingPlan = await db.prepare('SELECT value FROM payroll_settings WHERE key = ?')
    .bind(GRAY_CLEAR_PLAN_SETTING)
    .first<{ value: string }>();
  let plannedKeys = existingPlan ? parseClearPlan(existingPlan.value) : keys;
  if (plannedKeys.length !== keys.length || plannedKeys.some((key, index) => key !== keys[index])) {
    throw new ApiError(409, '灰度附件清单在清除期间发生了变化。');
  }
  if (!existingPlan) {
    for (let index = 0; index < plannedKeys.length; index += 50) {
      const existing = await Promise.all(plannedKeys.slice(index, index + 50).map((key) => files.head(key)));
      if (existing.some((object) => !object)) {
        throw new ApiError(409, '灰度附件与当前 R2 存储不一致，拒绝清除。');
      }
    }
    await db.prepare(`INSERT OR IGNORE INTO payroll_settings (key, value, updated_by, updated_at)
      SELECT ?, ?, NULL, ?
      WHERE (SELECT COUNT(DISTINCT entity_id) FROM payroll_seed_entities
          WHERE seed_tag = ? AND entity_type = 'file') = ?
        AND NOT EXISTS (
          SELECT 1 FROM payroll_seed_entities seed
          WHERE seed.seed_tag = ? AND seed.entity_type = 'file'
            AND NOT EXISTS (SELECT 1 FROM json_each(?) planned WHERE planned.value = seed.entity_id)
        )
        AND NOT EXISTS (
          SELECT 1 FROM payroll_files stored
          WHERE NOT EXISTS (
            SELECT 1 FROM payroll_seed_entities seed
            WHERE seed.seed_tag = ? AND seed.entity_type = 'file' AND seed.entity_id = stored.key
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM payroll_seed_entities seed
          WHERE seed.seed_tag = ? AND seed.entity_type = 'file'
            AND NOT EXISTS (SELECT 1 FROM payroll_files stored WHERE stored.key = seed.entity_id)
        )`)
      .bind(GRAY_CLEAR_PLAN_SETTING, JSON.stringify(plannedKeys), new Date().toISOString(),
        GRAY_SEED_TAG, plannedKeys.length, GRAY_SEED_TAG, JSON.stringify(plannedKeys),
        GRAY_SEED_TAG, GRAY_SEED_TAG)
      .run();
    const storedPlan = await db.prepare('SELECT value FROM payroll_settings WHERE key = ?')
      .bind(GRAY_CLEAR_PLAN_SETTING)
      .first<{ value: string }>();
    plannedKeys = parseClearPlan(storedPlan?.value ?? '');
    if (plannedKeys.length !== keys.length || plannedKeys.some((key, index) => key !== keys[index])) {
      throw new ApiError(409, '无法锁定灰度附件清除计划。');
    }
  }
  for (let index = 0; index < plannedKeys.length; index += 1000) {
    await files.delete(plannedKeys.slice(index, index + 1000));
  }
  for (let index = 0; index < plannedKeys.length; index += 50) {
    const remaining = await Promise.all(plannedKeys.slice(index, index + 50).map((key) => files.head(key)));
    if (remaining.some(Boolean)) throw new ApiError(500, '灰度附件未能完整清除。');
  }
  return plannedKeys.length;
}

function parseClearPlan(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((key) => typeof key !== 'string')) {
      throw new Error('invalid clear plan');
    }
    return [...new Set(parsed)].sort();
  } catch {
    throw new ApiError(409, '灰度附件清除计划无效。');
  }
}

function noStoreJson(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('cache-control', 'no-store');
  return json(data, { ...init, headers });
}
