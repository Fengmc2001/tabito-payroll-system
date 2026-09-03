import assert from 'node:assert/strict';
import {
  birthdayIsValid,
  createRecord,
  dateIsValid,
  expandFixedPayrollSchedule,
  getWorkHours,
  getWorkMinutes,
  monthDateRange,
  monthIsValid,
  mutationRequestIsSameOrigin,
  nextPaymentDate,
  recalculateRecord,
} from '../app/lib/payroll.ts';

const checks = [];

check(dateIsValid('2024-02-29'), 'a real leap-day is accepted');
check(!dateIsValid('2026-02-29'), 'a non-leap-year February 29 is rejected');
check(!dateIsValid('2026-02-31'), 'an impossible calendar date is rejected');
check(!birthdayIsValid('9999-01-01'), 'a future birthday is rejected');
check(!birthdayIsValid('0999-12-31'), 'a birthday year earlier than four-digit input range is rejected');
check(getWorkMinutes('09:00', '09:10') === 10, 'work duration retains exact minutes');
check(getWorkHours('09:00', '09:10') === 0.17, 'display hours remain rounded to two decimals');

const tenMinuteRecord = recalculateRecord({
  ...createRecord('logic-user'),
  applyType: 1,
  rate: 1000,
  startTime: '09:00',
  endTime: '09:10',
});
check(tenMinuteRecord.finalSalary === 166, 'ten minutes at an hourly rate of 1000 pays 166 after flooring');
check(tenMinuteRecord.workHours === 0.17, 'ten-minute work time displays as 0.17 hours');

const fiveMinuteBreakRecord = recalculateRecord({
  ...createRecord('logic-user'),
  applyType: 1,
  rate: 1000,
  startTime: '09:00',
  endTime: '10:00',
  restHours: 0.08,
});
check(fiveMinuteBreakRecord.finalSalary === 916, 'a five-minute break is deducted with minute precision');
check(fiveMinuteBreakRecord.workHours === 0.92, 'fifty-five paid minutes display as 0.92 hours');

const sixtyFiveMinuteBreakRecord = recalculateRecord({
  ...createRecord('logic-user'),
  applyType: 1,
  rate: 1200,
  startTime: '09:00',
  endTime: '18:10',
  restHours: 1.08,
  travelFee: 300,
});
check(sixtyFiveMinuteBreakRecord.finalSalary === 10000, 'a 65-minute break does not introduce decimal-hour salary drift');
check(sixtyFiveMinuteBreakRecord.workHours === 8.08, '485 paid minutes display as 8.08 hours');

check(nextPaymentDate('2026-01-31') === '2026/02/10', 'January month-end resolves to February 10');
check(nextPaymentDate('2024-12-31') === '2025/01/10', 'December month-end resolves to January 10 of the next year');

check(monthIsValid('2026-09'), 'a valid business month is accepted');
check(!monthIsValid('2026-13'), 'an impossible business month is rejected');
check(monthDateRange('2024-02')?.lastDay === 29, 'leap-year February exposes all 29 days');
check(monthDateRange('2026-02')?.end === '2026-02-28', 'ordinary February ends on day 28');

const thursdaysInLeapFebruary = expandFixedPayrollSchedule('2024-02', {
  rangeStart: '2024-02-01',
  rangeEnd: '2024-02-29',
  weekdays: [4],
  startTime: '18:00',
  endTime: '20:00',
  restHours: 0.25,
});
check(
  thursdaysInLeapFebruary.map((session) => session.workDate).join(',')
    === '2024-02-01,2024-02-08,2024-02-15,2024-02-22,2024-02-29',
  'fixed weekly schedules include every matching day in a leap month',
);
check(thursdaysInLeapFebruary.every((session) => session.restHours === 0.25), 'fixed schedules preserve the selected break duration');
check(expandFixedPayrollSchedule('2026-02', {
  rangeStart: '2026-01-31',
  rangeEnd: '2026-02-28',
  weekdays: [1],
  startTime: '09:00',
  endTime: '10:00',
  restHours: 0,
}).length === 0, 'a fixed schedule cannot cross the selected month boundary');

check(mutationRequestIsSameOrigin('GET', 'https://other.example.test', 'https://payroll.example.test', 'same-site'), 'read requests are not blocked by the mutation guard');
check(mutationRequestIsSameOrigin('POST', 'https://payroll.example.test', 'https://payroll.example.test', 'same-origin'), 'same-origin browser mutations are accepted');
check(!mutationRequestIsSameOrigin('POST', 'https://other.example.test', 'https://payroll.example.test', 'same-site'), 'a sibling-origin mutation is rejected');
check(!mutationRequestIsSameOrigin('POST', null, 'https://payroll.example.test', 'same-site'), 'same-site Fetch Metadata is rejected without an Origin header');
check(mutationRequestIsSameOrigin('POST', null, 'https://payroll.example.test', null), 'non-browser CLI requests remain supported');

assert.equal(checks.length, 27);
process.stdout.write(`${JSON.stringify({ result: 'PASS', checks: checks.length }, null, 2)}\n`);

function check(condition, message) {
  assert.ok(condition, message);
  checks.push(message);
}
