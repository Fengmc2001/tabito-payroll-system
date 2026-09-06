import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import ts from 'typescript';
import { RESET_KEY, LOCK_KEY, RESET_TABLES, quote, objectKeyPath, acquireResetSql, freezeWritesSql,
  clearBusinessSql, finishResetSql, runServerRelease } from './deployment-reset-plan.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.slice(2).some((arg) => arg !== '--resume')) throw new Error('仅支持 --resume；此命令没有自动确认或跳过重置选项。');
const owner = randomUUID();
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const parsed = ts.parseConfigFileTextToJson('wrangler.jsonc', await readFile(resolve(root, 'wrangler.jsonc'), 'utf8'));
if (parsed.error) throw new Error('wrangler.jsonc 无法解析。');
const config = parsed.config;
const db = config.d1_databases?.find((item) => item.binding === 'DB');
const bucket = config.r2_buckets?.find((item) => item.binding === 'FILES');
if (!/^[a-f0-9]{32}$/i.test(accountId ?? '') || !token) throw new Error('请先设置 CLOUDFLARE_ACCOUNT_ID 与 CLOUDFLARE_API_TOKEN。');
if (!/^[a-f0-9-]{36}$/i.test(db?.database_id ?? '') || db.database_id.startsWith('00000000-')
  || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(bucket?.bucket_name ?? '')
  || !/^[a-zA-Z0-9_-]+$/.test(config.name ?? '')) throw new Error('请先配置本系统专用的 Worker、D1 与 R2，不能使用占位值。');
if (config.env || db.remote === false || bucket.remote === false) throw new Error('此命令只使用根配置的生产资源，不接受 env 或 local 绑定。');

