'use client';

import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { FileNameInput, Field, FormSection, StatusMessage, invalidFormControlMessage } from './form-controls';
import { apiRequest } from '../lib/api-client';
import {
  APPLY_TYPES,
  CURRENCIES,
  CurrencyAmounts,
  DepartmentOption,
  SALARY_TEXT_MAX_LENGTH,
  SalaryRecord,
  STATUS,
  WorkManagerOption,
  cloneAsDraft,
  currentMonth,
  createRecord,
  emptyCurrencyAmounts,
  formatHours,
  getApplyTypeLabel,
  getDepartmentLabel,
  monthDateRange,
  nextPaymentDate,
  recalculateRecord,
  SalaryApplyType,
} from '../lib/payroll';
import { CurrencyAmountsView, Money } from './payroll-ui';

export const TIME_OPTIONS = Array.from({ length: 289 }, (_, index) => {
  const hours = Math.floor(index / 12);
  const minutes = (index % 12) * 5;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
});

export const REST_OPTIONS = Array.from({ length: 289 }, (_, index) => {
  const hours = Math.floor(index / 12);
  const minutes = (index % 12) * 5;
  return { value: Number((index / 12).toFixed(2)), label: `${hours} 小时 ${String(minutes).padStart(2, '0')} 分钟` };
});

