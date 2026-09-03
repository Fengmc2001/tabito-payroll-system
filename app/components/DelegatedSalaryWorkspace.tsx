'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, Pause, Play, RefreshCw, Trash2 } from 'lucide-react';
import { apiRequest } from '../lib/api-client';
import {
  APPLY_TYPES,
  CURRENCIES,
  CurrencyCode,
  DepartmentOption,
  FixedPayrollSchedule,
  ManagedUser,
  PayrollBatchMode,
  PayrollScheduleSession,
  ProxyPayrollBatchInput,
  RecurringPayrollRule,
  SALARY_TEXT_MAX_LENGTH,
  SalaryApplyType,
  SalaryRecord,
  WorkManagerOption,
  cloneAsDraft,
  createRecord,
  currentMonth,
  expandFixedPayrollSchedule,
  formatHours,
  getApplyTypeLabel,
  getDepartmentLabel,
  monthDateRange,
  recalculateRecord,
} from '../lib/payroll';
import { CurrencyAmountsView, Money } from './payroll-ui';
import { Field, FormSection, StatusMessage, invalidFormControlMessage } from './form-controls';
import {
  REST_OPTIONS,
  SalaryRecordDialog,
  SalaryStatusSection,
  SalaryTable,
  SummaryCard,
  TIME_OPTIONS,
  messageFrom,
  summarize,
} from './SalaryWorkspace';

const WEEKDAYS = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 0, label: '周日' },
];

type DelegatedSelection = {
  targetUserId: string;
  month: string;
  revision: number;
};

