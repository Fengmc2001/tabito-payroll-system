import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GRAY_SEED_TAG = 'gray-v1';
export const GRAY_ENVIRONMENT_ID = 'tabito-payroll-isolated-gray-v1';
export const GRAY_SEED_CONFIRMATION = 'SEED-GRAY-FIXTURE';
export const GRAY_CLEAR_CONFIRMATION = 'DELETE-ALL-GRAY-PAYROLL-DATA';
export const BOOTSTRAP_ADMIN_EMAIL = 'TabitoAdimin01@tabitoedu.com';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const credentialPath = resolve(
  projectRoot,
  process.env.PAYROLL_GRAY_CREDENTIALS_PATH || '.local/gray-fixture-credentials.json',
);

export const accountSpecs = [
  {
    key: 'lingling',
    name: '泠泠',
    email: BOOTSTRAP_ADMIN_EMAIL,
    role: 'admin',
    nameParts: ['泠', '泠'],
    bankType: 'jp-bank',
  },
  {
    key: 'aiwei',
    name: '阿惟',
    email: 'reviewer-aiwei@tabitoedu.test',
    role: 'reviewer',
    nameParts: ['阿', '惟'],
    bankType: 'jp-bank',
  },
  {
    key: 'up',
    name: 'UP',
    email: 'reviewer-up@tabitoedu.test',
    role: 'reviewer',
    nameParts: ['U', 'P'],
    bankType: 'jp-bank',
  },
  {
    key: 'awen',
    name: '阿稳',
    email: 'reviewer-awen@tabitoedu.test',
    role: 'reviewer',
    nameParts: ['阿', '稳'],
    bankType: 'jp-bank',
  },
  {
    key: 'john',
    name: 'john',
    email: 'reviewer-john@tabitoedu.test',
    role: 'reviewer',
    nameParts: ['j', 'ohn'],
    bankType: 'jp-bank',
  },
  ...['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((letter) => ({
    key: `teacher-${letter.toLowerCase()}`,
    name: `授课老师${letter}`,
    email: `teacher-${letter.toLowerCase()}@tabitoedu.test`,
    role: 'employee',
    nameParts: ['授课老师', letter],
    bankType: letter === 'F' || letter === 'G' ? 'cn-bank' : 'jp-bank',
  })),
];

export function grayBaseUrl() {
  const value = String(process.env.PAYROLL_GRAY_BASE_URL || 'http://localhost:3200').replace(/\/+$/, '');
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('PAYROLL_GRAY_BASE_URL 必须是 HTTP(S) 地址。');
  return parsed.toString().replace(/\/$/, '');
}