export function SalaryWorkspace({
  userId,
  records,
  onSave,
  onDelete,
  onApply,
  onRefresh,
  onUpload,
  embedded = false,
}: {
  userId: string;
  records: SalaryRecord[];
  onSave: (record: SalaryRecord) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onApply: (month: string) => Promise<number>;
  onRefresh: () => Promise<void>;
  onUpload?: (file: File) => Promise<string>;
  embedded?: boolean;
}) {
  const naturalMonth = currentMonth();
  const [month, setMonth] = useState(naturalMonth);
  const [editing, setEditing] = useState<SalaryRecord | null>(null);
  const [notice, setNotice] = useState('');
  const [noticeTone, setNoticeTone] = useState<'success' | 'error' | 'info'>('info');
  const [busy, setBusy] = useState(false);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [workManagers, setWorkManagers] = useState<WorkManagerOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    void apiRequest<{ departments: DepartmentOption[]; workManagers: WorkManagerOption[] }>('/api/payroll-options')
      .then((result) => { if (!cancelled) { setDepartments(result.departments); setWorkManagers(result.workManagers); } })
      .catch((error) => {
        if (!cancelled) {
          setNoticeTone('error');
          setNotice(messageFrom(error));
        }
      });
    return () => { cancelled = true; };
  }, []);
  const currentRecords = records
    .filter((record) => record.workDate.startsWith(month))
    .sort((left, right) => right.workDate.localeCompare(left.workDate));
  const drafts = currentRecords.filter((record) => record.status === 1);
  const pending = currentRecords.filter((record) => record.status === 2);
  const approved = currentRecords.filter((record) => record.status === 3);
  const rejected = currentRecords.filter((record) => record.status === 4);
  const summary = useMemo(() => summarize(currentRecords), [currentRecords]);

  const openNewRecord = () => {
    const record = createRecord(userId);
    if (!record.workDate.startsWith(month)) record.workDate = `${month}-01`;
    setEditing(record);
  };

  const save = (next: SalaryRecord) => {
    setBusy(true);
    void onSave(next).then(() => {
      setEditing(null);
      setNoticeTone('success');
      setNotice('工资记录已保存。');
    }).catch((error) => {
      setNoticeTone('error');
      setNotice(messageFrom(error));
    }).finally(() => setBusy(false));
  };

  const remove = (id: string) => {
    setBusy(true);
    void onDelete(id).then(() => {
      setNoticeTone('success');
      setNotice('未提交记录已删除。');
    }).catch((error) => {
      setNoticeTone('error');
      setNotice(messageFrom(error));
    }).finally(() => setBusy(false));
  };

  const copy = (record: SalaryRecord) => {
    const copyDraft = cloneAsDraft(record, userId);
    if (!departments.some((department) => department.key === copyDraft.departmentKey)) {
      copyDraft.departmentKey = '';
      copyDraft.departmentLabel = '';
    }
    const manager = workManagers.find((item) => item.id === copyDraft.checkUserId || item.label === copyDraft.checkUser);
    copyDraft.checkUserId = manager?.id ?? '';
    copyDraft.checkUser = manager?.label ?? '';
    setEditing(copyDraft);
    setNoticeTone('info');
    setNotice('已复制为一条新的未提交记录。');
  };

  const apply = () => {
    if (drafts.length === 0) {
      setNoticeTone('info');
      setNotice('没有可提交的工资记录。');
      return;
    }
    setBusy(true);
    void onApply(month).then((count) => {
      setNoticeTone('success');
      setNotice(`已提交 ${month} 的 ${count} 条记录，等待审核。`);
    }).catch((error) => {
      setNoticeTone('error');
      setNotice(messageFrom(error));
    }).finally(() => setBusy(false));
  };

  const refresh = () => {
    setBusy(true);
    void onRefresh().then(() => {
      setNoticeTone('success');
      setNotice(`${month} 的工资状态已刷新。`);
    }).catch((error) => {
      setNoticeTone('error');
      setNotice(messageFrom(error));
    }).finally(() => setBusy(false));
  };

  return (
    <section className="content-card salary-workspace">
      <div className="content-card__heading salary-workspace__heading">
        <div>
          {!embedded && <p className="eyebrow">02 工资申报</p>}
          {embedded ? <h2 className="workspace-panel-title">本人申报</h2> : <h1>本期工资申报</h1>}
        </div>
        <div className="heading-actions">
          <label className="month-picker"><span>申报月份</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value || naturalMonth)} /></label>
          <button type="button" className="secondary-button" disabled={busy} onClick={refresh}>刷新状态</button>
          <button type="button" className="secondary-button" disabled={busy} onClick={openNewRecord}>+ 新建工资记录</button>
          <button type="button" className="primary-button" disabled={busy} onClick={apply}>{busy ? '处理中…' : '提交本期记录'}</button>
        </div>
      </div>

      <div className="summary-grid summary-grid--five">
        <SummaryCard label={`${month} 全部记录`} value={<CurrencyAmountsView amounts={summary.total} />} />
        <SummaryCard label="未提交" value={<CurrencyAmountsView amounts={summary.draft} />} tone="draft" />
        <SummaryCard label="待审核" value={<CurrencyAmountsView amounts={summary.pending} />} tone="pending" />
        <SummaryCard label="已通过" value={<CurrencyAmountsView amounts={summary.approved} />} tone="approved" />
        <SummaryCard label="已驳回" value={<CurrencyAmountsView amounts={summary.rejected} />} tone="rejected" />
      </div>

      <StatusMessage message={notice} tone={noticeTone} />

      <section className="salary-draft-section">
        <div className="salary-record-section__heading"><div><h2>未提交记录</h2></div><span>{drafts.length} 条</span></div>
        <SalaryTable records={drafts} onEdit={setEditing} onCopy={copy} onDelete={remove} emptyMessage="本月没有未提交记录。" />
      </section>

      <div className="salary-status-sections">
        <SalaryStatusSection tone="pending" title="待审核" records={pending} onCopy={copy} />
        <SalaryStatusSection tone="rejected" title="已驳回" records={rejected} onCopy={copy} />
        <SalaryStatusSection tone="approved" title="已通过" records={approved} onCopy={copy} />
      </div>

      {editing && (
        <SalaryRecordDialog
          key={editing.id}
          initial={editing}
          departments={departments}
          workManagers={workManagers}
          onClose={() => setEditing(null)}
          onSave={save}
          onUpload={onUpload}
        />
      )}
    </section>
  );
}