const apiBase = 'https://api.cloudflare.com/client/v4/accounts/' + accountId;
async function api(path, options = {}) {
  const response = await fetch(apiBase + path, {
    ...options,
    headers: { authorization: 'Bearer ' + token, ...(path.startsWith('/r2/') ? { 'cf-r2-jurisdiction': bucket.jurisdiction || 'default' } : {}), ...options.headers },
    signal: AbortSignal.timeout(60000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) throw new Error('Cloudflare 操作未确认成功（HTTP ' + response.status + '），已停止后续步骤。');
  return payload;
}
async function sql(query) {
  const payload = await api('/d1/database/' + db.database_id + '/query', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql: query }),
  });
  if (!Array.isArray(payload.result) || payload.result.some((result) => !result.success)) throw new Error('数据库事务未确认成功，已停止发布。');
  return payload.result;
}
async function state() {
  const tables = await sql("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'payroll_settings'");
  if (!tables[0].results.length) return { phase: 'pending', owner: null };
  const results = await sql(`SELECT key,value FROM payroll_settings WHERE key IN ('${RESET_KEY}','${LOCK_KEY}')`);
  return {
    phase: results[0].results.find((row) => row.key === RESET_KEY)?.value || 'pending',
    owner: results[0].results.find((row) => row.key === LOCK_KEY)?.value || null,
  };
}
function command(args) {
  const result = spawnSync(process.execPath, [resolve(root, 'node_modules/wrangler/bin/wrangler.js'), ...args], {
    cwd: root, env: process.env, stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error('部署命令未完成；请保留备份，解决错误后使用 --resume 重试。');
}
const objectsPath = '/r2/buckets/' + bucket.bucket_name + '/objects';
async function listFiles() {
  let cursor = '';
  const seen = new Set();
  for (;;) {
    const result = await api(objectsPath + '?prefix=payroll%2F&per_page=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
    if (!Array.isArray(result.result)) throw new Error('附件列表格式不正确，未继续清理。');
    for (const object of result.result) {
      if (typeof object.key !== 'string' || !object.key.startsWith('payroll/')) throw new Error('发现范围外附件，已中止。');
    }
    if (result.result.length || !result.result_info?.is_truncated) return result.result;
    cursor = result.result_info.cursor;
    if (!cursor || seen.has(cursor)) throw new Error('附件分页无法确认，已中止。');
    seen.add(cursor);
  }
}
let maintenanceStarted = false;
try {
  const outcome = await runServerRelease({
    owner, resume: process.argv.includes('--resume'), interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    async preflight() {
      const actualDb = await api('/d1/database/' + db.database_id);
      if (actualDb.result?.name !== db.database_name) throw new Error('D1 名称与配置不一致，未执行清理。');
      await api('/r2/buckets/' + bucket.bucket_name);
      await listFiles();
      const settings = await api('/workers/scripts/' + config.name + '/settings');
      const bindings = settings.result?.bindings ?? [];
      const activeDb = bindings.find((binding) => binding.name === 'DB');
      const activeFiles = bindings.find((binding) => binding.name === 'FILES');
      if ((activeDb && (activeDb.type !== 'd1' || activeDb.id !== db.database_id))
        || (activeFiles && (activeFiles.type !== 'r2_bucket' || activeFiles.bucket_name !== bucket.bucket_name))) {
        throw new Error('当前 Worker 的数据绑定与本地配置不一致，未清理任何内容。');
      }
    },
    async checkBootstrap() {
      const secrets = await api('/workers/scripts/' + config.name + '/secrets');
      if (!secrets.result?.some((secret) => secret.name === 'BOOTSTRAP_SECRET')) {
        throw new Error('请先为该 Worker 配置至少 16 字符的 BOOTSTRAP_SECRET。');
      }
    },
    state,
    async confirm() {
      console.log(`本次首次发布将永久清空工资系统的账号、工资、审批、资料、操作记录及上传附件。
Cloudflare 账号：${accountId}
目标 Worker：${config.name}
目标 D1：${db.database_name}（${db.database_id}）
目标 R2：${bucket.bucket_name}/payroll/
请提前备份数据库和附件，并确认这些资源为本系统专用。
第一次正式登陆该系统、服务器尚无旧数据时，不需要备份服务器。
本地程序与测试数据不清空。完成本次重置后，后续正常更新不再清空。`);
      if (process.argv.includes('--resume')) console.log('继续前必须确认上一次部署进程已退出；不要同时运行两个恢复任务。');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try { return await rl.question('已备份（或首次上线无需备份）并确认继续？(y/n，默认 n)：'); }
      finally { rl.close(); }
    },
    async build() {
      const result = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', env: process.env });
      if (result.status !== 0) throw new Error('构建失败，未开始服务器清理。');
    },
    async migrate() { command(['d1', 'migrations', 'apply', db.database_name, '--remote', '--config', 'wrangler.jsonc']); },
    async acquire(previousOwner) { await sql(acquireResetSql(owner, previousOwner)); },
    async freeze() { await sql(freezeWritesSql()); },
    async maintenance() {
      await mkdir(resolve(root, '.local'), { recursive: true });
      const temporary = await mkdtemp(resolve(root, '.local/server-deploy-'));
      const maintenanceConfig = {
        ...config, main: resolve(root, 'deployment/maintenance-worker.ts'),
        d1_databases: config.d1_databases.map((binding) => ({ ...binding, migrations_dir: resolve(root, binding.migrations_dir || 'drizzle') })),
        triggers: { crons: [] }, assets: undefined, observability: { enabled: true },
      };
      const path = resolve(temporary, 'wrangler.json');
      await writeFile(path, JSON.stringify(maintenanceConfig, null, 2), { mode: 0o600 });
      command(['deploy', '--config', path, '--keep-vars']);
      maintenanceStarted = true;
    },
    async purgeFiles() {
      let removed = 0;
      for (;;) {
        const files = await listFiles();
        if (!files.length) break;
        for (const file of files) await api(objectsPath + '/' + objectKeyPath(file.key), { method: 'DELETE' });
        removed += files.length;
        console.log('已清理本系统附件：' + removed + ' 个');
      }
    },
    async clear() { await sql(clearBusinessSql(owner, new Date().toISOString())); },
    async verifyEmpty() {
      const current = await state();
      if (current.phase !== 'cleared' || current.owner !== owner) throw new Error('初始化状态不一致，保持维护模式。');
      const countTables = RESET_TABLES.filter((table) => table !== 'payroll_departments');
      const counts = await sql(countTables.map((table) => `SELECT ${quote(table)} AS name, COUNT(*) AS count FROM ${table}`).join(';'));
      if (counts.some((result) => Number(result.results[0].count) !== 0) || (await listFiles()).length) throw new Error('仍存在旧业务数据或附件，保持维护模式。');
    },
    async publish() { command(['deploy', '--config', 'dist/server/wrangler.json', '--keep-vars']); },
    async finish() {
      await sql(finishResetSql(owner));
      if ((await state()).phase !== 'complete') throw new Error('发布后初始化标记未确认，请使用 --resume 核对。');
    },
  });
  console.log(outcome === 'reset-complete'
    ? '首次发布重置完成。请使用 BOOTSTRAP_SECRET 初始化 TabitoAdimin01@tabitoedu.com，并自行设置密码。旧数据只能从事先备份恢复。'
    : '服务器更新完成，正式数据保持不变。');
} catch (error) {
  if (maintenanceStarted) console.error('服务器可能仍处于维护模式。不要直接绕过发布脚本；修复错误并确认没有其他部署进程后，运行 npm run deploy:cloudflare -- --resume。');
  console.error(error instanceof Error ? error.message : '发布失败。');
  process.exitCode = 1;
}