export function DelegatedSalaryWorkspace({
  currentUserId,
  mode,
}: {
  currentUserId: string;
  mode: 'single' | 'batch';
}) {
  const naturalMonth = currentMonth();
  const [month, setMonth] = useState(naturalMonth);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [targetUserId, setTargetUserId] = useState('');
  const [records, setRecords] = useState<SalaryRecord[]>([]);
  const [rules, setRules] = useState<RecurringPayrollRule[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [workManagers, setWorkManagers] = useState<WorkManagerOption[]>([]);
  const [editing, setEditing] = useState<SalaryRecord | null>(null);
  const [notice, setNotice] = useState('');
  const [noticeTone, setNoticeTone] = useState<'success' | 'error' | 'info'>('info');
  const [busy, setBusy] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const requestRevision = useRef(0);
  const selectionRef = useRef<DelegatedSelection>({ targetUserId: '', month: naturalMonth, revision: 0 });
  const target = users.find((user) => user.id === targetUserId) ?? null;

  const updateSelection = useCallback((values: Partial<Pick<DelegatedSelection, 'targetUserId' | 'month'>>) => {
    const current = selectionRef.current;
    const nextTargetUserId = values.targetUserId ?? current.targetUserId;
    const nextMonth = values.month ?? current.month;
    if (nextTargetUserId === current.targetUserId && nextMonth === current.month) return current;
    const next = { targetUserId: nextTargetUserId, month: nextMonth, revision: current.revision + 1 };
    selectionRef.current = next;
    requestRevision.current += 1;
    setSelectionRevision(next.revision);
    return next;
  }, []);

  const isSelectionCurrent = useCallback((revision: number) => selectionRef.current.revision === revision, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      apiRequest<{ users: ManagedUser[] }>('/api/staff/payroll/users'),
      apiRequest<{ departments: DepartmentOption[]; workManagers: WorkManagerOption[] }>('/api/payroll-options'),
    ]).then(([userResult, optionResult]) => {
      if (cancelled) return;
      const others = userResult.users.filter((user) => user.id !== currentUserId);
      setUsers(others);
      setDepartments(optionResult.departments);
      setWorkManagers(optionResult.workManagers);
      const nextTargetUserId = selectionRef.current.targetUserId
        || others.find((user) => user.status === 'active' && user.role === 'employee')?.id
        || others[0]?.id
        || '';
      updateSelection({ targetUserId: nextTargetUserId });
      setTargetUserId(nextTargetUserId);
      setInitialized(true);
    }).catch((error) => {
      if (!cancelled) {
        setNoticeTone('error');
        setNotice(messageFrom(error));
        setInitialized(true);
      }
    });
    return () => { cancelled = true; };
  }, [currentUserId, updateSelection]);

  const fetchTargetData = useCallback(async (selection: DelegatedSelection) => {
    if (!selection.targetUserId) {
      return { records: [] as SalaryRecord[], rules: [] as RecurringPayrollRule[] };
    }
    const [recordResult, ruleResult] = await Promise.all([
      apiRequest<{ records: SalaryRecord[] }>(`/api/staff/payroll/records?userId=${encodeURIComponent(selection.targetUserId)}&month=${encodeURIComponent(selection.month)}`),
      apiRequest<{ rules: RecurringPayrollRule[] }>(`/api/staff/payroll/rules?userId=${encodeURIComponent(selection.targetUserId)}`),
    ]);
    return { records: recordResult.records, rules: ruleResult.rules };
  }, []);

  const refreshTarget = useCallback(async (quiet = false, expectedSelectionRevision?: number) => {
    const selection = selectionRef.current;
    if (expectedSelectionRevision !== undefined && selection.revision !== expectedSelectionRevision) return false;
    const revision = ++requestRevision.current;
    if (!quiet) setBusy(true);
    try {
      const result = await fetchTargetData(selection);
      if (requestRevision.current !== revision || selectionRef.current.revision !== selection.revision) return false;
      setRecords(result.records);
      setRules(result.rules);
      if (!quiet) {
        setNoticeTone('success');
        setNotice(`${selection.month} 的记录已刷新。`);
      }
      return true;
    } catch (error) {
      if (requestRevision.current === revision && selectionRef.current.revision === selection.revision) {
        setNoticeTone('error');
        setNotice(messageFrom(error));
      }
      return false;
    } finally {
      if (!quiet) setBusy(false);
    }
  }, [fetchTargetData]);

  useEffect(() => {
    const selection = selectionRef.current;
    const revision = ++requestRevision.current;
    void fetchTargetData(selection).then((result) => {
      if (requestRevision.current !== revision || selectionRef.current.revision !== selection.revision) return;
      setRecords(result.records);
      setRules(result.rules);
    }).catch((error) => {
      if (requestRevision.current !== revision || selectionRef.current.revision !== selection.revision) return;
      setNoticeTone('error');
      setNotice(messageFrom(error));
    });
  }, [fetchTargetData, month, targetUserId]);

  const changeMonth = (value: string) => {
    if (busy) return;
    const nextMonth = value || naturalMonth;
    updateSelection({ month: nextMonth });
    setMonth(nextMonth);
    setRecords([]);
    setNotice('');
    setEditing(null);
  };

  const changeTarget = (value: string) => {
    if (busy) return;
    updateSelection({ targetUserId: value });
    setTargetUserId(value);
    setRecords([]);
    setRules([]);
    setNotice('');
    setEditing(null);
  };

  const newRecord = () => {
    if (!target || target.status !== 'active') {
      setNoticeTone('error');
      setNotice('请选择正常状态的账号。');
      return;
    }
    const record = defaultTargetRecord(target.id, month, departments, workManagers, currentUserId);
    setEditing(record);
  };

  const saveSingle = async (record: SalaryRecord, submit = false) => {
    const selection = selectionRef.current;
    setBusy(true);
    try {
      const exists = records.some((item) => item.id === record.id);
      await apiRequest(exists ? `/api/staff/payroll/records/${record.id}` : '/api/staff/payroll/records', {
        method: exists ? 'PATCH' : 'POST',
        body: { targetUserId: selection.targetUserId, record, submit },
      });
      if (!isSelectionCurrent(selection.revision)) return;
      setEditing(null);
      if (!await refreshTarget(true, selection.revision)) return;
      setNoticeTone('success');
      setNotice(submit ? '已为该员工提交这条记录。' : '已保存为未提交记录。');
    } catch (error) {
      if (isSelectionCurrent(selection.revision)) {
        setNoticeTone('error');
        setNotice(messageFrom(error));
      }
    } finally {
      setBusy(false);
    }
  };

  const deleteSingle = async (id: string) => {
    const selection = selectionRef.current;
    const record = records.find((item) => item.id === id);
    setBusy(true);
    try {
      if (!record) throw new Error('该记录已不在当前列表中，请刷新后重试。');
      await apiRequest(`/api/staff/payroll/records/${id}?userId=${encodeURIComponent(selection.targetUserId)}&updatedAt=${encodeURIComponent(record.updatedAt)}`, { method: 'DELETE' });
      if (!await refreshTarget(true, selection.revision)) return;
      setNoticeTone('success');
      setNotice('未提交记录已删除。');
    } catch (error) {
      if (isSelectionCurrent(selection.revision)) {
        setNoticeTone('error');
        setNotice(messageFrom(error));
      }
    } finally {
      setBusy(false);
    }
  };

  const copySingle = (record: SalaryRecord) => {
    const copied = cloneAsDraft(record, targetUserId);
    if (!copied.workDate.startsWith(month)) copied.workDate = `${month}-01`;
    setEditing(copied);
  };

  const uploadForTarget = async (file: File) => {
    const formData = new FormData();
    formData.set('file', file);
    const result = await apiRequest<{ file: { key: string } }>(`/api/staff/payroll/uploads/${targetUserId}`, {
      method: 'POST',
      formData,
    });
    return result.file.key;
  };

  return <section className="content-card delegated-workspace">
    {mode === 'single' ? <SingleWorkspace
      month={month}
      setMonth={changeMonth}
      users={users}
      targetUserId={targetUserId}
      setTargetUserId={changeTarget}
      target={target}
      records={records}
      busy={busy}
      notice={notice}
      noticeTone={noticeTone}
      onRefresh={() => void refreshTarget()}
      onNew={newRecord}
      onEdit={setEditing}
      onCopy={copySingle}
      onDelete={deleteSingle}
    /> : initialized ? <BatchWorkspace
      key={`${targetUserId}:${month}`}
      month={month}
      setMonth={changeMonth}
      users={users}
      targetUserId={targetUserId}
      setTargetUserId={changeTarget}
      target={target}
      records={records}
      rules={rules}
      departments={departments}
      workManagers={workManagers}
      currentUserId={currentUserId}
      selectionRevision={selectionRevision}
      isSelectionCurrent={isSelectionCurrent}
      busy={busy}
      notice={notice}
      noticeTone={noticeTone}
      setBusy={setBusy}
      setNotice={setNotice}
      setNoticeTone={setNoticeTone}
      refreshTarget={refreshTarget}
    /> : <div className="empty-state empty-state--compact" role="status">正在载入申报设置…</div>}
    {editing && <SalaryRecordDialog
      key={editing.id}
      initial={editing}
      title={`为 ${target?.displayName ?? '他人'} ${records.some((item) => item.id === editing.id) ? '编辑' : '新增'}工资`}
      month={month}
      departments={departments}
      workManagers={workManagers}
      allowDirectSubmit
      directSubmitDisabled={!target?.profileReady || target.status !== 'active'}
      onClose={() => setEditing(null)}
      onSave={(record, submit) => void saveSingle(record, Boolean(submit))}
      onUpload={uploadForTarget}
    />}
  </section>;
}