export async function loadOrCreateCredentials(baseUrl, bootstrapRequired, fixtureMonth) {
  let existing = null;
  try {
    existing = JSON.parse(await readFile(credentialPath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  if (existing) {
    if (existing.seedTag !== GRAY_SEED_TAG || !Array.isArray(existing.accounts)) {
      throw new Error(`凭据文件格式不正确：${credentialPath}`);
    }
    if (normalizeBaseUrl(existing.baseUrl) !== normalizeBaseUrl(baseUrl)) {
      throw new Error(`凭据文件属于另一个灰度环境：${existing.baseUrl}`);
    }
    if (existing.month !== fixtureMonth) {
      throw new Error(`凭据文件的灰度月份是 ${existing.month}，当前请求是 ${fixtureMonth}。`);
    }
    const byEmail = new Map(existing.accounts.map((account) => [account.email.toLowerCase(), account]));
    const accounts = accountSpecs.map((spec) => {
      const saved = byEmail.get(spec.email.toLowerCase());
      if (!saved?.password) throw new Error(`凭据文件缺少 ${spec.email} 的密码。`);
      return { ...spec, password: saved.password };
    });
    return { accounts, created: false, month: existing.month };
  }

  const suppliedAdminPassword = String(process.env.PAYROLL_GRAY_ADMIN_PASSWORD || '');
  if (!bootstrapRequired && !suppliedAdminPassword) {
    throw new Error(
      '灰度库已有首管理员，但本机没有凭据文件。'
      + '请通过 PAYROLL_GRAY_ADMIN_PASSWORD 提供现有管理员密码。',
    );
  }
  const accounts = accountSpecs.map((spec) => ({
    ...spec,
    password: spec.role === 'admin' && suppliedAdminPassword ? suppliedAdminPassword : randomPassword(),
  }));
  const payload = {
    schemaVersion: 1,
    seedTag: GRAY_SEED_TAG,
    baseUrl,
    month: fixtureMonth,
    createdAt: new Date().toISOString(),
    warning: '只用于隔离的灰度环境，禁止提交到 Git。',
    accounts: accounts.map(({ key, name, email, role, password }) => ({ key, name, email, role, password })),
  };
  await writePrivateJson(credentialPath, payload);
  return { accounts, created: true, month: fixtureMonth };
}

export async function loadCredentials(baseUrl) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(credentialPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`未找到灰度凭据文件：${credentialPath}`);
    throw error;
  }
  if (parsed.seedTag !== GRAY_SEED_TAG || normalizeBaseUrl(parsed.baseUrl) !== normalizeBaseUrl(baseUrl)) {
    throw new Error(`灰度凭据与当前地址不匹配：${credentialPath}`);
  }
  return parsed;
}

export class PayrollClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async request(path, options = {}) {
    const headers = new Headers(options.headers);
    if (options.cookie) headers.set('cookie', options.cookie);
    if (options.body !== undefined) headers.set('content-type', 'application/json');
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.formData || (options.body === undefined ? undefined : JSON.stringify(options.body)),
      redirect: 'manual',
    });
    const responseText = await response.text();
    let data = {};
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch {
      data = { body: responseText };
    }
    return { status: response.status, data, headers: response.headers };
  }

  async expect(path, status, options = {}) {
    const response = await this.request(path, options);
    if (response.status !== status) {
      throw new Error(
        `${options.method || 'GET'} ${path}: expected ${status}, received ${response.status} ${JSON.stringify(response.data)}`,
      );
    }
    return response;
  }

  async login(credentials) {
    const response = await this.expect('/api/users/login', 200, {
      method: 'POST',
      body: { email: credentials.email, passwordDigest: digest(credentials.password) },
    });
    return { account: response.data.account, cookie: cookieFrom(response) };
  }

  async register(credentials) {
    const bootstrapSecret = String(process.env.PAYROLL_BOOTSTRAP_SECRET || '');
    if (!bootstrapSecret) throw new Error('首次初始化灰度库时必须设置 PAYROLL_BOOTSTRAP_SECRET。');
    const response = await this.expect('/api/users', 201, {
      method: 'POST',
      body: { email: credentials.email, passwordDigest: digest(credentials.password), bootstrapSecret },
    });
    return { account: response.data.account, cookie: cookieFrom(response) };
  }
}

export function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function cookieFrom(response) {
  const cookie = (response.headers.get('set-cookie') || '').split(';', 1)[0];
  if (!cookie.startsWith('xly_payroll_session=')) throw new Error('登录响应没有设置会话 Cookie。');
  return cookie;
}

export function minimalPdf(label) {
  const escaped = label.replace(/[()\\]/g, (value) => `\\${value}`);
  return new TextEncoder().encode(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n`
    + `2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n`
    + `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 120]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n`
    + `4 0 obj<</Length ${escaped.length + 33}>>stream\nBT /F1 12 Tf 24 64 Td (${escaped}) Tj ET\nendstream endobj\n`
    + `5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n`
    + `trailer<</Root 1 0 R>>\n%%EOF\n`,
  );
}

export function currentMonthShanghai() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return `${year}-${month}`;
}

export function assertMonth(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error(`灰度月份无效：${month}`);
  return month;
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertGrayMaintenancePreflight(data) {
  assert(
    data?.grayEnabled === true
      && data?.seedTag === GRAY_SEED_TAG
      && data?.environmentId === GRAY_ENVIRONMENT_ID,
    `目标不是固定标识 ${GRAY_ENVIRONMENT_ID} 的隔离灰度环境。`,
  );
}

async function writePrivateJson(path, payload) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
}

function randomPassword() {
  return `${randomBytes(18).toString('base64url')}!Aa9`;
}

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '').toLowerCase();
}
