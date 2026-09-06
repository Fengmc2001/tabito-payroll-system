import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appPath } from '../app/lib/app-path.ts';
import { minimalPdf } from './gray-fixture-common.mjs';

const baseUrl = new URL(process.env.PAYROLL_TEST_BASE_URL || 'http://127.0.0.1:3503/payroll');
assert(['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname), 'Use an isolated localhost database only.');
assert(baseUrl.pathname.replace(/\/$/, '') === '/payroll', 'Run the app with NEXT_PUBLIC_BASE_PATH=/payroll.');
const password = process.env.PAYROLL_TEST_ADMIN_PASSWORD;
assert(password, 'Set PAYROLL_TEST_ADMIN_PASSWORD.');
const prefix = baseUrl.pathname.replace(/\/$/, '');
let cookie = '';
let checks = 0;
async function api(path, options = {}) {
  const response = await fetch(baseUrl.origin + appPath(path, prefix), {
    ...options, headers: { cookie, ...options.headers },
  });
  assert.equal(response.status, options.method === 'POST' && path === '/api/uploads' ? 201 : 200);
  checks++;
  return response;
}
const loginBody = JSON.stringify({
  email: 'TabitoAdimin01@tabitoedu.com',
  passwordDigest: createHash('sha256').update(password).digest('hex'),
});
const login = await api('/api/users/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: loginBody });
cookie = login.headers.get('set-cookie').split(';')[0];
const account = (await login.json()).account;
const secondLogin = await api('/api/users/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: loginBody });
assert.equal((await secondLogin.json()).account.profileVersion, account.profileVersion, 'Another login must not invalidate the profile version');
checks++;
const bytes = minimalPdf('SUBPATH-REGRESSION-TEST-ONLY');
const form = new FormData();
form.set('file', new File([bytes], 'subpath-regression.pdf', { type: 'application/pdf' }));
const uploaded = await (await api('/api/uploads', { method: 'POST', body: form })).json();
const key = uploaded.file.key;
const rows = (await (await api('/api/staff/transfer-sheet?month=2026-09')).json()).rows;
assert(rows.find((row) => row.user.id === account.id).pdfFiles.some((file) => file.key === key));
checks++;
const file = await api('/api/files?key=' + encodeURIComponent(key));
assert.match(file.headers.get('content-type'), /application\/pdf/);
assert.deepEqual(Buffer.from(await file.arrayBuffer()), Buffer.from(bytes), 'Downloaded bytes must match the uploaded PDF');
checks += 2;
// Only the newly created, unreferenced local test file is removed.
await api('/api/files?key=' + encodeURIComponent(key), { method: 'DELETE' });
process.stdout.write(JSON.stringify({ result: 'PASS', checks, prefix, pdfBytesVerified: true }) + '\n');