function SingleWorkspace({
  month,
  setMonth,
  users,
  targetUserId,
  setTargetUserId,
  target,
  records,
  busy,
  notice,
  noticeTone,
  onRefresh,
  onNew,
  onEdit,
  onCopy,
  onDelete,
}: {
  month: string;
  setMonth: (value: string) => void;
  users: ManagedUser[];
  targetUserId: string;
  setTargetUserId: (value: string) => void;
  target: ManagedUser | null;
  records: SalaryRecord[];
  busy: boolean;
  notice: string;
  noticeTone: 'success' | 'error' | 'info';
  onRefresh: () => void;
  onNew: () => void;
  onEdit: (record: SalaryRecord) => void;
  onCopy: (record: SalaryRecord) => void;
  onDelete: (id: string) => void;
}) {
  const summary = useMemo(() => summarize(records), [records]);
  const drafts = records.filter((record) => record.status === 1);
  const pending = records.filter((record) => record.status === 2);
  const approved = records.filter((record) => record.status === 3);
  const rejected = records.filter((record) => record.status === 4);
  return <>
    <div className="content-card__heading salary-workspace__heading">
      <div><h2 className="workspace-panel-title">他人单条申报</h2></div>
      <div className="heading-actions">
        <TargetPicker users={users} value={targetUserId} onChange={setTargetUserId} disabled={busy} />
        <label className="month-picker"><span>申报月份</span><input type="month" value={month} disabled={busy} onChange={(event) => setMonth(event.target.value || currentMonth())} /></label>
        <button type="button" className="secondary-button button-with-icon" disabled={busy || !targetUserId} onClick={onRefresh}><RefreshCw size={15} />刷新</button>
        <button type="button" className="primary-button" disabled={busy || !target || target.status !== 'active'} onClick={onNew}>+新增一条</button>
      </div>
    </div>
    {target && (!target.profileReady || target.status !== 'active') && <StatusMessage
      tone="error"
      message={target.status !== 'active' ? '该账号已停用，只能查看历史记录。' : '该员工的收款资料尚未完成，可保存草稿，暂不能提交审核。'}
    />}
    <StatusMessage message={notice} tone={noticeTone} />
    <div className="summary-grid summary-grid--five">
      <SummaryCard label={`${month} 全部记录`} value={<CurrencyAmountsView amounts={summary.total} />} />
      <SummaryCard label="未提交" value={<CurrencyAmountsView amounts={summary.draft} />} tone="draft" />
      <SummaryCard label="待审核" value={<CurrencyAmountsView amounts={summary.pending} />} tone="pending" />
      <SummaryCard label="已通过" value={<CurrencyAmountsView amounts={summary.approved} />} tone="approved" />
      <SummaryCard label="已驳回" value={<CurrencyAmountsView amounts={summary.rejected} />} tone="rejected" />
    </div>
    <section className="salary-draft-section">
      <div className="salary-record-section__heading"><div><h2>未提交记录</h2></div><span>{drafts.length} 条</span></div>
      <SalaryTable records={drafts} onEdit={onEdit} onCopy={onCopy} onDelete={onDelete} emptyMessage="本月没有未提交记录。" />
    </section>
    <div className="salary-status-sections">
      <SalaryStatusSection tone="pending" title="待审核" records={pending} onCopy={onCopy} />
      <SalaryStatusSection tone="rejected" title="已驳回" records={rejected} onCopy={onCopy} />
      <SalaryStatusSection tone="approved" title="已通过" records={approved} onCopy={onCopy} />
    </div>
  </>;
}

