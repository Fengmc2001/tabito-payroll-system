import {readFile, readdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import ts from 'typescript';
import {assertBindingsMatch, assertPreservingMigrations, assertNoInterruptedReset, runPreservingRelease} from './deployment-preserve-plan.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.length > 2) throw new Error('正常更新不接受重置或 --resume 参数；此命令始终保留数据。');
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const parsed = ts.parseConfigFileTextToJson('wrangler.jsonc', await readFile(resolve(root, 'wrangler.jsonc'), 'utf8'));
if (parsed.error) throw new Error('wrangler.jsonc 无法解析。');
const config = parsed.config;
const db = config.d1_databases?.find(item => item.binding === 'DB');
const bucket = config.r2_buckets?.find(item => item.binding === 'FILES');
if (!/^[a-f0-9]{32}$/i.test(accountId ?? '') || !token) throw new Error('请先设置 CLOUDFLARE_ACCOUNT_ID 与 CLOUDFLARE_API_TOKEN。');
if (!/^[a-f0-9-]{36}$/i.test(db?.database_id ?? '') || db.database_id.startsWith('00000000-')
  || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(bucket?.bucket_name ?? '')
  || !/^[a-zA-Z0-9_-]+$/.test(config.name ?? '')) throw new Error('请使用现有 Worker、D1 和 R2 的真实配置，不能使用占位值。');
if (config.env || db.remote === false || bucket.remote === false) throw new Error('此命令只使用根配置的生产资源，不接受 env 或 local 绑定。');

const apiBase = 'https://api.cloudflare.com/client/v4/accounts/' + accountId;
async function api(path, options = {}, allowMissingWorker = false) {
  const response = await fetch(apiBase + path, {
    ...options,
    headers: {authorization: 'Bearer ' + token, ...(path.startsWith('/r2/') ? {'cf-r2-jurisdiction': bucket.jurisdiction || 'default'} : {}), ...options.headers},
    signal: AbortSignal.timeout(60000),
  });
  const payload = await response.json().catch(() => null);
  if (allowMissingWorker && response.status === 404 && payload?.errors?.some(error => error.code === 10007)) return null;
  if (!response.ok || payload?.success !== true) throw new Error(`Cloudflare 检查未确认成功（HTTP ${response.status}），已停止发布。`);
  return payload.result;
}
async function sql(query) {
  const result = await api('/d1/database/' + db.database_id + '/query', {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({sql: query}),
  });
  if (!Array.isArray(result) || result.some(item => !item.success)) throw new Error('数据库检查未确认成功，已停止发布。');
  return result;
}
function command(args) {
  const result = spawnSync(process.execPath, [resolve(root, 'node_modules/wrangler/bin/wrangler.js'), ...args], {cwd: root, env: process.env, stdio: 'inherit'});
  if (result.status !== 0) throw new Error('更新命令未完成。修复后重新执行正常发布；不要运行清空或初始化命令。');
}
async function preflight() {
  const actualDb = await api('/d1/database/' + db.database_id);
  if (actualDb?.name !== db.database_name) throw new Error('D1 名称与现有数据库不一致，未继续发布。');
  await api('/r2/buckets/' + bucket.bucket_name);
  const settings = await api('/workers/scripts/' + config.name + '/settings', {}, true);
  if (settings) {
    const bindings = settings.bindings || [];
    const hasDataBinding = bindings.some(item => item.name === 'DB' || item.name === 'FILES');
    const tables = await sql("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('payroll_users','payroll_salary_records','payroll_files')");
    let empty = true;
    for (const table of tables[0].results) {
      const count = await sql(`SELECT COUNT(*) AS n FROM ${table.name}`);
      if (Number(count[0].results[0].n) > 0) empty = false;
    }
    // A just-created secret-only Worker can be bound to an empty database.
    // Missing/changed bindings of a populated installation must always stop.
    if (hasDataBinding || !empty) assertBindingsMatch(config, bindings);
  }
  const table = await sql("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'payroll_settings'");
  if (table[0].results.length) {
    const rows = await sql("SELECT key,value FROM payroll_settings WHERE key LIKE 'production_reset_%'");
    assertNoInterruptedReset(rows[0].results);
  }
}
try {
  const migrationDir = resolve(root, db.migrations_dir || 'drizzle');
  const migrations = await Promise.all((await readdir(migrationDir)).filter(name => name.endsWith('.sql')).map(async name => ({name, sql: await readFile(resolve(migrationDir, name), 'utf8')})));
  assertPreservingMigrations(migrations);
  console.log(`保留数据更新：${config.name} / ${db.database_name} / ${bucket.bucket_name}。不会清空账号、工资、审批或附件。`);
  await runPreservingRelease({
    preflight,
    async build() {
      const result = spawnSync('npm', ['run', 'build'], {cwd: root, stdio: 'inherit', env: process.env});
      if (result.status !== 0) throw new Error('构建失败，未修改服务器。');
      const built = JSON.parse(await readFile(resolve(root, 'dist/server/wrangler.json'), 'utf8'));
      if (built.name !== config.name) throw new Error('构建产物 Worker 名称不一致，未发布。');
      assertBindingsMatch(config, [
        ...built.d1_databases.map(item => ({name: item.binding, type: 'd1', id: item.database_id})),
        ...built.r2_buckets.map(item => ({name: item.binding, type: 'r2_bucket', bucket_name: item.bucket_name, jurisdiction: item.jurisdiction})),
      ]);
    },
    async migrate() {command(['d1', 'migrations', 'apply', db.database_name, '--remote', '--config', 'wrangler.jsonc']);},
    async publish() {command(['deploy', '--config', 'dist/server/wrangler.json', '--keep-vars']);},
  });
  console.log('更新完成。原数据库、账号、工资、审批历史及 R2 附件保持不变；已有账号正常登录，无需重新注册。');
} catch (error) {
  console.error(error instanceof Error ? error.message : '发布失败。');
  process.exitCode = 1;
}
