import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../app/components/DelegatedSalaryWorkspace.tsx', import.meta.url), 'utf8');
const pageSource = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const payrollSource = await readFile(new URL('../app/components/PayrollWorkspace.tsx', import.meta.url), 'utf8');
const reviewSource = await readFile(new URL('../app/components/ReviewWorkspace.tsx', import.meta.url), 'utf8');
const employeeSource = await readFile(new URL('../app/components/EmployeeWorkspace.tsx', import.meta.url), 'utf8');
const transferSource = await readFile(new URL('../app/components/TransferSheetWorkspace.tsx', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
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
check(
  reviewSource.includes("const [selectedUserId, setSelectedUserId] = useState('');")
    && reviewSource.includes('<option value="">全部账号</option>'),
  '工资审核默认显示全部账号并提供账号筛选器',
);
check(
  reviewSource.includes('<option key={user.id} value={user.id}>')
    && reviewSource.includes('duplicateEmployeeNames.has(user.displayName)'),
  '工资审核使用账号 ID 筛选并在重名时追加邮箱',
);
check(
  reviewSource.includes('(!selectedUserId || item.user.id === selectedUserId)')
    && reviewSource.includes('pending: summarize(accountMonthItems, 2)')
    && reviewSource.includes('approved: summarize(accountMonthItems, 3)')
    && reviewSource.includes('rejected: summarize(accountMonthItems, 4)'),
  '审核列表和三张汇总卡共同使用月份与账号范围',
);
check(
  reviewSource.includes('event.target.value || currentMonth()')
    && reviewSource.includes("!reviewResult.items.some((item) => item.user.id === current) ? '' : current"),
  '月份清空会回退当前月且失效账号会回退全部账号',
);
check(
  reviewSource.includes('requestRevision.current === revision')
    && reviewSource.includes('const interactionLocked = loading || Boolean(busyId);')
    && reviewSource.includes('disabled={interactionLocked}'),
  '审核刷新使用请求版本并在操作期间锁定筛选与审核动作',
);
check(
  reviewSource.includes('review-card__headline')
    && reviewSource.includes('review-card__work-content')
    && reviewSource.includes('review-card__details')
    && styleSource.includes('.review-card__amount { color: var(--xly-navy); font-size: 20px;')
    && styleSource.includes('grid-template-columns: repeat(4, minmax(0, 1fr));')
    && styleSource.includes('.review-actions textarea { min-height: 42px;'),
  '审核卡片突出金额并用紧凑主信息与可展开申报信息缩短高度',
);

assert.equal(checks.length, 18);
process.stdout.write(`${JSON.stringify({ result: 'PASS', checks: checks.length }, null, 2)}\n`);

function check(condition, message) {
  assert.ok(condition, message);
  checks.push(message);
}
