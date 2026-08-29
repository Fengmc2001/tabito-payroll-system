'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiClientError, apiRequest } from '../lib/api-client';
import { AuditOverview, CurrencyAmounts } from '../lib/payroll';
import { AuditTrailPanel, CurrencyAmountsView } from './payroll-ui';
import { StatusMessage } from './form-controls';

export function AuditWorkspace() {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [year, setYear] = useState(currentMonth.slice(0, 4));
  const [month, setMonth] = useState(currentMonth);
  const [userId, setUserId] = useState('');
  const [overview, setOverview] = useState<AuditOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ year, month });
      if (userId) query.set('userId', userId);
      const result = await apiRequest<{ overview: AuditOverview }>(`/api/audit/overview?${query}`);
      setOverview(result.overview);
      setMessage('');
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setLoading(false);
    }
  }, [month, userId, year]);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ year, month });
    if (userId) query.set('userId', userId);
    void apiRequest<{ overview: AuditOverview }>(`/api/audit/overview?${query}`)
      .then((result) => { if (!cancelled) { setOverview(result.overview); setMessage(''); } })
      .catch((error) => { if (!cancelled) setMessage(errorText(error)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [month, userId, year]);

  return (
    <section className="content-card audit-workspace">
      <div className="content-card__heading">
        <div><p className="eyebrow">07 总审计</p><h1>公司工资支出与账号追踪</h1><p>总支出仅按“审核通过”口径统计；人民币与日元始终分开，不做无汇率换算的直接相加。</p></div>
        <button type="button" className="secondary-button" disabled={loading} onClick={() => void load()}>刷新</button>
      </div>
      <div className="audit-filters">
        <label><span>年度</span><input type="number" min="2000" max="2100" value={year} onChange={(event) => { const next = event.target.value.slice(0, 4); setYear(next); if (/^\d{4}$/.test(next)) setMonth(`${next}-${month.slice(5)}`); }} /></label>
        <label><span>工作月份</span><input type="month" value={month} onChange={(event) => { setMonth(event.target.value); setYear(event.target.value.slice(0, 4)); }} /></label>
        <label><span>按账号追踪</span><select value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">不限账号</option>{overview?.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.displayName} · {employee.email}</option>)}</select></label>
      </div>
      <StatusMessage message={message} tone="error" />
      {loading && !overview ? <div className="empty-state">正在生成总审计…</div> : overview && <>
        <div className="summary-grid summary-grid--three">
          <AuditMetric label={`${overview.month} 已审批总支出`} amounts={overview.monthSummary.approvedAmounts} tone="approved" />
          <AuditMetric label={`${overview.year} 年度已审批总支出`} amounts={overview.yearSummary.approvedAmounts} tone="approved" />
          <div className="summary-card"><span>当月记录数</span><strong>{overview.monthSummary.recordCount} 条</strong></div>
        </div>
        <div className="summary-grid summary-grid--three">
          <AuditMetric label="当月待审核" amounts={overview.monthSummary.pendingAmounts} tone="pending" />
          <AuditMetric label="当月已通过" amounts={overview.monthSummary.approvedAmounts} tone="approved" />
          <AuditMetric label="当月已驳回" amounts={overview.monthSummary.rejectedAmounts} tone="rejected" />
        </div>

        <section className="detail-section"><h3>{overview.year} 年逐月工资审计</h3><div className="data-table-wrap"><table className="data-table"><thead><tr><th>月份</th><th>记录</th><th>已申报</th><th>待审</th><th>已通过 / 总支出</th><th>已驳回</th></tr></thead><tbody>{overview.monthlySummaries.map((summary) => <tr key={summary.month}><td>{summary.month}</td><td>{summary.recordCount}</td><td><CurrencyAmountsView amounts={summary.submittedAmounts} /></td><td><CurrencyAmountsView amounts={summary.pendingAmounts} /></td><td><CurrencyAmountsView amounts={summary.approvedAmounts} /></td><td><CurrencyAmountsView amounts={summary.rejectedAmounts} /></td></tr>)}</tbody></table></div></section>

        <section className="detail-section"><h3>{overview.month} 部门支出分解</h3>{overview.departmentSummaries.length === 0 ? <div className="empty-state">该月份暂无已提交记录。</div> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>工作所属部门</th><th>记录</th><th>申报金额</th><th>已审批支出</th></tr></thead><tbody>{overview.departmentSummaries.map((item) => <tr key={item.departmentLabel}><td>{item.departmentLabel}</td><td>{item.recordCount}</td><td><CurrencyAmountsView amounts={item.submittedAmounts} /></td><td><CurrencyAmountsView amounts={item.approvedAmounts} /></td></tr>)}</tbody></table></div>}</section>

        <AuditTrailPanel logs={overview.recentLogs} />
        {userId && <AuditTrailPanel logs={overview.accountLogs} title={`${overview.month} · ${overview.employees.find((employee) => employee.id === userId)?.displayName ?? '账号'} 全部记录`} />}
      </>}
    </section>
  );
}

function AuditMetric({ label, amounts, tone }: { label: string; amounts: CurrencyAmounts; tone?: 'pending' | 'approved' | 'rejected' }) {
  return <div className={tone ? `summary-card summary-card--${tone}` : 'summary-card'}><span>{label}</span><strong><CurrencyAmountsView amounts={amounts} /></strong></div>;
}

function errorText(error: unknown) {
  return error instanceof ApiClientError ? error.message : error instanceof Error ? error.message : '请求失败。';
}
