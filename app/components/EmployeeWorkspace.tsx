'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileSpreadsheet, Paperclip } from 'lucide-react';
import { ApiClientError, apiRequest } from '../lib/api-client';
import {
  ACCOUNT_STATUS_LABELS,
  CurrencyAmounts,
  EmployeeDetail,
  EmployeeSummary,
  Profile,
  ROLE_LABELS,
  STATUS,
  TransferSheetRow,
  currentMonth,
  emptyCurrencyAmounts,
  getApplyTypeLabel,
  getDepartmentLabel,
} from '../lib/payroll';
import { AuditTrailPanel, CurrencyAmountsView, Money } from './payroll-ui';
import { StatusMessage } from './form-controls';

const TRANSFER_VIEW_ID = 'transfer-sheet';

export function EmployeeWorkspace() {
  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [selectedId, setSelectedId] = useState(TRANSFER_VIEW_ID);
  const [detail, setDetail] = useState<EmployeeDetail | null>(null);
  const [transferRows, setTransferRows] = useState<TransferSheetRow[]>([]);
  const [month, setMonth] = useState(currentMonth);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const loadEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiRequest<{ employees: EmployeeSummary[] }>('/api/staff/employees');
      setEmployees(result.employees);
      setMessage('');
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (userId: string) => {
    setLoading(true);
    try {
      const result = await apiRequest<{ employee: EmployeeDetail }>(`/api/staff/employees/${userId}`);
      setDetail(result.employee);
      setMessage('');
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTransferSheet = useCallback(async (selectedMonth: string) => {
    setLoading(true);
    try {
      const result = await apiRequest<{ rows: TransferSheetRow[] }>(`/api/staff/transfer-sheet?month=${encodeURIComponent(selectedMonth)}`);
      setTransferRows(result.rows);
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
      .then((result) => { if (!cancelled) { setEmployees(result.employees); setMessage(''); } })
      .catch((error) => { if (!cancelled) setMessage(errorText(error)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (selectedId === TRANSFER_VIEW_ID) {
      void apiRequest<{ rows: TransferSheetRow[] }>(`/api/staff/transfer-sheet?month=${encodeURIComponent(month)}`)
        .then((result) => { if (!cancelled) { setTransferRows(result.rows); setMessage(''); } })
        .catch((error) => { if (!cancelled) setMessage(errorText(error)); })
        .finally(() => { if (!cancelled) setLoading(false); });
    } else if (selectedId) {
      void apiRequest<{ employee: EmployeeDetail }>(`/api/staff/employees/${selectedId}`)
        .then((result) => { if (!cancelled) { setDetail(result.employee); setMessage(''); } })
        .catch((error) => { if (!cancelled) setMessage(errorText(error)); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }
    return () => { cancelled = true; };
  }, [month, selectedId]);

  const selectedSummary = employees.find((employee) => employee.id === selectedId);
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
    if (selectedId === TRANSFER_VIEW_ID) await loadTransferSheet(month);
    else if (selectedId) await loadDetail(selectedId);
  };

  return (
    <section className="content-card employee-workspace">
      <div className="content-card__heading">
        <div><p className="eyebrow">06 员工管理</p><h1>员工资料与工资</h1></div>
        <button type="button" className="secondary-button" disabled={loading} onClick={() => void refreshCurrent()}>刷新</button>
      </div>
      <StatusMessage message={message} tone="error" />
      <div className={selectedId === TRANSFER_VIEW_ID ? 'employee-layout employee-layout--summary' : 'employee-layout'}>
        <aside className="employee-directory">
          <h2>账号目录</h2>
          <button
            type="button"
            className={selectedId === TRANSFER_VIEW_ID ? 'employee-directory__transfer is-active' : 'employee-directory__transfer'}
            onClick={() => {
              setLoading(true);
              setSelectedId(TRANSFER_VIEW_ID);
              if (selectedId === TRANSFER_VIEW_ID) void loadTransferSheet(month);
            }}
          >
            <strong><FileSpreadsheet size={15} aria-hidden="true" />工资汇总</strong><small>{month}</small>
          </button>
          {employees.map((employee) => <button key={employee.id} type="button" className={selectedId === employee.id ? 'is-active' : ''} onClick={() => {
            setLoading(true);
            setSelectedId(employee.id);
            if (selectedId === employee.id) void loadDetail(employee.id);
          }}>
            <strong>{employee.displayName}</strong><small>{ROLE_LABELS[employee.role]} · {ACCOUNT_STATUS_LABELS[employee.status]} · {employee.recordCount} 条</small>
          </button>)}
        </aside>
        <div className="employee-detail">
          {selectedId === TRANSFER_VIEW_ID ? (
            <TransferSheetPanel
              month={month}
              rows={transferRows}
              loading={loading}
              onMonthChange={(nextMonth) => { setLoading(true); setMonth(nextMonth); }}
            />
          ) : loading && (!detail || detail.user.id !== selectedId) ? (
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

            <section className="detail-section"><h3>{month} 申报记录</h3>{monthRecords.length === 0 ? <div className="empty-state">该月份没有申报记录。</div> : <div className="employee-record-list">{monthRecords.map((record) => <article key={record.id}><header><strong>{record.workDate} · {getDepartmentLabel(record.departmentKey, record.departmentLabel)}</strong><span className={`status-badge status-badge--${STATUS[record.status].tone}`}>{STATUS[record.status].label}</span></header><p>{getApplyTypeLabel(record.applyType)} · 负责人 {record.checkUser} · <Money amount={record.finalSalary} currency={record.currency} /></p>{record.workContent && <p><b>工作内容：</b>{record.workContent}</p>}{record.memo && <p><b>员工备注：</b>{record.memo}</p>}{record.auditMemo && <p><b>审核备注：</b>{record.auditMemo}</p>}{record.attachments.length > 0 && <div className="attachment-links">{record.attachments.map((key, index) => <a key={key} href={`/api/files?key=${encodeURIComponent(key)}`} target="_blank" rel="noreferrer">申报附件 {index + 1}</a>)}</div>}</article>)}</div>}</section>

            <AuditTrailPanel logs={monthAudit} title={`${detail.user.displayName} · ${month} 操作记录`} />
          </>}
        </div>
      </div>
    </section>
  );
}

function TransferSheetPanel({
  month,
  rows,
  loading,
  onMonthChange,
}: {
  month: string;
  rows: TransferSheetRow[];
  loading: boolean;
  onMonthChange: (month: string) => void;
}) {
  const jpyTotal = sumApproved(rows, 'JPY');
  const cnyTotal = sumApproved(rows, 'CNY');
  return <section className="transfer-sheet">
    <div className="transfer-sheet__top">
      <div className="employee-detail__heading">
        <div><h2>工资汇总</h2></div>
        <div className="heading-actions">
          <label className="month-picker"><span>查看月份</span><input type="month" value={month} onChange={(event) => onMonthChange(event.target.value || currentMonth())} /></label>
          <button type="button" className="primary-button button-with-icon" disabled={loading || rows.length === 0} onClick={() => downloadTransferSheet(rows, month)}><Download size={15} aria-hidden="true" />导出 Excel</button>
        </div>
      </div>
      <div className="transfer-sheet__summary">
        <span><b>{rows.length}</b> 名员工</span>
        {jpyTotal !== 0 && <span><Money amount={jpyTotal} currency="JPY" /></span>}
        {cnyTotal !== 0 && <span><Money amount={cnyTotal} currency="CNY" /></span>}
        {jpyTotal === 0 && cnyTotal === 0 && <span>暂无已通过工资</span>}
      </div>
    </div>
    {loading && rows.length === 0 ? <div className="empty-state">正在加载…</div> : (
      <div className="data-table-wrap transfer-table-wrap"><table className="data-table transfer-table">
        <thead><tr><th>姓名</th><th>联系方式</th><th>收款方式</th><th>收款单位</th><th>支店</th><th>收款账号</th><th>账户名</th><th>收款人</th><th>证件号</th><th className="table-priority">已通过</th><th>PDF</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.user.id}>
          <td><strong>{row.user.displayName}</strong></td>
          <td className="transfer-table__multiline">{row.profile.tel || '未填写'}</td>
          <td>{paymentMethodLabel(row.profile.bankType)}</td>
          <td className={`transfer-table__institution transfer-table__institution--${row.profile.bankType || 'empty'}`}>{row.profile.bankName || '未填写'}</td>
          <td>{row.profile.bankBranch || '未填写'}</td>
          <td>{row.profile.bankAccountNumber || '未填写'}</td>
          <td>{row.profile.bankAccountHolder || '未填写'}</td>
          <td>{row.profile.payeeName || row.user.displayName}</td>
          <td>{row.profile.payeeIdNumber || '未填写'}</td>
          <td className="table-priority"><CurrencyAmountsView amounts={row.approvedAmounts} /></td>
          <td>{row.pdfFiles.length === 0 ? <span className="muted-text">无</span> : <div className="transfer-pdf-links">{row.pdfFiles.map((file, index) => <a key={file.key} href={`/api/files?key=${encodeURIComponent(file.key)}`} target="_blank" rel="noreferrer" download title={file.name}><Paperclip size={11} aria-hidden="true" />PDF {index + 1}</a>)}</div>}</td>
        </tr>)}</tbody>
      </table></div>
    )}
  </section>;
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

function sumApproved(rows: TransferSheetRow[], currency: keyof CurrencyAmounts) {
  return rows.reduce((sum, row) => sum + row.approvedAmounts[currency], 0);
}

function downloadTransferSheet(rows: TransferSheetRow[], month: string) {
  const headers = ['员工姓名', '联系方式', '收款方式', '收款单位', '支店', '收款账号', '账户名', '收款人姓名', '收款人证件号', `${month} 日元 JPY`, `${month} 人民币 CNY`];
  const body = rows.map((row) => [
    row.user.displayName,
    row.profile.tel,
    paymentMethodLabel(row.profile.bankType),
    row.profile.bankName,
    row.profile.bankBranch,
    row.profile.bankAccountNumber,
    row.profile.bankAccountHolder,
    row.profile.payeeName || row.user.displayName,
    row.profile.payeeIdNumber,
    String(row.approvedAmounts.JPY),
    String(row.approvedAmounts.CNY),
  ]);
  const xmlRows = [headers, ...body].map((row) => `<Row>${row.map((cell) => `<Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`).join('')}</Row>`).join('');
  const workbook = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="${escapeXml(month)}"><Table>${xmlRows}</Table></Worksheet></Workbook>`;
  const url = URL.createObjectURL(new Blob([workbook], { type: 'application/vnd.ms-excel;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `旅人教育-工资汇总-${month}.xls`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function escapeXml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function formatFileSize(size: number) {
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function errorText(error: unknown) {
  return error instanceof ApiClientError ? error.message : error instanceof Error ? error.message : '请求失败。';
}