export function SalaryHistory({ records }: { records: SalaryRecord[] }) {
  const [month, setMonth] = useState(currentMonth);
  const approved = records
    .filter((record) => record.status === 3 && record.workDate.startsWith(month))
    .sort((left, right) => right.workDate.localeCompare(left.workDate));
  const totalSalary = sumAmounts(approved);
  const totalHours = approved.reduce((sum, record) => sum + record.workHours, 0);
  const totalRest = approved.reduce((sum, record) => sum + record.restHours, 0);

  return (
    <section className="content-card history-workspace">
      <div className="content-card__heading history-workspace__heading">
        <div>
          <p className="eyebrow">03 往期工资</p>
          <h1>往期工资一览</h1>
        </div>
        <label className="month-picker">
          <span>月份</span>
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
      </div>

      <div className="summary-grid summary-grid--three">
        <SummaryCard label="审核通过工资" value={<CurrencyAmountsView amounts={totalSalary} />} tone="approved" />
        <SummaryCard label="劳动时间" value={`${formatHours(totalHours)} 小时`} />
        <SummaryCard label="休息时间" value={`${formatHours(totalRest)} 小时`} />
      </div>

      {approved.length === 0 ? (
        <div className="empty-state">该月份还没有审核通过的工资记录。</div>
      ) : (
        <div className="history-list">
          {approved.map((record) => (
            <article key={record.id} className="history-item">
              <div className="history-item__topline">
                <strong>{record.workDate}</strong>
                <span className="status-badge status-badge--approved">审核通过</span>
              </div>
              <dl>
                <div><dt>工作负责人</dt><dd>{record.checkUser || '-'}</dd></div>
                <div><dt>工作所属部门</dt><dd>{getDepartmentLabel(record.departmentKey, record.departmentLabel)}</dd></div>
                <div><dt>计费方式</dt><dd>{getApplyTypeLabel(record.applyType)}</dd></div>
                <div><dt>工作收入</dt><dd><Money amount={record.finalSalary} currency={record.currency} /></dd></div>
                <div><dt>劳动/休息</dt><dd>{formatHours(record.workHours)} / {formatHours(record.restHours)} 小时</dd></div>
                <div><dt>支付日</dt><dd>{nextPaymentDate(record.workDate)}</dd></div>
              </dl>
              {(record.workContent || record.memo || record.auditMemo) && (
                <div className="history-item__notes">
                  {record.workContent && <p><b>工作内容：</b>{record.workContent}</p>}
                  {record.memo && <p><b>备注：</b>{record.memo}</p>}
                  {record.auditMemo && <p><b>审核备注：</b>{record.auditMemo}</p>}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: 'draft' | 'pending' | 'approved' | 'rejected';
}) {
  return (
    <div className={tone ? `summary-card summary-card--${tone}` : 'summary-card'}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function SalaryTable({
  records,
  onEdit,
  onCopy,
  onDelete,
  readOnly = false,
  emptyMessage = '尚未创建工资记录。',
}: {
  records: SalaryRecord[];
  onEdit?: (record: SalaryRecord) => void;
  onCopy?: (record: SalaryRecord) => void;
  onDelete?: (id: string) => void;
  readOnly?: boolean;
  emptyMessage?: string;
}) {
  if (records.length === 0) {
    return <div className="empty-state empty-state--compact">{emptyMessage}</div>;
  }

  const hasActions = !readOnly && Boolean(onEdit || onCopy || onDelete);

  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>日期</th>
            <th>工作负责人</th>
            <th>工作所属部门</th>
            <th>计费方式</th>
            <th>工作收入</th>
            <th>状态</th>
            {hasActions && <th>操作</th>}
          </tr>
        </thead>
        <tbody>
          {records.map((record) => {
            const status = STATUS[record.status];
            return (
              <tr key={record.id}>
                <td>{record.workDate}</td>
                <td>{record.checkUser || '-'}</td>
                <td>{getDepartmentLabel(record.departmentKey, record.departmentLabel)}</td>
                <td>{getApplyTypeLabel(record.applyType)}</td>
                <td><Money amount={record.finalSalary} currency={record.currency} /></td>
                <td>
                  <span className={`status-badge status-badge--${status.tone}`}>{status.label}</span>
                  {record.auditMemo && <small className="salary-audit-note">{record.auditMemo}</small>}
                </td>
                {hasActions && <td>
                  <div className="row-actions">
                    {record.status === 1 && onEdit && <button type="button" onClick={() => onEdit(record)}>编辑</button>}
                    {onCopy && <button type="button" onClick={() => onCopy(record)}>复制</button>}
                    {record.status === 1 && onDelete && <button type="button" className="danger-text" onClick={() => onDelete(record.id)}>删除</button>}
                  </div>
                </td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function SalaryStatusSection({
  tone,
  title,
  records,
  onCopy,
}: {
  tone: 'pending' | 'approved' | 'rejected';
  title: string;
  records: SalaryRecord[];
  onCopy: (record: SalaryRecord) => void;
}) {
  return (
    <section className={`salary-record-section salary-record-section--${tone}`}>
      <div className="salary-record-section__heading">
        <div><h2>{title}</h2><CurrencyAmountsView amounts={sumAmounts(records)} /></div>
        <span>{records.length} 条</span>
      </div>
      <SalaryTable
        records={records}
        onCopy={onCopy}
        emptyMessage={`本月没有${title.replace(' · ', '')}记录。`}
      />
    </section>
  );
}

export function SalaryRecordDialog({
  initial,
  departments,
  workManagers,
  onClose,
  onSave,
  onUpload,
  title,
  month,
  allowDirectSubmit = false,
  directSubmitDisabled = false,
}: {
  initial: SalaryRecord;
  departments: DepartmentOption[];
  workManagers: WorkManagerOption[];
  onClose: () => void;
  onSave: (record: SalaryRecord, submit?: boolean) => void;
  onUpload?: (file: File) => Promise<string>;
  title?: string;
  month?: string;
  allowDirectSubmit?: boolean;
  directSubmitDisabled?: boolean;
}) {
  const [draft, setDraft] = useState(() => {
    const manager = workManagers.find((item) => item.id === initial.checkUserId || item.label === initial.checkUser);
    return recalculateRecord({ ...initial, checkUserId: manager?.id ?? '', checkUser: manager?.label ?? '' });
  });
  const [error, setError] = useState('');
  const allowedTypes = APPLY_TYPES.map((item) => item.value);
  const showRate = draft.applyType !== 5;
  const showTime = draft.applyType === 1 || draft.applyType === 7;
  const showAmount = [2, 3, 4].includes(draft.applyType);
  const showTravel = [1, 2, 3, 5].includes(draft.applyType);

  const update = <K extends keyof SalaryRecord>(field: K, value: SalaryRecord[K]) => {
    setDraft((current) => {
      const next = { ...current, [field]: value };
      if (field === 'departmentKey') {
        const nextDepartment = departments.find((item) => item.key === value);
        next.departmentLabel = nextDepartment?.label ?? '';
      }
      if (field === 'checkUserId') {
        const manager = workManagers.find((item) => item.id === value);
        next.checkUser = manager?.label ?? '';
      }
      if (field === 'applyType' && value !== 1 && value !== 7) next.restHours = 0;
      return recalculateRecord(next);
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const completed = recalculateRecord(draft);
    if (!completed.workDate || !completed.checkUserId || !completed.checkUser || !completed.departmentKey) {
      setError('日期、工作负责人和工作所属部门为必填项。');
      return;
    }
    if (showTime && (!completed.startTime || !completed.endTime || completed.totalHours <= 0)) {
      setError('请填写同一天内、结束时间晚于开始时间的工作时间；跨日工作请拆分记录。');
      return;
    }
    if (showTime && completed.restHours > completed.totalHours) {
      setError('中间休息时间不能超过开始至结束的总时长。');
      return;
    }
    if (completed.applyType === 7 && !completed.workContent.trim()) {
      setError('“其他”计费方式必须填写工作内容。');
      return;
    }
    if (completed.departmentKey === 'dept-special' && !completed.workContent.trim() && !completed.memo.trim()) {
      setError('“特殊（具体备注）”必须填写具体工作内容或备注。');
      return;
    }
    if (completed.finalSalary > 100_000_000) {
      setError('工资金额不能超过 100,000,000；请检查单价、数量和交通费。');
      return;
    }
    setError('');
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    onSave(completed, submitter?.dataset.submit === 'pending');
  };

  const reportInvalid = (event: FormEvent<HTMLFormElement>) => {
    setError(invalidFormControlMessage(event));
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="record-modal" role="dialog" aria-modal="true" aria-labelledby="record-dialog-title">
        <header className="record-modal__header">
          <div>
            <h2 id="record-dialog-title">{title ?? (initial.createdAt === initial.updatedAt ? '新建工资记录' : '编辑工资记录')}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="关闭" onClick={onClose}>×</button>
        </header>

        <form onSubmit={submit} onInvalidCapture={reportInvalid}>
          <div className="record-modal__body">
            <FormSection title="工作信息">
              <div className="form-grid form-grid--two">
                <Field label="日期" required>
                  <input
                    type="date"
                    min={month ? `${month}-01` : undefined}
                    max={month ? monthDateRange(month)?.end : undefined}
                    value={draft.workDate}
                    onChange={(event) => update('workDate', event.target.value)}
                    required
                  />
                </Field>
                <Field label="工作负责人" required>
                  <select value={draft.checkUserId} onChange={(event) => update('checkUserId', event.target.value)} required>
                    <option value="">请选择</option>
                    {workManagers.map((manager) => {
                      const duplicatedName = workManagers.some((item) => item.id !== manager.id && item.label === manager.label);
                      return <option key={manager.id} value={manager.id}>{manager.label}{duplicatedName ? `（${manager.email}）` : ''}</option>;
                    })}
                  </select>
                </Field>
                <Field label="工作所属部门" required>
                  <select value={draft.departmentKey} onChange={(event) => update('departmentKey', event.target.value)} required>
                    <option value="">请选择</option>
                    {departments.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                  </select>
                </Field>
                <Field label="货币" required>
                  <select value={draft.currency} onChange={(event) => update('currency', event.target.value as SalaryRecord['currency'])} required>
                    {CURRENCIES.map((item) => <option key={item.value} value={item.value}>{item.label} {item.value}</option>)}
                  </select>
                </Field>
                <Field label="计费方式" required>
                  <select value={draft.applyType} onChange={(event) => update('applyType', Number(event.target.value) as SalaryApplyType)} disabled={!draft.departmentKey}>
                    {allowedTypes.map((type) => <option key={type} value={type}>{getApplyTypeLabel(type)}</option>)}
                  </select>
                </Field>
                <Field label="工作内容" required={draft.applyType === 7}>
                  <textarea rows={3} maxLength={SALARY_TEXT_MAX_LENGTH} value={draft.workContent} onChange={(event) => update('workContent', event.target.value)} />
                </Field>
                <Field label="备注">
                  <textarea rows={3} maxLength={SALARY_TEXT_MAX_LENGTH} value={draft.memo} onChange={(event) => update('memo', event.target.value)} />
                </Field>
              </div>
            </FormSection>

            <FormSection title="计费与时间">
              <div className="salary-calculation">
                <span><b>总时长</b>{formatHours(draft.totalHours)} 小时</span>
                <span><b>休息时间</b>{formatHours(draft.restHours)} 小时</span>
                <span><b>计薪劳动时间</b>{formatHours(draft.workHours)} 小时</span>
                <span className="salary-calculation__result"><b>工作收入</b><Money amount={draft.finalSalary} currency={draft.currency} /></span>
              </div>
              <div className="form-grid form-grid--two">
                {showRate && (
                  <Field label="工作单价" required>
                    <input type="number" min="0" max="10000000" step="1" value={draft.rate} onChange={(event) => update('rate', Number(event.target.value))} />
                  </Field>
                )}
                {showTime && (
                  <Field label="开始时间" required>
                    <select value={draft.startTime} onChange={(event) => update('startTime', event.target.value)}>
                      <option value="">请选择</option>
                      {TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}
                    </select>
                  </Field>
                )}
                {showTime && (
                  <Field label="结束时间" required>
                    <select value={draft.endTime} onChange={(event) => update('endTime', event.target.value)}>
                      <option value="">请选择</option>
                      {TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}
                    </select>
                  </Field>
                )}
                {showTime && (
                  <Field label="中间休息时间" hint="从工作时长中扣除。">
                    <select value={draft.restHours} onChange={(event) => update('restHours', Number(event.target.value))}>
                      {REST_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </Field>
                )}
                {showAmount && (
                  <Field label={draft.applyType === 2 ? '件数' : draft.applyType === 3 ? '字数' : '人数'} required>
                    <input type="number" min="0" max="10000000" step="1" value={draft.amount} onChange={(event) => update('amount', Number(event.target.value))} />
                  </Field>
                )}
                {showTravel && (
                  <Field label="交通起点">
                    <input maxLength={300} value={draft.travelStart} onChange={(event) => update('travelStart', event.target.value)} />
                  </Field>
                )}
                {showTravel && (
                  <Field label="交通终点">
                    <input maxLength={300} value={draft.travelEnd} onChange={(event) => update('travelEnd', event.target.value)} />
                  </Field>
                )}
                {showTravel && (
                  <Field label="交通费（往返）">
                    <input type="number" min="0" max="10000000" step="1" value={draft.travelFee} onChange={(event) => update('travelFee', Number(event.target.value))} />
                  </Field>
                )}
                <Field label="附件">
                  <FileNameInput value={draft.attachments} maximum={8} onUpload={onUpload} onChange={(files) => update('attachments', files)} />
                </Field>
              </div>
            </FormSection>
          </div>
          <footer className="record-modal__footer">
            <StatusMessage message={error} tone="error" />
            <div>
              <button type="button" className="secondary-button" onClick={onClose}>取消</button>
              {allowDirectSubmit ? <>
                <button type="submit" className="secondary-button" data-submit="draft">保存为未提交</button>
                <button type="submit" className="primary-button" data-submit="pending" disabled={directSubmitDisabled}>保存并提交审核</button>
              </> : <button type="submit" className="primary-button">保存</button>}
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}

export function summarize(records: SalaryRecord[]) {
  return records.reduce(
    (summary, record) => {
      summary.total[record.currency] += record.finalSalary;
      if (record.status === 1) summary.draft[record.currency] += record.finalSalary;
      if (record.status === 2) summary.pending[record.currency] += record.finalSalary;
      if (record.status === 3) summary.approved[record.currency] += record.finalSalary;
      if (record.status === 4) summary.rejected[record.currency] += record.finalSalary;
      return summary;
    },
    {
      total: emptyCurrencyAmounts(),
      draft: emptyCurrencyAmounts(),
      pending: emptyCurrencyAmounts(),
      approved: emptyCurrencyAmounts(),
      rejected: emptyCurrencyAmounts(),
    },
  );
}

export function sumAmounts(records: SalaryRecord[]): CurrencyAmounts {
  return records.reduce((totals, record) => {
    totals[record.currency] += record.finalSalary;
    return totals;
  }, emptyCurrencyAmounts());
}

export function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请稍后重试。';
}
