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
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const loadEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiRequest<{ employees: EmployeeSummary[] }>('/api/staff/employees');
      setEmployees(result.employees);
      setSelectedId((current) => current || result.employees[0]?.id || '');
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
      .then((result) => {
        if (!cancelled) {
          setEmployees(result.employees);
          setSelectedId(result.employees[0]?.id ?? '');
        }
      })
      .catch((error) => { if (!cancelled) setMessage(errorText(error)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    void apiRequest<{ employee: EmployeeDetail }>(`/api/staff/employees/${selectedId}`)
      .then((result) => { if (!cancelled) { setDetail(result.employee); setMessage(''); } })
      .catch((error) => { if (!cancelled) setMessage(errorText(error)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const selectedSummary = employees.find((employee) => employee.id === selectedId);
  const monthRecords = useMemo(() => detail?.salaryRecords.filter((record) => record.workDate.startsWith(month)) ?? [], [detail, month]);
  const monthAudit = useMemo(() => detail?.auditLogs.filter((log) => log.createdAt.startsWith(month)) ?? [], [detail, month]);

  return (
    <section className="content-card employee-workspace">
      <div className="content-card__heading">
        <div><p className="eyebrow">06 员工管理</p><h1>员工档案与工资全记录</h1><p>审核员和管理员可查看员工资料、所有附件、历史申报、月度工资与审计记录。</p></div>
        <button type="button" className="secondary-button" disabled={loading} onClick={() => void loadEmployees()}>刷新</button>
      </div>
      <StatusMessage message={message} tone="error" />
      <div className="employee-layout">
        <aside className="employee-directory">
          <h2>账号目录</h2>
          {employees.map((employee) => <button key={employee.id} type="button" className={selectedId === employee.id ? 'is-active' : ''} onClick={() => setSelectedId(employee.id)}>
            <strong>{employee.displayName}</strong><span>{employee.email}</span><small>{ROLE_LABELS[employee.role]} · {ACCOUNT_STATUS_LABELS[employee.status]} · {employee.recordCount} 条</small>
          </button>)}
        </aside>
        <div className="employee-detail">
          {loading && !detail ? <div className="empty-state">正在加载员工档案…</div> : !detail || !selectedSummary ? <div className="empty-state">请选择员工账号。</div> : <>
            <div className="employee-detail__heading">
              <div><h2>{detail.user.displayName}</h2><p>{detail.user.email} · {ROLE_LABELS[detail.user.role]} · {ACCOUNT_STATUS_LABELS[detail.user.status]}</p></div>
              <label className="month-picker"><span>查看月份</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
            </div>
            <div className="summary-grid summary-grid--three">
              <Metric label="已申报总额" value={<CurrencyAmountsView amounts={selectedSummary.submittedAmounts} />} />
              <Metric label="审核通过 / 已领取口径" value={<CurrencyAmountsView amounts={selectedSummary.approvedAmounts} />} tone="approved" />
              <Metric label="记录 / 附件" value={`${detail.salaryRecords.length} 条 / ${detail.files.length} 个`} />
            </div>

            <section className="detail-section"><h3>基本资料与收款信息</h3><div className="profile-readonly-grid">{profileEntries(detail.profile).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</div></section>

            <section className="detail-section"><h3>全部上传文件</h3>{detail.files.length === 0 ? <div className="empty-state">该账号尚未上传文件。</div> : <div className="file-inventory">{detail.files.map((file) => <a key={file.key} href={`/api/files?key=${encodeURIComponent(file.key)}`} target="_blank" rel="noreferrer"><strong>{file.name}</strong><span>{formatFileSize(file.size)} · {file.referenceTypes.map(referenceLabel).join(' / ') || '未引用'} · {new Date(file.createdAt).toLocaleString('zh-CN')}</span></a>)}</div>}</section>

            <section className="detail-section"><h3>按月工资与审批统计</h3>{detail.monthlySummaries.length === 0 ? <div className="empty-state">暂无工资记录。</div> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>月份</th><th>记录</th><th>已申报</th><th>待审</th><th>已领取</th><th>已驳回</th></tr></thead><tbody>{detail.monthlySummaries.map((summary) => <tr key={summary.month}><td>{summary.month}</td><td>{summary.recordCount}</td><td><CurrencyAmountsView amounts={summary.submittedAmounts} /></td><td><CurrencyAmountsView amounts={summary.pendingAmounts} /></td><td><CurrencyAmountsView amounts={summary.approvedAmounts} /></td><td><CurrencyAmountsView amounts={summary.rejectedAmounts} /></td></tr>)}</tbody></table></div>}</section>

            <section className="detail-section"><h3>{month} 全部申报与审批记录</h3>{monthRecords.length === 0 ? <div className="empty-state">该月份没有申报记录。</div> : <div className="employee-record-list">{monthRecords.map((record) => <article key={record.id}><header><strong>{record.workDate} · {getDepartmentLabel(record.departmentKey, record.departmentLabel)}</strong><span className={`status-badge status-badge--${STATUS[record.status].tone}`}>{STATUS[record.status].label}</span></header><p>{getApplyTypeLabel(record.applyType)} · 负责人 {record.checkUser} · <Money amount={record.finalSalary} currency={record.currency} /></p>{record.workContent && <p><b>工作内容：</b>{record.workContent}</p>}{record.memo && <p><b>员工备注：</b>{record.memo}</p>}{record.auditMemo && <p><b>审核备注：</b>{record.auditMemo}</p>}{record.attachments.length > 0 && <div className="attachment-links">{record.attachments.map((key, index) => <a key={key} href={`/api/files?key=${encodeURIComponent(key)}`} target="_blank" rel="noreferrer">申报附件 {index + 1}</a>)}</div>}</article>)}</div>}</section>

            <AuditTrailPanel logs={monthAudit} title={`${month} · ${detail.user.displayName} 全部操作`} />
          </>}
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'approved' }) {
  return <div className={tone ? `summary-card summary-card--${tone}` : 'summary-card'}><span>{label}</span><strong>{value}</strong></div>;
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

function profileEntries(profile: Profile): Array<[string, string]> {
  return (Object.entries(PROFILE_LABELS) as Array<[keyof Profile, string]>).map(([key, label]) => {
    const value = profile[key];
    return [label, typeof value === 'string' && value.trim() ? value : '未填写'];
  });
}

function referenceLabel(value: string) {
  return value === 'profile_id' ? '身份证件' : value === 'profile_bank' ? '收款资料' : value === 'salary' ? '工资申报' : value;
}

function formatFileSize(size: number) {
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function errorText(error: unknown) {
  return error instanceof ApiClientError ? error.message : error instanceof Error ? error.message : '请求失败。';
}
