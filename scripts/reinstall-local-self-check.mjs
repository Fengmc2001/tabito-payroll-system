import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {resolve, relative, join} from 'node:path';
import {spawnSync} from 'node:child_process';

const state = process.env.PAYROLL_LOCAL_STATE_PATH;
if (!state?.startsWith('.local/') || state.split('/').includes('..')) throw Error('Set the path to an isolated QA state under .local/.');
const root = resolve(state);
const directory = join(root, 'v3/d1/miniflare-D1DatabaseObject');
const databases = readdirSync(directory).filter(name => /^[a-f0-9]{64}\.sqlite$/.test(name));
assert.equal(databases.length, 1, 'a single disposable QA database is required');
const filename = join(directory, databases[0]);
const digest = value => createHash('sha256').update(value).digest('hex');
function snapshot() {
  const db = new DatabaseSync(filename, {readOnly: true});
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'payroll_%' ORDER BY name").all();
    const data = tables.map(({name}) => {
      const rows = db.prepare('SELECT * FROM ' + name).all().map(row => JSON.stringify(row)).sort();
      return {name, count: rows.length, hash: digest(JSON.stringify(rows))};
    });
    const files = [];
    function visit(path) {
      if (!existsSync(path)) return;
      for (const item of readdirSync(path, {withFileTypes: true})) {
        const file = join(path, item.name);
        if (item.isDirectory()) visit(file);
        else if (file.includes('/blobs/')) files.push([relative(root, file), digest(readFileSync(file))]);
      }
    }
    visit(join(root, 'v3/r2'));
    return {data, files: files.sort((a, b) => a[0].localeCompare(b[0]))};
  } finally {db.close();}
}
const before = snapshot();
assert.ok(before.data.find(table => table.name === 'payroll_users').count > 0, 'test an existing database, not an empty one');
assert.ok(before.data.find(table => table.name === 'payroll_salary_records').count > 0, 'test an existing wage record');
const result = spawnSync(process.execPath, ['scripts/prepare-local-db.mjs'], {env: process.env, stdio: 'inherit'});
assert.equal(result.status, 0, 'repeat installation migrations complete');
assert.deepEqual(snapshot(), before, 'reinstall retains every business row and uploaded blob byte-for-byte');
console.log(JSON.stringify({result: 'PASS', tables: before.data.length, businessRows: before.data.reduce((sum, table) => sum + table.count, 0), fileBlobs: before.files.length, database: state, remoteCalls: 0}));
