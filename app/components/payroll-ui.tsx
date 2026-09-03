import { AuditLogItem, CurrencyAmounts, CurrencyCode } from '../lib/payroll';

export function CurrencyBadge({ currency }: { currency: CurrencyCode }) {
  return <span className={`currency-code currency-code--${currency.toLowerCase()}`}>{currency === 'JPY' ? '日元 JPY' : '人民币 CNY'}</span>;
}

export function Money({ amount, currency }: { amount: number; currency: CurrencyCode }) {
  return <span className="money-value"><CurrencyBadge currency={currency} /><b>{formatAmount(amount)}</b></span>;
}

export function CurrencyAmountsView({ amounts }: { amounts: CurrencyAmounts }) {
  const entries = (['JPY', 'CNY'] as CurrencyCode[]).filter((currency) => amounts[currency] !== 0);
  if (entries.length === 0) return <span className="currency-empty">—</span>;
  return (
    <span className="currency-totals">
      {entries.map((currency) => <span key={currency}><CurrencyBadge currency={currency} /><b>{formatAmount(amounts[currency])}</b></span>)}
    </span>
  );
}

export function AuditTrailPanel({ logs, title = '最近后台与业务操作' }: { logs: AuditLogItem[]; title?: string }) {
  return (
    <div className="audit-section">
      <div className="section-heading-inline">
        <div><h2>{title}</h2></div>
        <span>{logs.length > 10 ? `共 ${logs.length} 条` : `最近 ${logs.length} 条`}</span>
      </div>
      {logs.length === 0 ? <div className="empty-state">暂无审计记录。</div> : (
        <div className="audit-list">
          {logs.map((log) => (
            <article key={log.id}>
              <div><strong>{auditActionLabel(log.action)}</strong><span>{log.actorDisplayName || log.actorEmail || '系统'}</span></div>
              <div><span>{auditTargetLabel(log.targetType)}</span><time>{new Date(log.createdAt).toLocaleString('zh-CN')}</time></div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function auditActionLabel(action: string) {
  const labels: Record<string, string> = {
    'account.register': '注册账号',
    'account.permission_update': '更新账号权限',
    'account.password_admin_reset': '管理员重置密码',
    'account.password_change': '用户修改密码',
    'auth.login': '账号登录',
    'auth.login_failed': '登录失败',
    'auth.logout': '账号登出',
    'profile.update': '更新个人资料',
    'salary.create': '新建工资记录',
    'salary.update': '修改工资记录',
    'salary.delete': '删除工资记录',
    'salary.submit': '提交工资审核',
    'salary.proxy_create': '代他人新建工资',
    'salary.proxy_update': '代他人修改工资',
    'salary.proxy_submit': '代他人提交工资',
    'salary.proxy_delete': '代他人删除工资',
    'salary.proxy_batch_create': '批量新建工资',
    'salary.proxy_batch_submit': '批量提交工资',
    'salary.rule_create': '新建自动规律',
    'salary.rule_update': '更新自动规律',
    'salary.rule_pause': '暂停自动规律',
    'salary.rule_delete': '删除自动规律',
    'salary.rule_generate': '自动生成工资',
    'salary.rule_generate_failed': '自动生成失败',
    'salary.approve': '工资审核通过',
    'salary.reject': '工资审核驳回',
    'settings.registration_update': '更新注册开关',
    'department.create': '新增部门选项',
    'department.delete': '停用部门选项',
    'file.upload': '上传附件',
    'file.upload_privileged': '代他人上传附件',
    'file.delete_requested': '移除附件',
    'file.delete': '删除附件',
    'file.read_privileged': '后台读取附件',
  };
  return labels[action] ?? action;
}

function auditTargetLabel(targetType: string) {
  const labels: Record<string, string> = {
    account: '账号',
    authentication: '登录',
    department: '部门',
    file: '附件',
    profile: '个人资料',
    salary: '工资记录',
    salary_record: '工资记录',
    salary_batch: '工资批次',
    recurring_rule: '自动规律',
    session: '登录',
    setting: '系统设置',
    settings: '系统设置',
    user: '账号',
  };
  return labels[targetType] ?? '业务记录';
}

function formatAmount(value: number) {
  const safe = Number.isFinite(value) ? Math.floor(value) : 0;
  return safe.toLocaleString('zh-CN');
}
