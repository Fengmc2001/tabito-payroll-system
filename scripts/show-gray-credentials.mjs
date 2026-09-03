import {
  credentialPath,
  grayBaseUrl,
  loadCredentials,
} from './gray-fixture-common.mjs';

const baseUrl = grayBaseUrl();
const document = await loadCredentials(baseUrl);

process.stdout.write(`${JSON.stringify({
  environment: baseUrl,
  month: document.month,
  credentialsFile: credentialPath,
  warning: '仅限隔离灰度环境；不要复制到源码、工单、截图或生产配置。',
  accounts: document.accounts.map(({ name, email, role, password }) => ({
    name,
    email,
    role,
    password,
  })),
}, null, 2)}\n`);
