'use client';

import { useCallback, useEffect, useState } from 'react';
import { CircleDollarSign } from 'lucide-react';
import { ApiClientError, apiRequest } from '../lib/api-client';
import { AuditOverview, CurrencyAmounts, currentMonth as getCurrentMonth } from '../lib/payroll';
import { AuditTrailPanel, CurrencyAmountsView } from './payroll-ui';
import { StatusMessage } from './form-controls';

export function AuditWorkspace() {
  const currentMonth = getCurrentMonth();
  const [month, setMonth] = useState(currentMonth);
  const [userId, setUserId] = useState('');
  const [overview, setOverview] = useState<AuditOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const activeMonthlySummaries = overview?.monthlySummaries.filter((summary) => summary.recordCount > 0) ?? [];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ year: month.slice(0, 4), month });
      if (userId) query.set('userId', userId);
      const result = await apiRequest<{ overview: AuditOverview }>(`/api/audit/overview?${query}`);
      setOverview(result.overview);
      setMessage('');
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setLoading(false);
    }
  }, [month, userId]);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ year: month.slice(0, 4), month });
    if (userId) query.set('userId', userId);
    void apiRequest<{ overview: AuditOverview }>(`/api/audit/overview?${query}`)
      .then((result) => { if (!cancelled) { setOverview(result.overview); setMessage(''); } })
      .catch((error) => { if (!cancelled) setMessage(errorText(error)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [month, userId]);

  return (
    <section className="content-card audit-workspace">
      <div className="content-card__heading">
        <div><p className="eyebrow">07 总审计</p><h1>工资统计与审计</h1></div>
        <button type="button" className="secondary-button" disabled={loading} onClick={() => void load()}>刷新</button>
      </div>
      <div className="audit-filters">
        <label><span>月份</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value || currentMonth)} /></label>
        <label><span>员工</span><select value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">全部员工</option>{overview?.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.displayName}</option>)}</select></label>
      </div>
      <StatusMessage message={message} tone="error" />
      {loading && !overview ? <div className="empty-state">正在加载…</div> : overview && <>
        <div className="summary-grid summary-grid--three audit-primary-grid">
          <AuditMetric label={`${overview.month} 已通过`} amounts={overview.monthSummary.approvedAmounts} tone="approved" important />
          <AuditMetric label={`${overview.year} 年已通过`} amounts={overview.yearSummary.approvedAmounts} tone="approved" important />
          <div className="summary-card"><span>当月记录</span><strong>{overview.monthSummary.recordCount} 条</strong></div>
        </div>
        <div className="summary-grid summary-grid--two">
          <AuditMetric label="当月待审核" amounts={overview.monthSummary.pendingAmounts} tone="pending" />
          <AuditMetric label="当月已驳回" amounts={overview.monthSummary.rejectedAmounts} tone="rejected" />
        </div>

        <section className="detail-section"><h3>{overview.year} 年逐月工资</h3>{activeMonthlySummaries.length === 0 ? <div className="empty-state">暂无工资记录。</div> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>月份</th><th>记录</th><th>已申报</th><th>待审</th><th className="table-priority">已通过</th><th>已驳回</th></tr></thead><tbody>{activeMonthlySummaries.map((summary) => <tr key={summary.month}><td>{summary.month}</td><td>{summary.recordCount}</td><td><CurrencyAmountsView amounts={summary.submittedAmounts} /></td><td><CurrencyAmountsView amounts={summary.pendingAmounts} /></td><td className="table-priority"><CurrencyAmountsView amounts={summary.approvedAmounts} /></td><td><CurrencyAmountsView amounts={summary.rejectedAmounts} /></td></tr>)}</tbody></table></div>}</section>

        <section className="detail-section"><h3>{overview.month} 部门支出</h3>{overview.departmentSummaries.length === 0 ? <div className="empty-state">该月份暂无已提交记录。</div> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>工作所属部门</th><th>记录</th><th>申报金额</th><th className="table-priority">已审批支出</th></tr></thead><tbody>{overview.departmentSummaries.map((item) => <tr key={item.departmentLabel}><td>{item.departmentLabel}</td><td>{item.recordCount}</td><td><CurrencyAmountsView amounts={item.submittedAmounts} /></td><td className="table-priority"><CurrencyAmountsView amounts={item.approvedAmounts} /></td></tr>)}</tbody></table></div>}</section>

        <AuditTrailPanel logs={overview.recentLogs} />
        {userId && <AuditTrailPanel logs={overview.accountLogs} title={`${overview.employees.find((employee) => employee.id === userId)?.displayName ?? '账号'} · ${overview.month} 操作记录`} />}
      </>}
    </section>
  );
}

function AuditMetric({ label, amounts, tone, important = false }: { label: string; amounts: CurrencyAmounts; tone?: 'pending' | 'approved' | 'rejected'; important?: boolean }) {
  const classes = ['summary-card', tone ? `summary-card--${tone}` : '', important ? 'summary-card--important' : ''].filter(Boolean).join(' ');
  return <div className={classes}>{important && <CircleDollarSign className="summary-card__icon" size={23} aria-hidden="true" />}<span>{label}</span><strong><CurrencyAmountsView amounts={amounts} /></strong></div>;
}

function errorText(error: unknown) {
  return error instanceof ApiClientError ? error.message : error instanceof Error ? error.message : '请求失败。';
}
