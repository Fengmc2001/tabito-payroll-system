'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClientError, apiRequest } from '../lib/api-client';
import {
  AuditLogItem,
  CurrencyAmounts,
  ReviewSalaryItem,
  SalaryStatus,
  STATUS,
  currentMonth,
  emptyCurrencyAmounts,
  formatHours,
  getApplyTypeLabel,
  getDepartmentLabel,
} from '../lib/payroll';
import { AuditTrailPanel, CurrencyAmountsView, Money } from './payroll-ui';
import { StatusMessage } from './form-controls';

type Filter = 'all' | 'pending' | 'approved' | 'rejected';

export function ReviewWorkspace() {
  const [items, setItems] = useState<ReviewSalaryItem[]>([]);
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [month, setMonth] = useState(currentMonth);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'success' | 'error' | 'info'>('info');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [reviewResult, logResult] = await Promise.all([
        apiRequest<{ items: ReviewSalaryItem[] }>('/api/review/salary-records'),
        apiRequest<{ logs: AuditLogItem[] }>('/api/audit/recent'),
      ]);
      setItems(reviewResult.items);
      setLogs(logResult.logs);
    } catch (error) {
      setTone('error');
      setMessage(errorText(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      apiRequest<{ items: ReviewSalaryItem[] }>('/api/review/salary-records'),
      apiRequest<{ logs: AuditLogItem[] }>('/api/audit/recent'),
    ]).then(([reviewResult, logResult]) => {
      if (!cancelled) {
        setItems(reviewResult.items);
        setLogs(logResult.logs);
      }
    }).catch((error) => {
      if (!cancelled) {
        setTone('error');
        setMessage(errorText(error));
      }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const monthItems = useMemo(
    () => items.filter((item) => item.record.workDate.startsWith(month)),
    [items, month],
  );
  const visibleItems = useMemo(() => {
    const status = filter === 'pending' ? 2 : filter === 'approved' ? 3 : filter === 'rejected' ? 4 : null;
    return status ? monthItems.filter((item) => item.record.status === status) : monthItems;
  }, [filter, monthItems]);
  const totals = useMemo(() => ({
    pending: summarize(monthItems, 2),
    approved: summarize(monthItems, 3),
    rejected: summarize(monthItems, 4),
  }), [monthItems]);
  const duplicateEmployeeNames = useMemo(() => {
    const users = new Map(items.map((item) => [item.user.id, item.user]));
    const counts = new Map<string, number>();
    for (const user of users.values()) counts.set(user.displayName, (counts.get(user.displayName) ?? 0) + 1);
    return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
  }, [items]);

  const review = async (item: ReviewSalaryItem, decision: 'approve' | 'reject') => {
    const auditMemo = notes[item.record.id]?.trim() ?? '';
    if (decision === 'reject' && !auditMemo) {
      setTone('error');
      setMessage('驳回时必须填写审核备注。');
      return;
    }
    setBusyId(item.record.id);
    try {
      const result = await apiRequest<{ record: ReviewSalaryItem['record'] }>(
        `/api/review/salary-records/${item.record.id}`,
        { method: 'PATCH', body: { decision, auditMemo } },
      );
      setItems((current) => current.map((candidate) => candidate.record.id === item.record.id
        ? { ...candidate, record: result.record }
        : candidate));
      setTone('success');
      setMessage(decision === 'approve'
        ? '工资已通过。'
        : '工资已驳回。');
      const recent = await apiRequest<{ logs: AuditLogItem[] }>('/api/audit/recent');
      setLogs(recent.logs);
    } catch (error) {
      setTone('error');
      setMessage(errorText(error));
    } finally {
      setBusyId('');
    }
  };

  return (
    <section className="content-card review-workspace">
      <div className="content-card__heading">
        <div>
          <p className="eyebrow">04 工资审核</p>
          <h1>工资审核工作台</h1>
        </div>
        <div className="heading-actions">
          <label className="month-picker"><span>工作月份</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
          <button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>刷新</button>
        </div>
      </div>

      <div className="summary-grid summary-grid--three">
        <ReviewSummary label={`待审核 · ${totals.pending.count} 条`} amounts={totals.pending.amounts} tone="pending" />
        <ReviewSummary label={`已通过 · ${totals.approved.count} 条`} amounts={totals.approved.amounts} tone="approved" />
        <ReviewSummary label={`已驳回 · ${totals.rejected.count} 条`} amounts={totals.rejected.amounts} tone="rejected" />
      </div>

      <div className="filter-bar" role="group" aria-label="审核状态筛选">
        {([
          ['all', '全部'],
          ['pending', '待审核'],
          ['approved', '已通过'],
          ['rejected', '已驳回'],
        ] as Array<[Filter, string]>).map(([value, label]) => (
          <button type="button" key={value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{label}</button>
        ))}
      </div>

      <StatusMessage message={message} tone={tone} />

      {loading ? <div className="empty-state">正在加载审核队列…</div> : visibleItems.length === 0 ? (
        <div className="empty-state">当前月份与筛选下没有工资记录。</div>
      ) : (
        <div className="review-list">
          {visibleItems.map((item) => {
            const record = item.record;
            const status = STATUS[record.status as SalaryStatus];
            const pending = record.status === 2;
            return (
              <article className="review-card" key={record.id}>
                <header>
                  <div><strong>{item.user.displayName}</strong>{duplicateEmployeeNames.has(item.user.displayName) && <small>{item.user.email}</small>}</div>
                  <span className={`status-badge status-badge--${status.tone}`}>{status.label}</span>
                </header>
                <dl>
                  <div><dt>工作日期</dt><dd>{record.workDate}</dd></div>
                  <div><dt>负责人</dt><dd>{record.checkUser}</dd></div>
                  <div><dt>所属部门</dt><dd>{getDepartmentLabel(record.departmentKey, record.departmentLabel)}</dd></div>
                  <div><dt>计费方式</dt><dd>{getApplyTypeLabel(record.applyType)}</dd></div>
                  <div><dt>劳动 / 休息</dt><dd>{formatHours(record.workHours)} / {formatHours(record.restHours)} 小时</dd></div>
                  <div><dt>工资金额</dt><dd className="review-card__amount"><Money amount={record.finalSalary} currency={record.currency} /></dd></div>
                </dl>
                {(record.workContent || record.memo) && <div className="review-card__copy">
                  {record.workContent && <p><b>工作内容：</b>{record.workContent}</p>}
                  {record.memo && <p><b>员工备注：</b>{record.memo}</p>}
                </div>}
                {record.attachments.length > 0 && <div className="attachment-links"><b>工资附件</b>{record.attachments.map((key, index) => (
                  <a key={key} href={`/api/files?key=${encodeURIComponent(key)}`} target="_blank" rel="noreferrer">附件 {index + 1}</a>
                ))}</div>}
                {pending ? <div className="review-actions">
                  <label><span>审核备注（驳回时必填）</span><textarea maxLength={1000} value={notes[record.id] ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [record.id]: event.target.value }))} rows={2} /></label>
                  <div><button type="button" className="secondary-button danger-button" disabled={busyId === record.id} onClick={() => void review(item, 'reject')}>驳回</button><button type="button" className="primary-button" disabled={busyId === record.id} onClick={() => void review(item, 'approve')}>{busyId === record.id ? '处理中…' : '审核通过'}</button></div>
                </div> : record.auditMemo ? <p className="audit-memo"><b>审核备注：</b>{record.auditMemo}</p> : null}
              </article>
            );
          })}
        </div>
      )}

      <AuditTrailPanel logs={logs} />
    </section>
  );
}

function ReviewSummary({ label, amounts, tone }: { label: string; amounts: CurrencyAmounts; tone: 'pending' | 'approved' | 'rejected' }) {
  return <div className={`summary-card summary-card--${tone}`}><span>{label}</span><strong><CurrencyAmountsView amounts={amounts} /></strong></div>;
}

function summarize(items: ReviewSalaryItem[], status: SalaryStatus) {
  const selected = items.filter((item) => item.record.status === status);
  return {
    count: selected.length,
    amounts: selected.reduce((amounts, item) => {
      amounts[item.record.currency] += item.record.finalSalary;
      return amounts;
    }, emptyCurrencyAmounts()),
  };
}

function errorText(error: unknown) {
  return error instanceof ApiClientError ? error.message : error instanceof Error ? error.message : '请求失败。';
}
