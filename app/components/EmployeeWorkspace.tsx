'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClientError, apiRequest } from '../lib/api-client';
import {
  ACCOUNT_STATUS_LABELS,
  EmployeeDetail,
  EmployeeSummary,
  Profile,
  ROLE_LABELS,
  STATUS,
  currentMonth,
  emptyCurrencyAmounts,
  getApplyTypeLabel,
  getDepartmentLabel,
} from '../lib/payroll';
import { AuditTrailPanel, CurrencyAmountsView, Money } from './payroll-ui';
import { StatusMessage } from './form-controls';

export function EmployeeWorkspace() {
  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<EmployeeDetail | null>(null);
  const [month, setMonth] = useState(currentMonth);
  const [detailRevision, setDetailRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const loadEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiRequest<{ employees: EmployeeSummary[] }>('/api/staff/employees');
      setEmployees(result.employees);
      setSelectedId((current) => result.employees.some((employee) => employee.id === current)
        ? current
        : result.employees[0]?.id || '');
      setMessage('');
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void apiRequest<{ employees: EmployeeSummary[] }>('/api/staff/employees')
      .then((result) => { if (!cancelled) { setEmployees(result.employees); setSelectedId((current) => result.employees.some((employee) => employee.id === current) ? current : result.employees[0]?.id || ''); setMessage(''); } })
      .catch((error) => { if (!cancelled) setMessage(errorText(error)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (selectedId) {
      void apiRequest<{ employee: EmployeeDetail }>(`/api/staff/employees/${selectedId}`)
        .then((result) => { if (!cancelled) { setDetail(result.employee); setMessage(''); } })
        .catch((error) => { if (!cancelled) setMessage(errorText(error)); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }
    return () => { cancelled = true; };
  }, [detailRevision, month, selectedId]);

  const selectedSummary = employees.find((employee) => employee.id === selectedId);
  const duplicateEmployeeNames = useMemo(() => duplicateNames(employees), [employees]);
  const monthRecords = useMemo(
    () => detail?.salaryRecords.filter((record) => record.workDate.startsWith(month)) ?? [],
    [detail, month],
  );
  const monthAudit = useMemo(
    () => detail?.auditLogs.filter((log) => log.createdAt.startsWith(month)) ?? [],
    [detail, month],
  );
  const selectedMonthSummary = detail?.monthlySummaries.find((summary) => summary.month === month);
  const selectedMonthApproved = selectedMonthSummary?.approvedAmounts ?? emptyCurrencyAmounts();

  const refreshCurrent = async () => {
    await loadEmployees();
    setLoading(true);
    setDetailRevision((current) => current + 1);
  };

  return (
    <section className="content-card employee-workspace">
      <div className="content-card__heading">
        <div><p className="eyebrow">06 员工管理</p><h1>员工资料与工资</h1></div>
        <button type="button" className="secondary-button" disabled={loading} onClick={() => void refreshCurrent()}>刷新</button>
      </div>
      <StatusMessage message={message} tone="error" />
      <div className="employee-layout">
        <aside className="employee-directory">
          <h2>账号目录</h2>
          {employees.map((employee) => <button key={employee.id} type="button" className={selectedId === employee.id ? 'is-active' : ''} onClick={() => {
            setLoading(true);
            setSelectedId(employee.id);
            if (selectedId === employee.id) setDetailRevision((current) => current + 1);
          }}>
            <strong>{employee.displayName}</strong><small>{duplicateEmployeeNames.has(employee.displayName) ? `${employee.email} · ` : ''}{ROLE_LABELS[employee.role]} · {ACCOUNT_STATUS_LABELS[employee.status]} · {employee.recordCount} 条</small>
          </button>)}
        </aside>
        <div className="employee-detail">
          {selectedId && (!detail || detail.user.id !== selectedId) ? (
            <div className="empty-state">正在加载员工档案…</div>
          ) : !detail || !selectedSummary ? (
            <div className="empty-state">请选择员工账号。</div>
          ) : <>
            <div className="employee-detail__heading">
              <div><h2>{detail.user.displayName}</h2><p>{ROLE_LABELS[detail.user.role]} · {ACCOUNT_STATUS_LABELS[detail.user.status]}</p></div>
              <label className="month-picker"><span>查看月份</span><input type="month" value={month} onChange={(event) => { setLoading(true); setMonth(event.target.value || currentMonth()); }} /></label>
            </div>
            <div className="summary-grid summary-grid--four">
              <Metric label="累计已审批工资" value={<CurrencyAmountsView amounts={selectedSummary.approvedAmounts} />} tone="approved" important />
              <Metric label={`${month} 已审批工资`} value={<CurrencyAmountsView amounts={selectedMonthApproved} />} tone="approved" important />
              <Metric label={`${month} 已申报`} value={<CurrencyAmountsView amounts={selectedMonthSummary?.submittedAmounts ?? emptyCurrencyAmounts()} />} />
              <Metric label="记录 / 附件" value={`${detail.salaryRecords.length} 条 / ${detail.files.length} 个`} />
            </div>

            <section className="detail-section"><h3>基本资料与收款信息</h3><div className="employee-profile-cards">
              <ProfileCard title="姓名与联系方式" profile={detail.profile} keys={BASIC_PROFILE_KEYS} defaultOpen />
              <ProfileCard title="身份与学历资料" profile={detail.profile} keys={DOCUMENT_PROFILE_KEYS} />
              <ProfileCard title="工资收款信息" profile={detail.profile} keys={PAYMENT_PROFILE_KEYS} defaultOpen />
            </div></section>

            <section className="detail-section"><h3>上传文件</h3>{detail.files.length === 0 ? <div className="empty-state">暂无文件。</div> : <div className="file-inventory">{detail.files.map((file) => <a key={file.key} href={`/api/files?key=${encodeURIComponent(file.key)}`} target="_blank" rel="noreferrer"><strong>{file.name}</strong><span>{formatFileSize(file.size)} · {new Date(file.createdAt).toLocaleString('zh-CN')}</span></a>)}</div>}</section>

            <section className="detail-section"><h3>月度工资</h3>{detail.monthlySummaries.length === 0 ? <div className="empty-state">暂无工资记录。</div> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>月份</th><th>记录</th><th>已申报</th><th>待审</th><th className="table-priority">已通过</th><th>已驳回</th></tr></thead><tbody>{detail.monthlySummaries.map((summary) => <tr key={summary.month}><td>{summary.month}</td><td>{summary.recordCount}</td><td><CurrencyAmountsView amounts={summary.submittedAmounts} /></td><td><CurrencyAmountsView amounts={summary.pendingAmounts} /></td><td className="table-priority"><CurrencyAmountsView amounts={summary.approvedAmounts} /></td><td><CurrencyAmountsView amounts={summary.rejectedAmounts} /></td></tr>)}</tbody></table></div>}</section>

            <section className="detail-section"><h3>{month} 申报记录</h3>{monthRecords.length === 0 ? <div className="empty-state">该月份没有申报记录。</div> : <div className="employee-record-list">{monthRecords.map((record) => <article key={record.id}><header><strong>{record.workDate} · {getDepartmentLabel(record.departmentKey, record.departmentLabel)}</strong><span className={`status-badge status-badge--${STATUS[record.status].tone}`}>{STATUS[record.status].label}</span></header><p>{getApplyTypeLabel(record.applyType)} · 负责人 {record.checkUser} · <Money amount={record.finalSalary} currency={record.currency} /></p><p className="record-provenance">{salarySourceLabel(record.source)}{record.createdByName ? ` · ${record.createdByName}` : ''}</p>{record.workContent && <p><b>工作内容：</b>{record.workContent}</p>}{record.memo && <p><b>员工备注：</b>{record.memo}</p>}{record.auditMemo && <p><b>审核备注：</b>{record.auditMemo}</p>}{record.attachments.length > 0 && <div className="attachment-links">{record.attachments.map((key, index) => <a key={key} href={`/api/files?key=${encodeURIComponent(key)}`} target="_blank" rel="noreferrer">申报附件 {index + 1}</a>)}</div>}</article>)}</div>}</section>

            <AuditTrailPanel logs={monthAudit} title={`${detail.user.displayName} · ${month} 操作记录`} />
          </>}
        </div>
      </div>
    </section>
  );
}

function ProfileCard({ title, profile, keys, defaultOpen = false }: { title: string; profile: Profile; keys: Array<keyof Profile>; defaultOpen?: boolean }) {
  return <details className="employee-profile-card" open={defaultOpen}>
    <summary><strong>{title}</strong></summary>
    <dl>{keys.map((key) => <div key={key}><dt>{PROFILE_LABELS[key]}</dt><dd>{profileValue(profile, key)}</dd></div>)}</dl>
  </details>;
}

function Metric({ label, value, tone, important = false }: { label: string; value: React.ReactNode; tone?: 'approved'; important?: boolean }) {
  const classes = ['summary-card', tone ? `summary-card--${tone}` : '', important ? 'summary-card--important' : ''].filter(Boolean).join(' ');
  return <div className={classes}><span>{label}</span><strong>{value}</strong></div>;
}

const PROFILE_LABELS: Partial<Record<keyof Profile, string>> = {
  lastNameCn: '中文姓', firstNameCn: '中文名', lastNamePinyin: '姓拼音', firstNamePinyin: '名拼音',
  lastNameKana: '姓假名', firstNameKana: '名假名', birthday: '生日', gender: '性别', nationality: '国籍',
  idType: '证件类型', idNumber: '证件号码', idExpiryDate: '证件有效期', residentStatus: '在留资格',
  activityPermission: '资格外活动许可', dependents: '抚养信息', myNumber: 'My Number', address: '现住址',
  addressOfLicense: '证件地址', tel: '联系方式', graduateUniversity: '毕业院校', faculty: '学部 / 专业',
  graduateDate: '毕业日期', degree: '学位', bankType: '收款方式', bankName: '银行 / 平台', bankBranch: '支店',
  bankAccountNumber: '收款账号', bankAccountHolder: '账户名', payeeIsSelf: '收款人是否本人', payeeName: '收款人姓名', payeeIdNumber: '收款人证件号',
};

const BASIC_PROFILE_KEYS: Array<keyof Profile> = ['lastNameCn', 'firstNameCn', 'lastNamePinyin', 'firstNamePinyin', 'lastNameKana', 'firstNameKana', 'birthday', 'gender', 'address', 'tel'];
const DOCUMENT_PROFILE_KEYS: Array<keyof Profile> = ['idType', 'nationality', 'idNumber', 'idExpiryDate', 'residentStatus', 'activityPermission', 'dependents', 'myNumber', 'addressOfLicense', 'graduateUniversity', 'faculty', 'graduateDate', 'degree'];
const PAYMENT_PROFILE_KEYS: Array<keyof Profile> = ['bankType', 'bankName', 'bankBranch', 'bankAccountNumber', 'bankAccountHolder', 'payeeIsSelf', 'payeeName', 'payeeIdNumber'];

function profileValue(profile: Profile, key: keyof Profile) {
  const value = profile[key];
  if (key === 'idType') return idTypeLabel(String(value));
  if (key === 'bankType') return paymentMethodLabel(String(value));
  return typeof value === 'string' && value.trim() ? value : '未填写';
}

function paymentMethodLabel(value: string) {
  return value === 'jp-bank' ? '日本银行账户' : value === 'cn-bank' ? '中国银行账户' : value === 'alipay' ? '支付宝' : '未填写';
}

function idTypeLabel(value: string) {
  return value === 'residence' ? '在留卡' : value === 'china-id' ? '中国居民身份证' : value === 'passport' ? '护照' : '未填写';
}

function formatFileSize(size: number) {
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function duplicateNames(users: Array<{ id: string; displayName: string }>) {
  const counts = new Map<string, number>();
  for (const user of users) counts.set(user.displayName, (counts.get(user.displayName) ?? 0) + 1);
  return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
}

function salarySourceLabel(source: EmployeeDetail['salaryRecords'][number]['source']) {
  return ({
    self: '本人申报',
    'proxy-single': '他人单条代报',
    'proxy-batch': '他人批量代报',
    recurring: '自动规律',
    'gray-seed': '测试数据',
  })[source] ?? '本人申报';
}

function errorText(error: unknown) {
  return error instanceof ApiClientError ? error.message : error instanceof Error ? error.message : '请求失败。';
}