function BatchWorkspace({
  month,
  setMonth,
  users,
  targetUserId,
  setTargetUserId,
  target,
  records,
  rules,
  departments,
  workManagers,
  currentUserId,
  selectionRevision,
  isSelectionCurrent,
  busy,
  notice,
  noticeTone,
  setBusy,
  setNotice,
  setNoticeTone,
  refreshTarget,
}: {
  month: string;
  setMonth: (value: string) => void;
  users: ManagedUser[];
  targetUserId: string;
  setTargetUserId: (value: string) => void;
  target: ManagedUser | null;
  records: SalaryRecord[];
  rules: RecurringPayrollRule[];
  departments: DepartmentOption[];
  workManagers: WorkManagerOption[];
  currentUserId: string;
  selectionRevision: number;
  isSelectionCurrent: (revision: number) => boolean;
  busy: boolean;
  notice: string;
  noticeTone: 'success' | 'error' | 'info';
  setBusy: (value: boolean) => void;
  setNotice: (value: string) => void;
  setNoticeTone: (value: 'success' | 'error' | 'info') => void;
  refreshTarget: (quiet?: boolean, expectedSelectionRevision?: number) => Promise<boolean>;
}) {
  const range = monthDateRange(month)!;
  const [batchMode, setBatchMode] = useState<PayrollBatchMode>('fixed');
  const [template, setTemplate] = useState(() => defaultTargetRecord(targetUserId, month, departments, workManagers, currentUserId));
  const [fixed, setFixed] = useState<FixedPayrollSchedule>(() => defaultFixedSchedule(month));
  const [calendarSessions, setCalendarSessions] = useState<PayrollScheduleSession[]>([
    { workDate: `${month}-01`, startTime: '18:00', endTime: '20:00', restHours: 0 },
  ]);
  const [submitNow, setSubmitNow] = useState(true);
  const [saveRule, setSaveRule] = useState(false);
  const [ruleTitle, setRuleTitle] = useState('');
  const [ruleEndMonth, setRuleEndMonth] = useState('');
  const [requestId, setRequestId] = useState(() => newBatchRequestId());

  const updateTemplate = <K extends keyof SalaryRecord>(field: K, value: SalaryRecord[K]) => {
    setTemplate((current) => {
      const next = { ...current, [field]: value };
      if (field === 'departmentKey') next.departmentLabel = departments.find((item) => item.key === value)?.label ?? '';
      if (field === 'checkUserId') next.checkUser = workManagers.find((item) => item.id === value)?.label ?? '';
      if (field === 'applyType' && value !== 1 && value !== 7) next.restHours = 0;
      return recalculateRecord(next);
    });
  };

  const sessions = useMemo(() => batchMode === 'fixed'
    ? expandFixedPayrollSchedule(month, fixed)
    : calendarSessions.filter((session) => session.workDate.startsWith(month)), [batchMode, calendarSessions, fixed, month]);
  const preview = useMemo(() => sessions.map((session) => recalculateRecord({
    ...template,
    workDate: session.workDate,
    startTime: session.startTime,
    endTime: session.endTime,
    restHours: session.restHours,
  })), [sessions, template]);
  const previewTotals = preview.reduce<Record<CurrencyCode, number>>((totals, record) => {
    totals[record.currency] += record.finalSalary;
    return totals;
  }, { JPY: 0, CNY: 0 });

  const submitBatch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!targetUserId || !target) {
      setNoticeTone('error');
      setNotice('请选择申报对象。');
      return;
    }
    if (sessions.length === 0) {
      setNoticeTone('error');
      setNotice('当前日期设置没有可生成的记录。');
      return;
    }
    setBusy(true);
    try {
      const input: ProxyPayrollBatchInput = {
        requestId,
        targetUserId,
        month,
        mode: batchMode,
        submit: submitNow,
        template,
        fixedSchedule: batchMode === 'fixed' ? fixed : undefined,
        calendarSessions: batchMode === 'calendar' ? calendarSessions : undefined,
        recurring: {
          enabled: batchMode === 'fixed' && saveRule,
          title: ruleTitle,
          startMonth: month,
          endMonth: ruleEndMonth,
        },
      };
      const result = await apiRequest<{ records: SalaryRecord[]; replayed: boolean }>('/api/staff/payroll/batches', {
        method: 'POST',
        body: input,
      });
      if (!await refreshTarget(true, selectionRevision)) return;
      setRequestId(newBatchRequestId());
      setNoticeTone('success');
      setNotice(result.replayed
        ? '该批次已处理，未重复生成。'
        : `已为 ${target.displayName} ${submitNow ? '提交' : '保存'} ${result.records.length} 条工资记录。`);
    } catch (error) {
      if (isSelectionCurrent(selectionRevision)) {
        setNoticeTone('error');
        setNotice(messageFrom(error));
      }
    } finally {
      setBusy(false);
    }
  };

  const updateRule = async (rule: RecurringPayrollRule, active: boolean) => {
    setBusy(true);
    try {
      await apiRequest(`/api/staff/payroll/rules/${rule.id}`, {
        method: 'PATCH',
        body: { active, expectedUpdatedAt: rule.updatedAt },
      });
      if (!await refreshTarget(true, selectionRevision)) return;
      setNoticeTone('success');
      setNotice(active ? '自动规律已启用。' : '自动规律已暂停。');
    } catch (error) {
      if (isSelectionCurrent(selectionRevision)) {
        setNoticeTone('error');
        setNotice(messageFrom(error));
      }
    } finally {
      setBusy(false);
    }
  };

  const deleteRule = async (rule: RecurringPayrollRule) => {
    setBusy(true);
    try {
      await apiRequest(`/api/staff/payroll/rules/${rule.id}`, {
        method: 'DELETE',
        body: { expectedUpdatedAt: rule.updatedAt },
      });
      if (!await refreshTarget(true, selectionRevision)) return;
      setNoticeTone('success');
      setNotice('自动规律已删除，已生成的工资不受影响。');
    } catch (error) {
      if (isSelectionCurrent(selectionRevision)) {
        setNoticeTone('error');
        setNotice(messageFrom(error));
      }
    } finally {
      setBusy(false);
    }
  };

  const runRules = async () => {
    setBusy(true);
    try {
      const result = await apiRequest<{ generatedRecords: number; skippedRules: number; errors: unknown[] }>('/api/staff/payroll/rules/run', {
        method: 'POST',
        body: { month, targetUserId },
      });
      if (!await refreshTarget(true, selectionRevision)) return;
      setNoticeTone(result.errors.length ? 'error' : 'success');
      setNotice(`本月新生成 ${result.generatedRecords} 条，已跳过 ${result.skippedRules} 条已执行规律。`);
    } catch (error) {
      if (isSelectionCurrent(selectionRevision)) {
        setNoticeTone('error');
        setNotice(messageFrom(error));
      }
    } finally {
      setBusy(false);
    }
  };

  const showTime = template.applyType === 1 || template.applyType === 7;
  const showAmount = [2, 3, 4].includes(template.applyType);
  return <>
    <div className="content-card__heading salary-workspace__heading">
      <div><h2 className="workspace-panel-title">他人多条申报</h2></div>
      <div className="heading-actions">
        <TargetPicker users={users} value={targetUserId} onChange={setTargetUserId} disabled={busy} />
        <label className="month-picker"><span>申报月份</span><input type="month" value={month} disabled={busy} onChange={(event) => setMonth(event.target.value || currentMonth())} /></label>
      </div>
    </div>
    {target && (!target.profileReady || target.status !== 'active') && <StatusMessage
      tone="error"
      message={target.status !== 'active' ? '该账号已停用，不能新增工资。' : '该员工的收款资料尚未完成；可保存草稿，暂不能直接提交审核。'}
    />}
    <StatusMessage message={notice} tone={noticeTone} />
    <form className="batch-payroll-form" onSubmit={submitBatch} onInvalidCapture={(event) => {
      setNoticeTone('error');
      setNotice(invalidFormControlMessage(event));
    }}>
      <FormSection title="工资内容">
        <div className="form-grid form-grid--three">
          <Field label="工作负责人" required>
            <select value={template.checkUserId} onChange={(event) => updateTemplate('checkUserId', event.target.value)} required>
              <option value="">请选择</option>
              {workManagers.map((manager) => <option key={manager.id} value={manager.id}>{manager.label}</option>)}
            </select>
          </Field>
          <Field label="工作所属部门" required>
            <select value={template.departmentKey} onChange={(event) => updateTemplate('departmentKey', event.target.value)} required>
              <option value="">请选择</option>
              {departments.map((department) => <option key={department.key} value={department.key}>{department.label}</option>)}
            </select>
          </Field>
          <Field label="货币" required>
            <select value={template.currency} onChange={(event) => updateTemplate('currency', event.target.value as CurrencyCode)}>
              {CURRENCIES.map((currency) => <option key={currency.value} value={currency.value}>{currency.label} {currency.value}</option>)}
            </select>
          </Field>
          <Field label="计费方式" required>
            <select value={template.applyType} onChange={(event) => updateTemplate('applyType', Number(event.target.value) as SalaryApplyType)}>
              {APPLY_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          </Field>
          {template.applyType !== 5 && <Field label="单价" required>
            <input type="number" min="0" max="10000000" step="1" value={template.rate} onChange={(event) => updateTemplate('rate', Number(event.target.value))} required />
          </Field>}
          {showAmount && <Field label={template.applyType === 2 ? '件数' : template.applyType === 3 ? '字数' : '人数'} required>
            <input type="number" min="0" max="10000000" step="1" value={template.amount} onChange={(event) => updateTemplate('amount', Number(event.target.value))} required />
          </Field>}
          <Field label="工作内容" required={template.applyType === 7}>
            <input maxLength={SALARY_TEXT_MAX_LENGTH} value={template.workContent} onChange={(event) => updateTemplate('workContent', event.target.value)} required={template.applyType === 7} />
          </Field>
          <Field label="备注"><input maxLength={SALARY_TEXT_MAX_LENGTH} value={template.memo} onChange={(event) => updateTemplate('memo', event.target.value)} /></Field>
          {[1, 2, 3, 5].includes(template.applyType) && <Field label="每条交通费"><input type="number" min="0" max="10000000" step="1" value={template.travelFee} onChange={(event) => updateTemplate('travelFee', Number(event.target.value))} /></Field>}
        </div>
      </FormSection>

      <FormSection title="日期与时间">
        <div className="schedule-mode" role="group" aria-label="日期生成方式">
          <button type="button" aria-pressed={batchMode === 'fixed'} className={batchMode === 'fixed' ? 'is-active' : ''} onClick={() => setBatchMode('fixed')}>固定排课</button>
          <button type="button" aria-pressed={batchMode === 'calendar'} className={batchMode === 'calendar' ? 'is-active' : ''} onClick={() => { setBatchMode('calendar'); setSaveRule(false); }}>逐日安排</button>
        </div>
        {batchMode === 'fixed' ? <div className="fixed-schedule">
          <div className="form-grid form-grid--two">
            <Field label="开始日期" required><input type="date" min={range.start} max={range.end} value={fixed.rangeStart} onChange={(event) => setFixed((current) => ({ ...current, rangeStart: event.target.value }))} required /></Field>
            <Field label="结束日期" required><input type="date" min={range.start} max={range.end} value={fixed.rangeEnd} onChange={(event) => setFixed((current) => ({ ...current, rangeEnd: event.target.value }))} required /></Field>
          </div>
          <div className="weekday-picker" role="group" aria-label="每周上课日">
            {WEEKDAYS.map((day) => <button
              key={day.value}
              type="button"
              className={fixed.weekdays.includes(day.value) ? 'is-active' : ''}
              aria-pressed={fixed.weekdays.includes(day.value)}
              onClick={() => setFixed((current) => ({
                ...current,
                weekdays: current.weekdays.includes(day.value)
                  ? current.weekdays.filter((value) => value !== day.value)
                  : [...current.weekdays, day.value],
              }))}
            >{day.label}</button>)}
          </div>
          {showTime && <div className="form-grid form-grid--three">
            <TimeField label="开始时间" value={fixed.startTime} onChange={(value) => setFixed((current) => ({ ...current, startTime: value }))} />
            <TimeField label="结束时间" value={fixed.endTime} onChange={(value) => setFixed((current) => ({ ...current, endTime: value }))} />
            <RestField value={fixed.restHours} onChange={(value) => setFixed((current) => ({ ...current, restHours: value }))} />
          </div>}
          <label className="check-row"><input type="checkbox" checked={saveRule} onChange={(event) => setSaveRule(event.target.checked)} />保存为每月自动规律</label>
          {saveRule && <div className="form-grid form-grid--two recurring-fields">
            <Field label="规律名称" required><input maxLength={100} value={ruleTitle} onChange={(event) => setRuleTitle(event.target.value)} placeholder="例：授课老师 A 周一晚课" required /></Field>
            <Field label="结束月份"><input type="month" min={month} value={ruleEndMonth} onChange={(event) => setRuleEndMonth(event.target.value)} /></Field>
          </div>}
        </div> : <CalendarSessions
          month={month}
          showTime={showTime}
          sessions={calendarSessions}
          onChange={setCalendarSessions}
        />}
      </FormSection>

      <FormSection title="生成预览">
        <div className="batch-preview-summary">
          <strong>将生成 {preview.length} 条</strong>
          <CurrencyAmountsView amounts={previewTotals} />
        </div>
        <div className="data-table-wrap batch-preview-table">
          <table className="data-table"><thead><tr><th>日期</th><th>时间</th><th>休息</th><th>计薪</th><th>金额</th></tr></thead>
            <tbody>{preview.map((record, index) => <tr key={`${record.workDate}-${record.startTime}-${index}`}>
              <td>{record.workDate}</td>
              <td>{showTime ? `${record.startTime}–${record.endTime}` : '-'}</td>
              <td>{showTime ? `${formatHours(record.restHours)} 小时` : '-'}</td>
              <td>{showTime ? `${formatHours(record.workHours)} 小时` : getApplyTypeLabel(record.applyType)}</td>
              <td><Money amount={record.finalSalary} currency={record.currency} /></td>
            </tr>)}</tbody>
          </table>
        </div>
      </FormSection>
      <div className="batch-submit-row">
        <label className="check-row"><input type="checkbox" checked={submitNow} onChange={(event) => setSubmitNow(event.target.checked)} />生成后直接提交审核</label>
        <button type="submit" className="primary-button" disabled={busy || !target || target.status !== 'active' || (submitNow && !target.profileReady) || preview.length === 0}>
          {busy ? '处理中…' : `生成 ${preview.length} 条记录`}
        </button>
      </div>
    </form>

    <section className="recurring-rules-section">
      <div className="salary-record-section__heading">
        <div><h2>自动规律</h2></div>
        <button type="button" className="secondary-button button-with-icon" disabled={busy || rules.length === 0} onClick={() => void runRules()}><CalendarClock size={15} />补执行本月</button>
      </div>
      {rules.length === 0 ? <div className="empty-state empty-state--compact">该员工还没有自动规律。</div> : <div className="recurring-rule-list">
        {rules.map((rule) => <article key={rule.id} className={rule.active ? 'recurring-rule-card' : 'recurring-rule-card is-paused'}>
          <div>
            <strong>{rule.title}</strong>
            <span>{formatRuleSchedule(rule)} · {getDepartmentLabel(rule.template.departmentKey, rule.template.departmentLabel)} · {rule.submit ? '自动提交' : '保存未提交'}</span>
            <small>{rule.lastRunMessage || '尚未执行'}</small>
          </div>
          <Money amount={rule.template.finalSalary} currency={rule.template.currency} />
          <div className="row-actions recurring-rule-actions">
            <button type="button" disabled={busy} onClick={() => void updateRule(rule, !rule.active)}>{rule.active ? <Pause size={14} /> : <Play size={14} />}{rule.active ? '暂停' : '启用'}</button>
            <button type="button" className="danger-text" disabled={busy} onClick={() => void deleteRule(rule)}><Trash2 size={14} />删除</button>
          </div>
        </article>)}
      </div>}
    </section>

    {records.length > 0 && <section className="batch-current-records">
      <div className="salary-record-section__heading"><div><h2>{month} 已有记录</h2></div><span>{records.length} 条</span></div>
      <SalaryTable records={records} readOnly />
    </section>}
  </>;
}

