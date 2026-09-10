'use client';

import { SalaryTable } from './SalaryWorkspace';
import { appPath } from '../lib/app-path';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Paperclip } from 'lucide-react';
import { useFeedback } from './interaction-guards';
import { ApiClientError, apiRequest } from '../lib/api-client';
import { AccountRole, CurrencyAmounts, TransferSheetRow, currentMonth, monthIsValid, effectivePayee } from '../lib/payroll';
import { CurrencyAmountsView, Money } from './payroll-ui';
import { StatusMessage } from './form-controls';

export function TransferSheetWorkspace({role = 'admin'}: {role?: AccountRole}) {
  const [scope, setScope] = useState(role === 'reviewer' ? 'assigned' : role === 'employee' ? 'granted' : 'all');
  const [month, setMonth] = useState(currentMonth);
  const [rows, setRows] = useState<TransferSheetRow[]>([]);
  const [loadedMonth, setLoadedMonth] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage, feedbackRevision] = useFeedback();
  const requestRevision = useRef(0);

  const load = useCallback(async (selectedMonth: string) => {
    const revision = requestRevision.current + 1;
    requestRevision.current = revision;
    setLoadedMonth('');
    setLoading(true);
    try {
      const result = await apiRequest<{ rows: TransferSheetRow[] }>(
        `/api/staff/transfer-sheet?month=${encodeURIComponent(selectedMonth)}&scope=${scope}`,
      );
      if (requestRevision.current === revision) {
        setRows(result.rows);
        setLoadedMonth(selectedMonth);
        setMessage('');
      }
    } catch (error) {
      if (requestRevision.current === revision) {setRows([]);setLoadedMonth('');setMessage(errorText(error));}
    } finally {
      if (requestRevision.current === revision) setLoading(false);
    }
  }, [setMessage, scope]);

  useEffect(() => {
    const revision = requestRevision.current + 1;
    requestRevision.current = revision;
    void apiRequest<{ rows: TransferSheetRow[] }>(
      `/api/staff/transfer-sheet?month=${encodeURIComponent(month)}&scope=${scope}`,
    ).then((result) => {
      if (requestRevision.current === revision) {
        setRows(result.rows);
        setLoadedMonth(month);
        setMessage('');
      }
    }).catch((error) => {
      if (requestRevision.current === revision) {setRows([]);setLoadedMonth('');setMessage(errorText(error));}
    }).finally(() => {
      if (requestRevision.current === revision) setLoading(false);
    });
    return () => { requestRevision.current += 1; };
  }, [month, scope, setMessage]);

  const exportSheet = async () => {
    if (loading || exporting) return;
    const revision = requestRevision.current;
    setExporting(true);
    try {
      const fresh = await apiRequest<{rows:TransferSheetRow[]}>(`/api/staff/transfer-sheet?month=${encodeURIComponent(month)}&scope=${scope}`);
      if (requestRevision.current !== revision) return;
      setRows(fresh.rows); downloadTransferSheet(fresh.rows, month);
    } catch(error) {
      if (requestRevision.current === revision) {setRows([]);setLoadedMonth('');setMessage(errorText(error));}
    } finally {if (requestRevision.current === revision) setExporting(false);}
  };

  const visibleRows = loadedMonth === month ? rows : [];
  const showPayments = role === 'admin' || scope === 'granted';
  const jpyTotal = sumApproved(visibleRows, 'JPY');
  const cnyTotal = sumApproved(visibleRows, 'CNY');

  return <section className="content-card transfer-workspace">
    <div className="content-card__heading">
      <div><p className="eyebrow">04 工资审核</p><h1>工资汇总</h1></div>
      <div className="heading-actions">
        <label className="month-picker"><span>查看范围</span><select aria-label="汇总查看范围" disabled={exporting} value={scope} onChange={(event) => {setRows([]);setLoadedMonth('');setLoading(true);setScope(event.target.value);}}>
          {role === 'admin' && <option value="all">全部员工</option>}
          {role !== 'employee' && <option value="assigned">我负责审核的</option>}
          {role !== 'admin' && <option value="granted">本人及获授权员工</option>}
        </select></label>
        <label className="month-picker">
          <span>查看月份</span>
          <input type="month" disabled={exporting} value={month} onBlur={(event) => { event.currentTarget.value = month; }} onChange={(event) => { const next = event.target.value || currentMonth(); if (!monthIsValid(next)) { event.target.value = month; setMessage('请选择有效月份。'); return; } event.target.value = next; if (next === month) return; setLoading(true); setMonth(next); }} />
        </label>
        <button type="button" className="secondary-button" disabled={loading || exporting} onClick={() => void load(month)}>刷新</button>
        <button
          type="button"
          className="primary-button button-with-icon"
          disabled={loading || exporting || visibleRows.length === 0}
          onClick={() => void exportSheet()}
        >
          <Download size={15} aria-hidden="true" />{exporting ? '准备导出…' : '导出 Excel'}
        </button>
      </div>
    </div>

    <StatusMessage message={message} eventId={feedbackRevision} tone="error" />

    <div className="transfer-sheet__summary">
      <span><b>{visibleRows.length}</b> 名员工</span>
      {jpyTotal !== 0 && <span><Money amount={jpyTotal} currency="JPY" /></span>}
      {cnyTotal !== 0 && <span><Money amount={cnyTotal} currency="CNY" /></span>}
      {jpyTotal === 0 && cnyTotal === 0 && <span>暂无已通过工资</span>}
    </div>

    {loading && visibleRows.length === 0 ? <div className="empty-state">正在加载…</div> : (
      showPayments ? <div className="data-table-wrap transfer-table-wrap"><table className="data-table transfer-table">
        <thead><tr><th>姓名</th><th>联系方式</th><th>收款方式</th><th>收款单位</th><th>支店</th><th>收款账号</th><th>账户名</th><th>收款人</th><th>证件号</th><th className="table-priority">已通过</th><th>PDF</th></tr></thead>
        <tbody>{visibleRows.map((row) => <tr key={row.user.id}>
          <td><strong>{row.user.displayName}</strong></td>
          <td className="transfer-table__multiline">{row.profile.tel || '未填写'}</td>
          <td>{paymentMethodLabel(row.profile.bankType)}</td>
          <td className={`transfer-table__institution transfer-table__institution--${row.profile.bankType || 'empty'}`}>{row.profile.bankName || '未填写'}</td>
          <td>{row.profile.bankBranch || '未填写'}</td>
          <td>{row.profile.bankAccountNumber || '未填写'}</td>
          <td>{row.profile.bankAccountHolder || '未填写'}</td>
          <td>{effectivePayee(row.profile, row.user.displayName).name}</td>
          <td>{effectivePayee(row.profile, row.user.displayName).idNumber || '未填写'}</td>
          <td className="table-priority"><CurrencyAmountsView amounts={row.approvedAmounts} /></td>
          <td>{row.pdfFiles.length === 0 ? <span className="muted-text">无</span> : <div className="transfer-pdf-links">{row.pdfFiles.map((file, index) => <a key={file.key} href={appPath(`/api/files?key=${encodeURIComponent(file.key)}`)} target="_blank" rel="noreferrer" download title={file.name}><Paperclip size={11} aria-hidden="true" />PDF {index + 1}</a>)}</div>}</td>
        </tr>)}</tbody>
      </table></div> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>员工</th><th>申报条数</th><th>已通过金额（本人负责部分）</th></tr></thead><tbody>{visibleRows.map(row=><tr key={row.user.id}><td>{row.user.displayName}</td><td>{row.records?.length || 0}</td><td><CurrencyAmountsView amounts={row.approvedAmounts}/></td></tr>)}</tbody></table></div>
    )}
    {visibleRows.map(row=><details className="summary-records" key={row.user.id}><summary>{row.user.displayName} · {month} 工资明细 · {row.records?.length || 0} 条</summary>
      <SalaryTable records={row.records || []} readOnly emptyMessage="本月没有已申报记录。" />
    </details>)}
  </section>;
}

function paymentMethodLabel(value: string) {
  return value === 'jp-bank' ? '日本银行账户' : value === 'cn-bank' ? '中国银行账户' : value === 'alipay' ? '支付宝' : '未填写';
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
    effectivePayee(row.profile, row.user.displayName).name,
    effectivePayee(row.profile, row.user.displayName).idNumber,
    row.approvedAmounts.JPY,
    row.approvedAmounts.CNY,
  ]);
  const xmlRows = [headers, ...body].map((row) => `<Row>${row.map((cell) => {
    const type = typeof cell === 'number' ? 'Number' : 'String';
    return `<Cell><Data ss:Type="${type}">${escapeXml(String(cell))}</Data></Cell>`;
  }).join('')}</Row>`).join('');
  const workbook = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="${escapeXml(month)}"><Table>${xmlRows}</Table></Worksheet></Workbook>`;
  const url = URL.createObjectURL(new Blob([workbook], { type: 'application/vnd.ms-excel;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `旅人教育-工资汇总-${month}.xls`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeXml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function errorText(error: unknown) {
  return error instanceof ApiClientError ? error.message : error instanceof Error ? error.message : '请求失败。';
}
