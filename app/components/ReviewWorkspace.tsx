'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const [selectedUserId, setSelectedUserId] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'success' | 'error' | 'info'>('info');
  const requestRevision = useRef(0);

  const load = useCallback(async () => {
    const revision = requestRevision.current + 1;
    requestRevision.current = revision;
    setLoading(true);
    try {
      const [reviewResult, logResult] = await Promise.all([
        apiRequest<{ items: ReviewSalaryItem[] }>('/api/review/salary-records'),
        apiRequest<{ logs: AuditLogItem[] }>('/api/audit/recent'),
      ]);
      if (requestRevision.current === revision) {
        setItems(reviewResult.items);
        setLogs(logResult.logs);
        setSelectedUserId((current) => current && !reviewResult.items.some((item) => item.user.id === current) ? '' : current);
        setMessage('');
      }
    } catch (error) {
      if (requestRevision.current === revision) {
        setTone('error');
        setMessage(errorText(error));
      }
    } finally {
      if (requestRevision.current === revision) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const revision = requestRevision.current + 1;
    requestRevision.current = revision;
    void Promise.all([
      apiRequest<{ items: ReviewSalaryItem[] }>('/api/review/salary-records'),
      apiRequest<{ logs: AuditLogItem[] }>('/api/audit/recent'),
    ]).then(([reviewResult, logResult]) => {
      if (requestRevision.current === revision) {
        setItems(reviewResult.items);
        setLogs(logResult.logs);
        setMessage('');
      }
    }).catch((error) => {
      if (requestRevision.current === revision) {
        setTone('error');
        setMessage(errorText(error));
      }
    }).finally(() => {
      if (requestRevision.current === revision) setLoading(false);
    });
    return () => { requestRevision.current += 1; };
  }, []);

  const accountOptions = useMemo(() => {
    const users = new Map<string, ReviewSalaryItem['user']>();
    for (const item of items) users.set(item.user.id, item.user);
    return [...users.values()].sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-CN'));
  }, [items]);
  const duplicateEmployeeNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const user of accountOptions) counts.set(user.displayName, (counts.get(user.displayName) ?? 0) + 1);
    return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
  }, [accountOptions]);
  const accountMonthItems = useMemo(
    () => items.filter((item) => item.record.workDate.startsWith(month)
      && (!selectedUserId || item.user.id === selectedUserId)),
    [items, month, selectedUserId],
  );
  const visibleItems = useMemo(() => {
    const status = filter === 'pending' ? 2 : filter === 'approved' ? 3 : filter === 'rejected' ? 4 : null;
    return status ? accountMonthItems.filter((item) => item.record.status === status) : accountMonthItems;
  }, [accountMonthItems, filter]);
  const totals = useMemo(() => ({
    pending: summarize(accountMonthItems, 2),
    approved: summarize(accountMonthItems, 3),
    rejected: summarize(accountMonthItems, 4),
  }), [accountMonthItems]);
  const interactionLocked = loading || Boolean(busyId);

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
      setNotes((current) => {
        const next = { ...current };
        delete next[item.record.id];
        return next;
      });
      void apiRequest<{ logs: AuditLogItem[] }>('/api/audit/recent')
        .then((recent) => setLogs(recent.logs))
        .catch(() => undefined);
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
          <label className="review-account-picker">
            <span>查看账号</span>
            <select value={selectedUserId} disabled={interactionLocked} onChange={(event) => setSelectedUserId(event.target.value)}>
              <option value="">全部账号</option>
              {accountOptions.map((user) => <option key={user.id} value={user.id}>
                {user.displayName}{duplicateEmployeeNames.has(user.displayName) ? ` · ${user.email}` : ''}
              </option>)}
            </select>
          </label>
          <label className="month-picker"><span>工作月份</span><input type="month" value={month} disabled={interactionLocked} onChange={(event) => setMonth(event.target.value || currentMonth())} /></label>
          <button type="button" className="secondary-button" onClick={() => void load()} disabled={interactionLocked}>刷新</button>
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
          <button type="button" key={value} disabled={interactionLocked} aria-pressed={filter === value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{label}</button>
        ))}
      </div>

      <StatusMessage message={message} tone={tone} />

      {loading ? <div className="empty-state">正在加载审核队列…</div> : visibleItems.length === 0 ? (
        <div className="empty-state">{selectedUserId ? '该账号在当前月份与状态下没有工资记录。' : '当前月份与状态下没有工资记录。'}</div>
      ) : (
        <div className="review-list">
          {visibleItems.map((item) => {
            const record = item.record;
            const status = STATUS[record.status as SalaryStatus];
            const pending = record.status === 2;
            return (
              <article className={`review-card review-card--${status.tone}`} key={record.id}>
                <header>
                  <div className="review-card__identity">
                    <div><strong>{item.user.displayName}</strong>{duplicateEmployeeNames.has(item.user.displayName) && <small>{item.user.email}</small>}</div>
                    <time dateTime={record.workDate}>{record.workDate}</time>
                  </div>
                  <div className="review-card__headline">
                    <span className="review-card__amount"><Money amount={record.finalSalary} currency={record.currency} /></span>
                    <span className={`status-badge status-badge--${status.tone}`}>{status.label}</span>
                  </div>
                </header>
                <dl>
                  <div><dt>所属部门</dt><dd>{getDepartmentLabel(record.departmentKey, record.departmentLabel)}</dd></div>
                  <div><dt>计费方式</dt><dd>{getApplyTypeLabel(record.applyType)}</dd></div>
                  <div><dt>劳动 / 休息</dt><dd>{formatHours(record.workHours)} / {formatHours(record.restHours)} 小时</dd></div>
                  <div><dt>负责人</dt><dd>{record.checkUser}</dd></div>
                </dl>
                {record.workContent && <p className="review-card__work-content"><b>工作内容</b><span>{record.workContent}</span></p>}
                {record.attachments.length > 0 && <div className="attachment-links"><b>工资附件</b>{record.attachments.map((key, index) => (
                  <a key={key} href={`/api/files?key=${encodeURIComponent(key)}`} target="_blank" rel="noreferrer">附件 {index + 1}</a>
                ))}</div>}
                <details className="review-card__details">
                  <summary>申报信息 · {salarySourceLabel(record.source)}</summary>
                  <div>
                    <span><b>创建人</b>{record.createdByName || item.user.displayName}</span>
                    <span><b>提交人</b>{record.submittedByName || item.user.displayName}</span>
                    {record.memo && <p><b>员工备注</b>{record.memo}</p>}
                  </div>
                </details>
                {pending ? <div className="review-actions">
                  <label><span>审核备注（驳回时必填）</span><textarea maxLength={1000} disabled={interactionLocked} value={notes[record.id] ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [record.id]: event.target.value }))} rows={1} /></label>
                  <div><button type="button" className="secondary-button danger-button" disabled={interactionLocked} onClick={() => void review(item, 'reject')}>驳回</button><button type="button" className="primary-button" disabled={interactionLocked} onClick={() => void review(item, 'approve')}>{busyId === record.id ? '处理中…' : '审核通过'}</button></div>
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

function salarySourceLabel(source: ReviewSalaryItem['record']['source']) {
  return ({
    self: '本人申报',
    'proxy-single': '他人单条代报',
    'proxy-batch': '他人批量代报',
    recurring: '自动规律',
    'gray-seed': '测试数据',
  })[source] ?? '本人申报';
}