function TargetPicker({ users, value, onChange, disabled = false }: { users: ManagedUser[]; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return <label className="target-picker"><span>申报对象</span><select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
    <option value="">请选择</option>
    {users.map((user) => {
      const duplicate = users.some((item) => item.id !== user.id && item.displayName === user.displayName);
      return <option key={user.id} value={user.id}>{user.displayName}{duplicate ? `（${user.email}）` : ''}{user.status === 'disabled' ? '（已停用）' : ''}</option>;
    })}
  </select></label>;
}

function CalendarSessions({
  month,
  showTime,
  sessions,
  onChange,
}: {
  month: string;
  showTime: boolean;
  sessions: PayrollScheduleSession[];
  onChange: (sessions: PayrollScheduleSession[]) => void;
}) {
  const range = monthDateRange(month)!;
  const update = (index: number, values: Partial<PayrollScheduleSession>) => onChange(sessions.map((session, itemIndex) => itemIndex === index ? { ...session, ...values } : session));
  return <div className="calendar-session-list">
    {sessions.map((session, index) => <div className="calendar-session-row" key={index}>
      <Field label="日期" required><input type="date" min={range.start} max={range.end} value={session.workDate} onChange={(event) => update(index, { workDate: event.target.value })} required /></Field>
      {showTime && <TimeField label="开始" value={session.startTime} onChange={(value) => update(index, { startTime: value })} />}
      {showTime && <TimeField label="结束" value={session.endTime} onChange={(value) => update(index, { endTime: value })} />}
      {showTime && <RestField value={session.restHours} onChange={(value) => update(index, { restHours: value })} />}
      <button type="button" className="icon-button" aria-label="删除这个时段" disabled={sessions.length === 1} onClick={() => onChange(sessions.filter((_, itemIndex) => itemIndex !== index))}>×</button>
    </div>)}
    <button type="button" className="secondary-button calendar-session-add" onClick={() => onChange([...sessions, {
      workDate: range.start,
      startTime: '18:00',
      endTime: '20:00',
      restHours: 0,
    }])}>+添加日期</button>
  </div>;
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <Field label={label} required><select value={value} onChange={(event) => onChange(event.target.value)} required>
    <option value="">请选择</option>
    {TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}
  </select></Field>;
}

function RestField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return <Field label="休息时间"><select value={value} onChange={(event) => onChange(Number(event.target.value))}>
    {REST_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select></Field>;
}

function defaultTargetRecord(
  userId: string,
  month: string,
  departments: DepartmentOption[],
  workManagers: WorkManagerOption[],
  currentUserId: string,
) {
  const record = createRecord(userId);
  const manager = workManagers.find((item) => item.id === currentUserId) ?? workManagers[0];
  const department = departments.find((item) => item.key === 'dept-teaching') ?? departments[0];
  return recalculateRecord({
    ...record,
    workDate: `${month}-01`,
    checkUserId: manager?.id ?? '',
    checkUser: manager?.label ?? '',
    departmentKey: department?.key ?? '',
    departmentLabel: department?.label ?? '',
    applyType: 1,
    rate: 3000,
    startTime: '18:00',
    endTime: '20:00',
    workContent: '授课',
  });
}

function defaultFixedSchedule(month: string): FixedPayrollSchedule {
  const range = monthDateRange(month)!;
  return {
    rangeStart: range.start,
    rangeEnd: range.end,
    startsAtMonthStart: true,
    endsAtMonthEnd: true,
    weekdays: [1],
    startTime: '18:00',
    endTime: '20:00',
    restHours: 0,
  };
}

function newBatchRequestId() {
  return `batch-request-${crypto.randomUUID()}`;
}

function formatRuleSchedule(rule: RecurringPayrollRule) {
  const days = WEEKDAYS.filter((day) => rule.schedule.weekdays.includes(day.value)).map((day) => day.label).join('、');
  const time = rule.template.applyType === 1 || rule.template.applyType === 7
    ? `${rule.schedule.startTime}–${rule.schedule.endTime}`
    : getApplyTypeLabel(rule.template.applyType);
  return `${days || '未设置'} ${time}`;
}
