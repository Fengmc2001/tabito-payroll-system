import {strToU8, zipSync} from 'fflate';
import {STATUS, effectivePayee, formatJapanDateTime, getApplyTypeLabel, getDepartmentLabel, monthIsValid} from './payroll';
import type {SalaryRecord, TransferSheetRow} from './payroll';

type Cell = string | number;
export type PayrollExportSheet = {name: string; rows: Cell[][]; currencyColumn?: number; amountColumn?: number; overview?: boolean};

function xml(value: string) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function shortName(value: string, maximum: number) {
  let result = '';
  for (const letter of value) {if (result.length + letter.length > maximum) break; result += letter;}
  return result;
}
export function employeeSheetName(name: string, month: string, used: Set<string>) {
  const base = name.replace(/[\\/\[\]:*?\u0000-\u001f]/g, ' ').trim().replace(/^'+|'+$/g, '') || '员工';
  const suffix = `_${month.slice(0, 4)}年${month.slice(5)}月`;
  for (let index = 1; ; index++) {
    const extra = index === 1 ? '' : `(${index})`;
    const candidate = shortName(base, 31 - suffix.length - extra.length) + extra + suffix;
    if (!used.has(candidate.toLocaleLowerCase())) {used.add(candidate.toLocaleLowerCase()); return candidate;}
  }
}
export function payrollExportSheets(rows: TransferSheetRow[], month: string): PayrollExportSheet[] {
  if (!monthIsValid(month)) throw new Error('请选择有效月份。');
  const sheets: PayrollExportSheet[] = [{name: '工资总览', overview: true, rows: [
    [`${month} 工资汇总（已通过金额）`],
    ['员工姓名', '联系方式', '收款方式', '收款单位', '支店', '收款账号', '账户名', '收款人姓名', '收款人证件号', `${month} 日元 JPY`, `${month} 人民币 CNY`],
  ]}];
  const used = new Set(['工资总览']);
  for (const row of rows) {
    const name = row.user.displayName.trim() || row.user.email;
    const records = (row.records ?? []).filter(record => record.workDate.startsWith(month + '-') && [2, 3, 4].includes(record.status))
      .sort((left, right) => left.workDate.localeCompare(right.workDate) || left.id.localeCompare(right.id));
    const approved = (currency: 'JPY'|'CNY') => records.filter(record => record.status === 3 && record.currency === currency).reduce((sum, record) => sum + record.finalSalary, 0);
    // Assigned-only reviewers do not receive or export an employee's payment or ID data.
    const p = row.completeProfile ? row.profile : null;
    const payee = p ? effectivePayee(p, name) : null;
    sheets[0].rows.push([name, p?.tel ?? '', p ? paymentMethodLabel(p.bankType) : '', p?.bankName ?? '', p?.bankBranch ?? '', p?.bankAccountNumber ?? '', p?.bankAccountHolder ?? '', payee?.name ?? '', payee?.idNumber ?? '', approved('JPY'), approved('CNY')]);
    sheets.push({name: employeeSheetName(name, month, used), currencyColumn: 1, amountColumn: 2, rows: [
      [`${name} · ${month} 工资明细`, '', '', '日元 JPY 已通过', approved('JPY'), '人民币 CNY 已通过', approved('CNY')],
      ['员工姓名', '币种', '申报金额（含补贴）', '状态', '工作日期', '工作内容', '部门', '工作负责人', '指定审核员', '计费方式', '单价', '数量', '开始时间', '结束时间', '计薪工时', '休息时间（小时）', '交通起点', '交通终点', '交通费', '餐补', '杂费', '备注', '审批时间', '审核备注'],
      ...records.map(record => detailRow(name, record)),
    ]});
  }
  return sheets;
}
function paymentMethodLabel(value: string) {
  return value === 'jp-bank' ? '日本银行账户' : value === 'cn-bank' ? '中国银行账户' : value === 'alipay' ? '支付宝' : '';
}
function detailRow(name: string, r: SalaryRecord): Cell[] {
  return [name, r.currency === 'CNY' ? '人民币 CNY' : '日元 JPY', r.finalSalary, STATUS[r.status].label, r.workDate, r.workContent,
    getDepartmentLabel(r.departmentKey, r.departmentLabel), r.checkUser, r.reviewerName || (r.reviewerUserId ? '已分配' : '未指定审核员，由管理员处理'),
    getApplyTypeLabel(r.applyType), r.rate, r.amount, r.startTime, r.endTime, r.workHours, r.restHours, r.travelStart, r.travelEnd,
    r.travelFee, r.mealFee ?? 0, r.miscFee ?? 0, r.memo, r.checkDate ? formatJapanDateTime(r.checkDate) : '', r.auditMemo];
}
function columnName(index: number) {
  let value = index + 1; let name = '';
  while (value) {value--; name = String.fromCharCode(65 + value % 26) + name; value = Math.floor(value / 26);}
  return name;
}
function worksheet(sheet: PayrollExportSheet) {
  const width = Math.max(...sheet.rows.map(row => row.length));
  const widths = sheet.overview ? [23, 27, 20, 25, 18, 29, 24, 23, 34, 24, 26]
    : [23, 18, 23, 14, 16, 36, 16, 23, 32, 16, 16, 12, 14, 14, 16, 22, 23, 23, 16, 16, 16, 36, 25, 36];
  const body = sheet.rows.map((row, index) => `<row r="${index + 1}"${index === 0 ? ' ht="32" customHeight="1"' : index === 1 ? ' ht="36" customHeight="1"' : ''}>${row.map((value, column) => {
    const style = index === 0 ? 5 : index === 1 ? 1 : sheet.overview && column === 9 ? 2 : sheet.overview && column === 10 ? 3
      : (column === sheet.currencyColumn || column === sheet.amountColumn) ? (row[sheet.currencyColumn!] === '人民币 CNY' ? 3 : 2) : typeof value === 'string' ? 4 : 0;
    const address = `${columnName(column)}${index + 1}`;
    return typeof value === 'number' && Number.isFinite(value)
      ? `<c r="${address}" s="${style}"><v>${value}</v></c>`
      : `<c r="${address}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(String(value ?? ''))}</t></is></c>`;
  }).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((value, index) => `<col min="${index + 1}" max="${index + 1}" width="${value}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData><autoFilter ref="A2:${columnName(width - 1)}${Math.max(2, sheet.rows.length)}"/><mergeCells count="1"><mergeCell ref="A1:${sheet.overview ? columnName(width - 1) : 'C'}1"/></mergeCells></worksheet>`;
}
export function buildPayrollWorkbook(rows: TransferSheetRow[], month: string) {
  const sheets = payrollExportSheets(rows, month);
  const files: Record<string, Uint8Array> = {};
  const add = (path: string, content: string) => {files[path] = strToU8(content);};
  const ns = 'http://schemas.openxmlformats.org/package/2006/relationships';
  add('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  add('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${ns}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  add('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`);
  add('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${ns}">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  add('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><sz val="11"/><color rgb="FF2161A8"/><name val="Calibri"/></font><font><sz val="11"/><color rgb="FFC23732"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="3" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/><xf numFmtId="3" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
  sheets.forEach((sheet, index) => add(`xl/worksheets/sheet${index + 1}.xml`, worksheet(sheet)));
  return zipSync(files, {level: 6});
}
