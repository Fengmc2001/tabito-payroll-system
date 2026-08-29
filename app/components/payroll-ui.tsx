import { AuditLogItem, CurrencyAmounts, CurrencyCode, formatMoney, getCurrencyLabel } from '../lib/payroll';

export function CurrencyBadge({ currency }: { currency: CurrencyCode }) {
  return <span className={`currency-badge currency-badge--${currency.toLowerCase()}`}>{getCurrencyLabel(currency)}</span>;
}

export function Money({ amount, currency }: { amount: number; currency: CurrencyCode }) {
  return <span className="money-value"><CurrencyBadge currency={currency} /><b>{formatMoney(amount, currency)}</b></span>;
}

export function CurrencyAmountsView({ amounts }: { amounts: CurrencyAmounts }) {
  return (
    <span className="currency-totals">
      <span><CurrencyBadge currency="JPY" />{formatMoney(amounts.JPY, 'JPY')}</span>
      <span><CurrencyBadge currency="CNY" />{formatMoney(amounts.CNY, 'CNY')}</span>
    </span>
  );
}

export function AuditTrailPanel({ logs, title = '最近后台与业务操作' }: { logs: AuditLogItem[]; title?: string }) {
  return (
    <div className="audit-section">
      <div className="section-heading-inline">
        <div><p className="eyebrow">审计追踪</p><h2>{title}</h2></div>
        <span>{logs.length > 10 ? `共 ${logs.length} 条` : `最近 ${logs.length} 条`}</span>
      </div>
      {logs.length === 0 ? <div className="empty-state">暂无审计记录。</div> : (
        <div className="audit-list">
          {logs.map((log) => (
            <article key={log.id}>
              <div><strong>{auditActionLabel(log.action)}</strong><span>{log.actorEmail ?? '系统'}</span></div>
              <div><code>{log.targetType}:{shortId(log.targetId)}</code><time>{new Date(log.createdAt).toLocaleString('zh-CN')}</time></div>
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
    'salary.approve': '工资审核通过',
    'salary.reject': '工资审核驳回',
    'settings.registration_update': '更新注册开关',
    'department.create': '新增部门选项',
    'department.delete': '停用部门选项',
    'file.upload': '上传附件',
    'file.delete': '删除附件',
    'file.read_privileged': '后台读取附件',
  };
  return labels[action] ?? action;
}

function shortId(value: string) {
  return value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}
