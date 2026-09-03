import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../app/components/DelegatedSalaryWorkspace.tsx', import.meta.url), 'utf8');
const checks = [];

check(
  (source.match(/<TargetPicker\b[^>]*\bdisabled=\{busy\}/g) ?? []).length === 2,
  '单条和批量工作台都会在处理期间禁用账号选择器',
);
check(
  (source.match(/<input type="month" value=\{month\} disabled=\{busy\}/g) ?? []).length === 2,
  '单条和批量工作台都会在处理期间禁用申报月份',
);
check(
  source.includes('requestRevision.current !== revision || selectionRef.current.revision !== selection.revision'),
  '请求结果同时校验请求版本和选择版本',
);
check(
  source.includes('refreshTarget(true, selectionRevision)'),
  '批量操作只能刷新它启动时的账号与月份',
);
check(
  source.includes("rule.submit ? '自动提交' : '保存未提交'"),
  '自动规律卡片显示生成后的提交方式',
);

assert.equal(checks.length, 5);
process.stdout.write(`${JSON.stringify({ result: 'PASS', checks: checks.length }, null, 2)}\n`);

function check(condition, message) {
  assert.ok(condition, message);
  checks.push(message);
}
