import { unlink } from 'node:fs/promises';
import {
  BOOTSTRAP_ADMIN_EMAIL,
  GRAY_CLEAR_CONFIRMATION,
  GRAY_SEED_TAG,
  PayrollClient,
  assert,
  assertGrayMaintenancePreflight,
  credentialPath,
  grayBaseUrl,
  loadCredentials,
} from './gray-fixture-common.mjs';

if (process.env.PAYROLL_GRAY_CONFIRM !== GRAY_CLEAR_CONFIRMATION) {
  throw new Error(`请显式设置 PAYROLL_GRAY_CONFIRM=${GRAY_CLEAR_CONFIRMATION} 后再清除。`);
}

const baseUrl = grayBaseUrl();
const client = new PayrollClient(baseUrl);
const preflight = await client.expect('/api/admin/gray-fixtures', 200);
assertGrayMaintenancePreflight(preflight.data);

const credentials = (await loadCredentials(baseUrl)).accounts;
const adminCredentials = credentials.find((account) => account.role === 'admin');
const reviewerCredentials = credentials.find((account) => account.role === 'reviewer');
assert(adminCredentials && reviewerCredentials, '灰度凭据文件缺少管理员或审核员。');
const admin = await client.login(adminCredentials);
const reviewer = await client.login(reviewerCredentials);

const reviewerDenied = await client.request('/api/admin/gray-fixtures', {
  method: 'DELETE',
  cookie: reviewer.cookie,
  body: { seedTag: GRAY_SEED_TAG, confirmation: GRAY_CLEAR_CONFIRMATION },
});
assert(reviewerDenied.status === 403, '审核员不应能清除灰度数据。');

const badConfirmation = await client.request('/api/admin/gray-fixtures', {
  method: 'DELETE',
  cookie: admin.cookie,
  body: { seedTag: GRAY_SEED_TAG, confirmation: 'NO' },
});
assert(badConfirmation.status === 400, '错误确认口令应被拒绝。');

const cleared = await client.expect('/api/admin/gray-fixtures', 200, {
  method: 'DELETE',
  cookie: admin.cookie,
  body: { seedTag: GRAY_SEED_TAG, confirmation: GRAY_CLEAR_CONFIRMATION },
});
assert(cleared.data.ok === true, '灰度清除未返回成功。');
assert(cleared.data.bootstrap?.bootstrapRequired === true, '清除后没有回到首账号初始化状态。');
assert(
  cleared.data.bootstrap?.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase(),
  '清除后首管理员邮箱不正确。',
);

const bootstrap = await client.expect('/api/bootstrap-status', 200);
assert(bootstrap.data.bootstrap?.bootstrapRequired === true, '公开 bootstrap 状态未恢复为空库。');
assert(
  bootstrap.data.bootstrap?.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase(),
  '公开 bootstrap 邮箱不正确。',
);

const oldBusinessSession = await client.request('/api/admin/users', { cookie: admin.cookie });
assert(oldBusinessSession.status === 401, '清除后旧管理员会话必须失效。');
const retiredMaintenance = await client.request('/api/admin/gray-fixtures');
assert(retiredMaintenance.status === 404, '清除后灰度维护接口必须永久退役。');

let credentialsRemoved = false;
if (process.env.PAYROLL_GRAY_KEEP_CREDENTIALS !== '1') {
  await unlink(credentialPath);
  credentialsRemoved = true;
}

process.stdout.write(`${JSON.stringify({
  result: 'CLEARED',
  baseUrl,
  cleared: cleared.data.cleared,
  deletedObjects: cleared.data.deletedObjects,
  bootstrap: bootstrap.data.bootstrap,
  credentialsFile: credentialPath,
  credentialsRemoved,
  maintenanceRetired: true,
  nextStep: '由部署者注册固定首管理员；正式部署时仍建议将 DEPLOYMENT_STAGE 设为 production。',
}, null, 2)}\n`);
