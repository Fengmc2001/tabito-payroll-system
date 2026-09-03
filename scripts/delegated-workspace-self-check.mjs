import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../app/components/DelegatedSalaryWorkspace.tsx', import.meta.url), 'utf8');
const pageSource = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const payrollSource = await readFile(new URL('../app/components/PayrollWorkspace.tsx', import.meta.url), 'utf8');
const employeeSource = await readFile(new URL('../app/components/EmployeeWorkspace.tsx', import.meta.url), 'utf8');
const transferSource = await readFile(new URL('../app/components/TransferSheetWorkspace.tsx', import.meta.url), 'utf8');
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
check(
  pageSource.includes("{ route: '/pay/salary', label: '本人申报'")
    && pageSource.includes("{ route: '/pay/salary/single' as const, label: '他人单条申报'")
    && pageSource.includes("{ route: '/pay/salary/batch' as const, label: '他人多条申报'"),
  '三种工资申报入口属于左侧工资申报子菜单',
);
check(
  pageSource.includes("{ route: '/review/salary', label: '工资审批'")
    && pageSource.includes("{ route: '/review/summary', label: '工资汇总'"),
  '工资审批与工资汇总属于左侧工资审核子菜单',
);
check(
  pageSource.includes("...(privileged ? [")
    && pageSource.includes("(isDelegatedPayrollRoute(route) || isReviewRoute(route)) && activeAccount.role === 'employee'"),
  '特权子菜单和新增深链都受角色权限限制',
);
check(
  !payrollSource.includes('role="tablist"') && !payrollSource.includes('salary-subtabs'),
  '工资申报页面不再保留顶部标签卡',
);
check(
  !employeeSource.includes('/api/staff/transfer-sheet') && !employeeSource.includes('工资汇总'),
  '员工管理不再承载工资汇总功能',
);
check(
  employeeSource.includes('setDetailRevision((current) => current + 1)')
    && employeeSource.includes('[detailRevision, month, selectedId]')
    && !employeeSource.includes('await loadDetail(selectedId)'),
  '员工目录刷新与账号切换统一由可取消的详情请求处理',
);
check(
  transferSource.includes('/api/staff/transfer-sheet?month=')
    && transferSource.includes('导出 Excel')
    && transferSource.includes('requestRevision.current === revision')
    && transferSource.includes('loadedMonth === month ? rows : []')
    && transferSource.includes("setLoadedMonth('')"),
  '独立工资汇总页面保留月份刷新、Excel 导出与月份一致性保护',
);

assert.equal(checks.length, 12);
process.stdout.write(`${JSON.stringify({ result: 'PASS', checks: checks.length }, null, 2)}\n`);

function check(condition, message) {
  assert.ok(condition, message);
  checks.push(message);
}
