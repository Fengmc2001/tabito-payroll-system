import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {unzipSync, strFromU8} from 'fflate';
import {createEmptyProfile, createRecord, defaultPayrollMonth, recalculateRecord, cloneAsDraft} from '../app/lib/payroll.ts';
import {reviewAccountOptions} from '../app/lib/review-accounts.ts';
import {buildPayrollWorkbook, employeeSheetName, payrollExportSheets} from '../app/lib/payroll-export.ts';

let checks = 0;
const equal = (a, b, label) => {assert.deepEqual(a, b, label); checks++;};
for (const [date, expected] of [
  ['2026-09-30T15:00:00.000Z', '2026-09'], ['2026-10-02T15:00:00.000Z', '2026-09'],
  ['2026-10-03T14:59:59.999Z', '2026-09'], ['2026-10-03T15:00:00.000Z', '2026-10'],
  ['2026-12-31T15:00:00.000Z', '2026-12'], ['2027-01-03T15:00:00.000Z', '2027-01'],
  ['2024-02-29T15:00:00.000Z', '2024-02'], ['2026-02-28T15:00:00.000Z', '2026-02'],
]) equal(defaultPayrollMonth(new Date(date)), expected, `Japan cutoff at ${date}`);
const record = recalculateRecord({...createRecord('owner'), workDate: '2026-09-02', startTime: '12:00', endTime: '14:00', restHours: 0.5, rate: 2000, includeSubsidies: true, includeTravel: true, travelFee: 500, mealFee: 800, miscFee: 200});
equal(record.finalSalary, 4500, 'hourly salary includes all three subsidies and only manual rest');
for (const applyType of [2, 3]) equal(recalculateRecord({...record, applyType, amount: 2}).finalSalary, 5500, 'quantity salary includes subsidies');
equal(recalculateRecord({...record, applyType: 5}).finalSalary, 1500, 'expense-only record includes all subsidies');
const disabled = recalculateRecord({...record, includeSubsidies: false});
equal([disabled.travelStart, disabled.travelEnd, disabled.travelFee, disabled.mealFee, disabled.miscFee, disabled.finalSalary], ['-', '-', 0, 0, 0, 3000], 'unchecked subsidies contribute nothing');
const legacy = {...record}; delete legacy.mealFee; delete legacy.miscFee; delete legacy.includeSubsidies;
equal(recalculateRecord(legacy).finalSalary, 3500, 'legacy travel-only calculation remains unchanged');
equal(cloneAsDraft(record, 'owner').miscFee, 0, 'copying as a new record never carries miscellaneous costs');
const user = (id, name = '测试老师') => ({id, displayName: name, email: id + '@example.invalid'});
const item = (id, status, workDate = '2026-09-02') => ({user: user(id), record: {...record, status, workDate}});
const options = reviewAccountOptions([item('pending', 2), item('pending', 3), item('done', 3), item('rejected', 4), item('empty', 3, '2026-08-01'), item('draft', 1), item('voided', 5)], '2026-09');
equal(options.find(option => option.id === 'pending').complete, false, 'one pending record prevents completion');
equal(options.find(option => option.id === 'done').complete, true, 'approved account marked complete');
equal(options.find(option => option.id === 'rejected').complete, true, 'rejected account has no outstanding review');
for (const id of ['empty', 'draft', 'voided']) equal(options.find(option => option.id === id).complete, false, 'no submitted monthly wages is not completed');
equal(reviewAccountOptions([item('done', 3)], '2026-10')[0].complete, false, 'completion is reset in another month');
const rows = [0, 1, 2].map(index => ({user: user('employee-' + index, index < 2 ? '测试/老师:[同名]' : '=HYPERLINK("evil")'), profile: {...createEmptyProfile(), bankType: 'jp-bank', bankName: '测试银行', bankAccountNumber: '001234567890123456789', bankAccountHolder: 'TEST', idNumber: 'SECRET-NOT-FOR-REVIEWER'}, completeProfile: index === 0,
  approvedAmounts: {JPY: 999999, CNY: 999999}, pdfFiles: [], records: [
    {...record, id: 'approved-' + index, status: 3, memo: '原文<&>\"', currency: 'JPY'},
    {...record, id: 'cny-' + index, status: 3, currency: 'CNY', finalSalary: 50},
    {...record, id: 'pending-' + index, status: 2}, {...record, id: 'rejected-' + index, status: 4, auditMemo: '核对餐补'},
    {...record, id: 'draft-' + index, status: 1}, {...record, id: 'void-' + index, status: 5},
    {...record, id: 'previous-' + index, status: 3, workDate: '2026-08-01'},
  ]}));
const sheets = payrollExportSheets(rows, '2026-09');
equal(sheets.length, 4, 'overview plus one monthly sheet per visible employee');
equal(sheets[0].rows[2].slice(-2), [4500, 50], 'overview includes only monthly approved JPY/CNY separately');
equal(sheets[0].rows[3].slice(1, 9), Array(8).fill(''), 'assigned reviewer workbook excludes bank and ID data');
for (const sheet of sheets.slice(1)) {
  equal(sheet.rows.length, 6, 'employee sheet includes only submitted current-month records');
  equal(sheet.name.endsWith('_2026年09月'), true, 'employee sheet name labels the year and month');
  equal(/[\\/\[\]:*?]/.test(sheet.name), false, 'invalid Excel sheet-name characters are sanitized');
}
equal(new Set(sheets.map(sheet => sheet.name.toLocaleLowerCase())).size, 4, 'duplicate employee names produce distinct sheets');
const used = new Set();
for (let i = 0; i < 50; i++) equal(employeeSheetName('同名测试老师'.repeat(12) + '😀', '2026-09', used).length <= 31, true, 'long names fit Excel limits without losing month');
const workbook = buildPayrollWorkbook(rows, '2026-09');
const zip = unzipSync(workbook);
equal(!!zip['[Content_Types].xml'] && !!zip['xl/workbook.xml'] && !!zip['_rels/.rels'], true, 'real OOXML ZIP structure, not renamed XML');
const overview = strFromU8(zip['xl/worksheets/sheet1.xml']);
equal(overview.includes('001234567890123456789'), true, 'payment account preserves leading zero and precision');
equal(/<c[^>]+t="inlineStr"[^>]*><is><t[^>]*>001234567890123456789<\/t>/.test(overview), true, 'payment account stays text in Excel');
equal(strFromU8(zip['xl/worksheets/sheet2.xml']).includes('原文&lt;&amp;&gt;&quot;'), true, 'workbook escapes XML text');
equal(strFromU8(zip['xl/worksheets/sheet4.xml']).includes('<f>'), false, 'user text is never an Excel formula');
equal(strFromU8(zip['xl/styles.xml']).includes('FF2161A8') && strFromU8(zip['xl/styles.xml']).includes('FFC23732'), true, 'JPY blue and CNY red');
assert.throws(() => payrollExportSheets(rows, '2026-99')); checks++;
mkdirSync('.local/october-qa', {recursive: true});
writeFileSync('.local/october-qa/export-sample.xlsx', workbook);
console.log(JSON.stringify({result: 'PASS', checks, sample: '.local/october-qa/export-sample.xlsx'}));
