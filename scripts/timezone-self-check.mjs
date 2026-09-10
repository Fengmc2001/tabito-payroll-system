import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  PAYROLL_TIME_ZONE, birthdayIsValid, createRecord, currentMonth, dateInJapan,
  dateIsValid, formatJapanDateTime, monthDateRange, nextPaymentDate, today,
} from '../app/lib/payroll.ts';
import { currentMonthTokyo } from './gray-fixture-common.mjs';

const zones = ['UTC', 'Asia/Tokyo', 'Asia/Shanghai', 'America/Los_Angeles', 'Pacific/Auckland', 'Pacific/Kiritimati'];
const cases = [
  ['2026-09-30T14:59:59.999Z', '2026-09-30', '2026/9/30 23:59:59', '2026/10/10'],
  ['2026-09-30T15:00:00.000Z', '2026-10-01', '2026/10/1 00:00:00', '2026/11/10'],
  ['2026-09-30T23:30:00.000Z', '2026-10-01', '2026/10/1 08:30:00', '2026/11/10'],
  ['2026-12-31T14:59:59.999Z', '2026-12-31', '2026/12/31 23:59:59', '2027/01/10'],
  ['2026-12-31T15:00:00.000Z', '2027-01-01', '2027/1/1 00:00:00', '2027/02/10'],
  ['2024-02-28T15:00:00.000Z', '2024-02-29', '2024/2/29 00:00:00', '2024/03/10'],
  ['2024-02-29T15:00:00.000Z', '2024-03-01', '2024/3/1 00:00:00', '2024/04/10'],
  ['2026-03-08T10:00:00.000Z', '2026-03-08', '2026/3/8 19:00:00', '2026/04/10'],
];

if (!process.argv.includes('--child')) {
  let total = 0;
  for (const zone of zones) {
    const result = spawnSync(process.execPath, ['--experimental-strip-types', fileURLToPath(import.meta.url), '--child'], {
      env: { ...process.env, TZ: zone }, encoding: 'utf8', timeout: 30_000,
    });
    assert.equal(result.status, 0, `${zone}: ${result.stderr || result.error || result.stdout}`);
    const checks = Number(result.stdout.trim());
    assert.ok(Number.isInteger(checks) && checks > 0, `valid check count in ${zone}`);
    total += checks;
    console.log(`PASS ${zone}: ${checks} checks`);
  }
  console.log(`Timezone self-check passed: ${total} assertions across ${zones.length} host timezones.`);
} else {
  let checks = 0;
  const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
  const RealDate = Date;
  let instant = cases[0][0];
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return RealDate.parse(instant); }
  };

  // Execute the real service function with empty, isolated storage. This checks
  // the server's period selection without importing the Cloudflare runtime.
  const source = ts.createSourceFile('payroll-store.ts', readFileSync(new URL('../app/lib/server/payroll-store.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const node = source.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === 'getAuditOverview');
  assert.ok(node, 'audit service function exists');
  const compiled = ts.transpileModule(node.getText(source).replace(/^export /, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const dependencies = {
    currentMonth,
    database: async () => ({ prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }) }),
    requireFeature: async () => {}, recordAccessSql: () => '1',
    listStaffEmployeesInternal: async () => [], recordFromRow: (row) => row,
    summarizeRecords: (records, month) => ({ month, count: records.length }),
    queryAuditLogs: async () => [],
  };
  const auditOverview = new Function(...Object.keys(dependencies), compiled + '; return getAuditOverview;')(...Object.values(dependencies));

  try {
    equal(PAYROLL_TIME_ZONE, 'Asia/Tokyo', 'one Japan business timezone');
    for (const [timestamp, date, display, paymentDate] of cases) {
      instant = timestamp;
      const month = date.slice(0, 7);
      equal(today(), date, 'today uses Japan even if host timezone differs');
      equal(currentMonth(), month, 'salary and summary default to Japan month');
      equal(currentMonthTokyo(), month, 'gray fixture uses the same month');
      equal(dateInJapan(new Date(timestamp)), date, 'timestamp maps to Japan calendar date');
      equal(formatJapanDateTime(timestamp), display, 'displayed timestamps use Japan time');
      const record = createRecord('timezone-test');
      equal(record.workDate, date, 'new salary defaults to Japan work date');
      equal([record.createdAt, record.updatedAt], [timestamp, timestamp], 'stored UTC timestamps do not shift');
      equal(birthdayIsValid(date), true, 'current Japan date is accepted');
      const tomorrow = new RealDate(RealDate.parse(date + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10);
      equal(birthdayIsValid(tomorrow), false, 'future Japan birthday is rejected');
      equal(nextPaymentDate(''), paymentDate, 'payment fallback uses Japan month');
      const overview = await auditOverview({ userId: 'timezone-test', role: 'admin' }, {});
      equal([overview.year, overview.month], [date.slice(0, 4), month], 'server audit defaults roll over at Japan midnight');
      const selected = await auditOverview({ userId: 'timezone-test', role: 'admin' }, { year: '2020', month: '2020-02' });
      equal([selected.year, selected.month], ['2020', '2020-02'], 'explicit historical month remains unchanged');
      const fallback = await auditOverview({ userId: 'timezone-test', role: 'admin' }, { year: '2020', month: 'invalid' });
      equal([fallback.year, fallback.month], ['2020', '2020-' + month.slice(5)], 'selected audit year retains Japan fallback month');
    }
    equal(nextPaymentDate('2026-01-31'), '2026/02/10', 'calendar month-end is timezone independent');
    equal(nextPaymentDate('2026-12-31'), '2027/01/10', 'calendar year rollover is unchanged');
    equal(dateIsValid('2024-02-29'), true, 'valid date-only leap day is unchanged');
    equal(dateIsValid('2026-02-29'), false, 'invalid date-only leap day remains invalid');
    equal(monthDateRange('2024-02')?.end, '2024-02-29', 'schedule calendar dates do not shift');
  } finally {
    globalThis.Date = RealDate;
  }
  console.log(checks);
}
