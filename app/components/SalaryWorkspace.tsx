'use client';

import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { FileNameInput, Field, FormSection, StatusMessage } from './form-controls';
import { apiRequest } from '../lib/api-client';
import {
  APPLY_TYPES,
  CHECK_USERS,
  CURRENCIES,
  CurrencyAmounts,
  DepartmentOption,
  SalaryRecord,
  STATUS,
  cloneAsDraft,
  currentMonth,
  createRecord,
  emptyCurrencyAmounts,
  formatHours,
  formatMoney,
  getApplyTypeLabel,
  getDepartmentLabel,
  nextPaymentDate,
  recalculateRecord,
  SalaryApplyType,
} from '../lib/payroll';
import { CurrencyAmountsView, Money } from './payroll-ui';

const TIME_OPTIONS = Array.from({ length: 289 }, (_, index) => {
  const hours = Math.floor(index / 12);
  const minutes = (index % 12) * 5;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
});

export function SalaryWorkspace({
  userId,
  records,
  onSave,
  onDelete,
  onApply,
  onRefresh,
  onUpload,
}: {
  userId: string;
  records: SalaryRecord[];
  onSave: (record: SalaryRecord) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onApply: (month: string) => Promise<number>;
  onRefresh: () => Promise<void>;
  onUpload?: (file: File) => Promise<string>;
}) {
  const naturalMonth = currentMonth();
  const [month, setMonth] = useState(naturalMonth);
  const [editing, setEditing] = useState<SalaryRecord | null>(null);
  const [notice, setNotice] = useState('');
  const [noticeTone, setNoticeTone] = useState<'success' | 'error' | 'info'>('info');
  const [busy, setBusy] = useState(false);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    void apiRequest<{ departments: DepartmentOption[] }>('/api/payroll-options')
      .then((result) => { if (!cancelled) setDepartments(result.departments); })
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
      setNotice('工资记录已保存，金额已由服务器重新核算。');
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
          <p className="eyebrow">工资申报</p>
          <h1>本期工资申报</h1>
          <p>请核对工作日期、所属部门、计费方式和附件后再提交审核。</p>
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
        <SummaryCard label="已提交 / 待审核" value={<CurrencyAmountsView amounts={summary.pending} />} tone="pending" />
        <SummaryCard label="已审核 / 通过" value={<CurrencyAmountsView amounts={summary.approved} />} tone="approved" />
        <SummaryCard label="已驳回" value={<CurrencyAmountsView amounts={summary.rejected} />} tone="rejected" />
      </div>

      <StatusMessage message={notice} tone={noticeTone} />

      <div className="info-callout">
        <strong>申报说明</strong>
        <span>跨日工作请拆分为两条记录。</span>
      </div>

      <section className="salary-draft-section">
        <div className="salary-record-section__heading"><div><h2>未提交记录</h2><p>只有这里的记录可以编辑、删除或提交。</p></div><span>{drafts.length} 条</span></div>
        <SalaryTable records={drafts} onEdit={setEditing} onCopy={copy} onDelete={remove} emptyMessage="本月没有未提交记录。" />
      </section>

      <div className="salary-status-sections">
        <SalaryStatusSection tone="pending" title="已提交 · 待审核" records={pending} onCopy={copy} />
        <SalaryStatusSection tone="rejected" title="已驳回" records={rejected} onCopy={copy} />
        <SalaryStatusSection tone="approved" title="已审核 · 通过" records={approved} onCopy={copy} />
      </div>

      {editing && (
        <SalaryRecordDialog
          key={editing.id}
          initial={editing}
          departments={departments}
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
          <p className="eyebrow">工资历史</p>
          <h1>往期工资一览</h1>
          <p>只展示审核通过的工资记录。</p>
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

function SummaryCard({
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

function SalaryTable({
  records,
  onEdit,
  onCopy,
  onDelete,
  emptyMessage = '尚未创建工资记录。',
}: {
  records: SalaryRecord[];
  onEdit: (record: SalaryRecord) => void;
  onCopy: (record: SalaryRecord) => void;
  onDelete: (id: string) => void;
  emptyMessage?: string;
}) {
  if (records.length === 0) {
    return <div className="empty-state empty-state--compact">{emptyMessage}</div>;
  }

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
            <th aria-label="操作" />
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
                <td><span className={`status-badge status-badge--${status.tone}`}>{status.label}</span></td>
                <td>
                  <div className="row-actions">
                    {record.status === 1 && <button type="button" onClick={() => onEdit(record)}>编辑</button>}
                    <button type="button" onClick={() => onCopy(record)}>复制</button>
                    {record.status === 1 && <button type="button" className="danger-text" onClick={() => onDelete(record.id)}>删除</button>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SalaryStatusSection({
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
        onEdit={() => undefined}
        onCopy={onCopy}
        onDelete={() => undefined}
        emptyMessage={`本月没有${title.replace(' · ', '')}记录。`}
      />
    </section>
  );
}

function SalaryRecordDialog({
  initial,
  departments,
  onClose,
  onSave,
  onUpload,
}: {
  initial: SalaryRecord;
  departments: DepartmentOption[];
  onClose: () => void;
  onSave: (record: SalaryRecord) => void;
  onUpload?: (file: File) => Promise<string>;
}) {
  const [draft, setDraft] = useState(() => recalculateRecord(initial));
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
      return recalculateRecord(next);
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const completed = recalculateRecord({ ...draft, updatedAt: new Date().toISOString() });
    if (!completed.workDate || !completed.checkUser || !completed.departmentKey) {
      setError('日期、工作负责人和工作所属部门为必填项。');
      return;
    }
    if (showTime && (!completed.startTime || !completed.endTime || completed.workHours <= 0)) {
      setError('请填写同一天内、结束时间晚于开始时间的工作时间；跨日工作请拆分记录。');
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
    onSave(completed);
  };

  const reportInvalid = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const control = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const label = control.closest('label')?.querySelector('.form-field__label')?.textContent?.replace('*', '').trim() || '该字段';
    const message = control.validity.rangeOverflow
      ? `不能超过 ${control.getAttribute('max')}。`
      : control.validity.rangeUnderflow
        ? `不能低于 ${control.getAttribute('min')}。`
        : control.validity.tooLong
          ? `不能超过 ${control.getAttribute('maxlength')} 个字符。`
          : control.validity.valueMissing
            ? '为必填项。'
            : '填写内容不符合要求。';
    setError(`${label}${message}`);
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="record-modal" role="dialog" aria-modal="true" aria-labelledby="record-dialog-title">
        <header className="record-modal__header">
          <div>
            <p className="eyebrow">工资记录</p>
            <h2 id="record-dialog-title">{initial.createdAt === initial.updatedAt ? '新建工资记录' : '编辑工资记录'}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="关闭" onClick={onClose}>×</button>
        </header>

        <form onSubmit={submit} onInvalidCapture={reportInvalid}>
          <div className="record-modal__body">
            <FormSection title="工作信息">
              <div className="form-grid form-grid--two">
                <Field label="日期" required>
                  <input type="date" value={draft.workDate} onChange={(event) => update('workDate', event.target.value)} required />
                </Field>
                <Field label="工作负责人" required>
                  <select value={draft.checkUser} onChange={(event) => update('checkUser', event.target.value)} required>
                    <option value="">请选择</option>
                    {CHECK_USERS.map((user) => <option key={user} value={user}>{user}</option>)}
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
                    {CURRENCIES.map((item) => <option key={item.value} value={item.value}>{item.label}（{item.symbol}）</option>)}
                  </select>
                </Field>
                <Field label="计费方式" required>
                  <select value={draft.applyType} onChange={(event) => update('applyType', Number(event.target.value) as SalaryApplyType)} disabled={!draft.departmentKey}>
                    {allowedTypes.map((type) => <option key={type} value={type}>{getApplyTypeLabel(type)}</option>)}
                  </select>
                </Field>
                <Field label="工作内容" required={draft.applyType === 7}>
                  <textarea rows={3} maxLength={2000} value={draft.workContent} onChange={(event) => update('workContent', event.target.value)} />
                </Field>
                <Field label="备注">
                  <textarea rows={3} maxLength={2000} value={draft.memo} onChange={(event) => update('memo', event.target.value)} />
                </Field>
              </div>
            </FormSection>

            <FormSection title="计费与时间">
              <div className="salary-calculation">
                <span><b>劳动时间</b>{formatHours(draft.workHours)} 小时</span>
                <span><b>休息时间</b>{formatHours(draft.restHours)} 小时</span>
                <span className="salary-calculation__result"><b>工作收入</b>{formatMoney(draft.finalSalary, draft.currency)}</span>
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
              <button type="submit" className="primary-button">保存</button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}

function summarize(records: SalaryRecord[]) {
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

function sumAmounts(records: SalaryRecord[]): CurrencyAmounts {
  return records.reduce((totals, record) => {
    totals[record.currency] += record.finalSalary;
    return totals;
  }, emptyCurrencyAmounts());
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请稍后重试。';
}
