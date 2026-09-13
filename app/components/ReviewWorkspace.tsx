'use client';

import { ReviewTable } from './ReviewTable';
import { ReviewFailure, ReviewRejectDialog } from './ReviewRejectDialog';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFeedback, useUnsavedChanges } from './interaction-guards';
import { ApiClientError, apiRequest } from '../lib/api-client';
import {
  AuditLogItem,
  CurrencyAmounts,
  ReviewSalaryItem,
  SalaryStatus,
  currentMonth,
  emptyCurrencyAmounts,
} from '../lib/payroll';
import { AuditTrailPanel, CurrencyAmountsView } from './payroll-ui';
import { StatusMessage } from './form-controls';

type Filter = 'all' | 'pending' | 'approved' | 'rejected' | 'voided';

export function ReviewWorkspace({ administrator = false }: {administrator?: boolean}) {
  const [items, setItems] = useState<ReviewSalaryItem[]>([]);
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const archiveMode = administrator && filter === 'voided';
  const [needsAssignment, setNeedsAssignment] = useState(false);
  const [month, setMonth] = useState(currentMonth);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [rejectItem, setRejectItem] = useState<ReviewSalaryItem|null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage, feedbackRevision] = useFeedback();
  const [tone, setTone] = useState<'success' | 'error' | 'info'>('info');
  const requestRevision = useRef(0);
  const submitting = useRef(false);
  useUnsavedChanges(false, Boolean(busyId));

  const load = useCallback(async (clearMessage = true) => {
    const revision = requestRevision.current + 1;
    requestRevision.current = revision;
    setLoading(true);
    try {
      const [reviewResult, logResult] = await Promise.all([
        apiRequest<{ items: ReviewSalaryItem[] }>(archiveMode ? '/api/review/salary-records?status=5' : '/api/review/salary-records'),
        apiRequest<{ logs: AuditLogItem[] }>('/api/audit/recent'),
      ]);
      if (requestRevision.current === revision) {
        setItems(reviewResult.items);
        setLogs(logResult.logs);
        setSelectedUserId((current) => current && !reviewResult.items.some((item) => item.user.id === current) ? '' : current);
        if (clearMessage) setMessage('');
      }
      return true;
    } catch (error) {
      if (requestRevision.current === revision) {
        setItems([]); setLogs([]);
        setTone('error');
        setMessage(errorText(error));
      }
      return false;
    } finally {
      if (requestRevision.current === revision) setLoading(false);
    }
  }, [setMessage, archiveMode]);

  useEffect(() => {
    const revision = requestRevision.current + 1;
    requestRevision.current = revision;
    void Promise.all([
      apiRequest<{ items: ReviewSalaryItem[] }>(archiveMode ? '/api/review/salary-records?status=5' : '/api/review/salary-records'),
      apiRequest<{ logs: AuditLogItem[] }>('/api/audit/recent'),
    ]).then(([reviewResult, logResult]) => {
      if (requestRevision.current === revision) {
        setItems(reviewResult.items);
        setLogs(logResult.logs);
        setMessage('');
      }
    }).catch((error) => {
      if (requestRevision.current === revision) {
        setItems([]); setLogs([]);
        setTone('error');
        setMessage(errorText(error));
      }
    }).finally(() => {
      if (requestRevision.current === revision) setLoading(false);
    });
    return () => { requestRevision.current += 1; };
  }, [setMessage, archiveMode]);

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
      && (!selectedUserId || item.user.id === selectedUserId)
      && (!needsAssignment || (item.record.status === 2 && (!item.record.reviewerUserId || item.record.reviewerAvailable === false)))),
    [items, month, selectedUserId, needsAssignment],
  );
  const visibleItems = useMemo(() => {
    const status = filter === 'pending' ? 2 : filter === 'approved' ? 3 : filter === 'rejected' ? 4 : filter === 'voided' ? 5 : null;
    return status ? accountMonthItems.filter((item) => item.record.status === status) : accountMonthItems.filter((item) => item.record.status !== 5);
  }, [accountMonthItems, filter]);
  const totals = useMemo(() => ({
    pending: summarize(accountMonthItems, 2),
    approved: summarize(accountMonthItems, 3),
    rejected: summarize(accountMonthItems, 4),
  }), [accountMonthItems]);
  const interactionLocked = loading || Boolean(busyId);

  const review = async (item: ReviewSalaryItem, decision: 'approve' | 'reject', auditMemo = ''): Promise<ReviewFailure|null> => {
    if (submitting.current || loading || item.record.status !== 2) return {message:'正在处理，请稍候。',stale:false};
    if (decision === 'reject' && !auditMemo) {
      return {message:'请填写驳回理由。',stale:false};
    }
    submitting.current = true;
    setBusyId(item.record.id);
    try {
      const result = await apiRequest<{ record: ReviewSalaryItem['record'] }>(
        `/api/review/salary-records/${item.record.id}`,
        { method: 'PATCH', body: { decision, auditMemo, expectedUpdatedAt: item.record.updatedAt } },
      );
      setItems((current) => current.map((candidate) => candidate.record.id === item.record.id
        ? { ...candidate, record: { ...candidate.record, ...result.record } }
        : candidate));
      const refreshed = await load(false);
      setTone(refreshed ? 'success' : 'info');
      setMessage(refreshed ? (decision === 'approve' ? '工资已通过。' : '工资已驳回。') : '审批已保存，但列表刷新失败，请点击刷新。');
      return null;
    } catch (error) {
      const stale = error instanceof ApiClientError && [403,404,409].includes(error.status);
      if (stale) await load(false);
      const message = stale ? `${errorText(error)} 已重新读取列表，请关闭弹窗后核对最新记录。` : errorText(error);
      setTone('error');
      setMessage(message);
      return {message,stale};
    } finally {
      submitting.current = false;
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
              <option value="">{administrator ? '全部账号' : '全部可审核账号'}</option>
              {accountOptions.map((user) => <option key={user.id} value={user.id}>
                {user.displayName}{duplicateEmployeeNames.has(user.displayName) ? ` · ${user.email}` : ''}
              </option>)}
            </select>
          </label>
          <label className="month-picker"><span>工作月份</span><input type="month" value={month} disabled={interactionLocked} onChange={(event) => setMonth(event.target.value || currentMonth())} /></label>
          <button type="button" className="secondary-button" onClick={() => void load()} disabled={interactionLocked}>刷新</button>
        </div>
      </div>

      {!archiveMode && <div className="summary-grid summary-grid--three">
        <ReviewSummary label={`待审核 · ${totals.pending.count} 条`} amounts={totals.pending.amounts} tone="pending" />
        <ReviewSummary label={`已通过 · ${totals.approved.count} 条`} amounts={totals.approved.amounts} tone="approved" />
        <ReviewSummary label={`已驳回 · ${totals.rejected.count} 条`} amounts={totals.rejected.amounts} tone="rejected" />
      </div>}

      {administrator && <label className="access-check"><input type="checkbox" checked={needsAssignment} disabled={interactionLocked} onChange={(event)=>{setNeedsAssignment(event.target.checked);setFilter('all');}} />仅看待分配或审核员失效的申报</label>}
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

      <StatusMessage message={message} eventId={feedbackRevision} tone={tone} />
      {administrator && <button type="button" className="secondary-button archive-toggle" disabled={interactionLocked} onClick={() => {setNeedsAssignment(false); setFilter(archiveMode ? 'all' : 'voided');}}>{archiveMode ? '返回正常申报' : '查看已作废记录'}</button>}
      {archiveMode && <h2>已作废记录 · {visibleItems.length} 条</h2>}

      {loading && items.length === 0 ? <div className="empty-state">正在加载审核队列…</div> : visibleItems.length === 0 ? (
        <div className="empty-state">{selectedUserId ? '该账号在当前月份与状态下没有工资记录。' : '当前月份与状态下没有工资记录。'}</div>
      ) : (
        <ReviewTable key={`${selectedUserId}:${month}:${filter}:${needsAssignment}`} items={visibleItems} administrator={administrator} locked={interactionLocked} busyId={busyId} onApprove={item=>{void review(item,'approve');}} onReject={setRejectItem} onRefresh={async()=>{await load();}}/>
      )}

      {rejectItem && <ReviewRejectDialog item={rejectItem} onClose={()=>setRejectItem(null)} onConfirm={reason=>review(rejectItem,'reject',reason)}/>}

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
