import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {unzipSync, strFromU8} from 'fflate';
import {createRecord} from '../app/lib/payroll.ts';

const base = process.env.PAYROLL_TEST_BASE_URL;
const fixture = JSON.parse(readFileSync('.local/permissions-qa-accounts.json', 'utf8'));
if (!base || fixture.base !== base || !['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Only use the matching isolated local QA database.');
const [admin, reviewer, , owner, other] = fixture.accounts;
let checks = 0;
const equal = (actual, expected, label) => {assert.deepEqual(actual, expected, label); checks++;};
const browser = await chromium.launch({headless: true, ...(process.env.PAYROLL_TEST_BROWSER_CHANNEL ? {channel: process.env.PAYROLL_TEST_BROWSER_CHANNEL} : {})});
const failures = [];
mkdirSync('.local/october-qa/screens', {recursive: true});
async function api(context, path, method = 'GET', body, expected = 200) {
  const response = await context.request.fetch(base + path, {method, headers: {origin: base}, ...(body === undefined ? {} : {data: body})});
  const result = await response.json();
  equal(response.status(), expected, `${method} ${path}: ${JSON.stringify(result)}`);
  return result;
}
async function login(actor, width = 1440) {
  const context = await browser.newContext({viewport: {width, height: 980}, timezoneId: 'Asia/Tokyo', acceptDownloads: true});
  context.setDefaultTimeout(20000);
  context.setDefaultNavigationTimeout(20000);
  await api(context, '/api/users/login', 'POST', {email: actor.email, passwordDigest: createHash('sha256').update(actor.password).digest('hex')});
  const page = await context.newPage();
  page.on('pageerror', error => failures.push(error.message));
  return {context, page};
}
const field = (root, label) => {
  const page = typeof root.page === 'function' ? root.page() : root;
  return root.locator('.form-field').filter({has: page.locator('.form-field__label', {hasText: new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\*?$')})}).first();
};
async function expectValue(input, expected, label) {
  await input.page().waitForFunction(([element, value]) => element.value === value, [await input.elementHandle(), expected], {timeout: 3000});
  equal(await input.inputValue(), expected, label);
}
async function goto(page, route, heading) {
  await page.goto(base + '/#' + route);
  await page.getByRole('heading', {name: heading, exact: true}).waitFor();
}
async function cancelDraft(page) {
  await page.locator('.record-modal').getByRole('button', {name: '取消', exact: true}).click();
  const abandon = page.getByRole('button', {name: '放弃修改', exact: true});
  if (await abandon.isVisible()) await abandon.click();
  await page.locator('.record-modal').waitFor({state: 'hidden'});
}
async function noOverflow(page, label) {
  const size = await page.evaluate(() => ({width: innerWidth, scroll: document.documentElement.scrollWidth}));
  equal(size.scroll <= size.width + 1, true, `${label}: ${JSON.stringify(size)}`);
}
try {
  const a = await login(admin);
  for (const [time, month] of [['2026-10-02T23:59:00+09:00', '2026-09'], ['2026-10-03T23:59:59+09:00', '2026-09'], ['2026-10-04T00:00:00+09:00', '2026-10']]) {
    await a.page.clock.setFixedTime(new Date(time));
    for (const [route, heading] of [['/pay/salary', '本期工资申报'], ['/pay/salary/self-batch', '本人批量申报'], ['/pay/salary/single', '他人单条申报'], ['/pay/salary/batch', '工资申报'], ['/review/salary', '工资审核工作台'], ['/review/summary', '工资汇总']]) {
      await goto(a.page, route, heading);
      equal(await a.page.locator('input[type="month"]').inputValue(), month, `${route} defaults on Japan date ${time}`);
    }
  }
  console.log('PASS: month cutoff on all filing and review pages');
  const o = await login(owner);
  await o.page.clock.setFixedTime(new Date('2026-10-07T12:00:00+09:00'));
  await goto(o.page, '/pay/salary', '本期工资申报');
  await o.page.getByRole('button', {name: /新建工资记录/}).click();
  const modal = o.page.locator('.record-modal');
  await modal.waitFor();
  await field(modal, '计费方式').locator('select').selectOption('2');
  equal(await field(modal, '工作所属部门').locator('select').inputValue(), '', 'billing can be chosen before department');
  await field(modal, '计费方式').locator('select').selectOption('1');
  await modal.getByRole('button', {name: '开始时间', exact: true}).click();
  equal(await modal.getByLabel('开始时间小时', {exact: true}).inputValue(), '12', 'blank hour picker begins at noon');
  equal((await modal.getByLabel('开始时间小时', {exact: true}).locator('option').allTextContents()).includes('24'), false, 'start picker does not offer invalid 24:00');
  equal(await modal.getByLabel('开始时间数值', {exact: true}).inputValue(), '', 'opening picker alone does not save a time');
  await o.page.keyboard.press('Escape');
  equal(await modal.isVisible(), true, 'Escape closes the time picker, not the salary form');
  await modal.getByRole('button', {name: '开始时间', exact: true}).click();
  await modal.getByRole('group', {name: '开始时间选择', exact: true}).getByRole('button', {name: '确定', exact: true}).click();
  await modal.getByRole('button', {name: '结束时间', exact: true}).click();
  equal(await modal.getByLabel('结束时间小时', {exact: true}).inputValue(), '12', 'end picker also starts at noon');
  await modal.getByLabel('结束时间小时', {exact: true}).selectOption('24');
  equal(await modal.getByLabel('结束时间分钟', {exact: true}).locator('option').allTextContents(), ['00'], 'end-of-day minutes are restricted to 00');
  await modal.getByLabel('结束时间小时', {exact: true}).selectOption('15');
  await modal.getByRole('group', {name: '结束时间选择', exact: true}).getByRole('button', {name: '确定', exact: true}).click();
  await field(modal, '工作负责人').locator('select').selectOption({index: 1});
  await field(modal, '工作所属部门').locator('select').selectOption('dept-teaching');
  await field(modal, '工作单价').locator('input').fill('2000');
  await field(modal, '工作内容').locator('textarea').fill('浏览器独立测试-' + randomUUID());
  const included = modal.getByRole('checkbox', {name: '包含补贴', exact: true});
  await included.check();
  await field(modal, '交通起点').locator('input').fill('新宿');
  await field(modal, '交通终点').locator('input').fill('中野');
  await field(modal, '交通费（往返）').locator('input').fill('400');
  await field(modal, '餐补').locator('input').fill('1713');
  await field(modal, '杂费').locator('input').fill('77');
  const saveResponse = o.page.waitForResponse(response => response.url().endsWith('/api/salary-records') && response.request().method() === 'POST');
  await modal.getByRole('button', {name: '保存', exact: true}).click();
  const saved = await (await saveResponse).json();
  equal([saved.record.status, saved.record.finalSalary, saved.record.mealFee, saved.record.miscFee], [1, 8190, 1713, 77], 'real browser saves calculated subsidies without submitting');
  await modal.waitFor({state: 'hidden'});
  await o.page.getByRole('button', {name: /新建工资记录/}).click();
  await included.check();
  await expectValue(field(modal, '交通费（往返）').locator('input'), '400', 'new record restores travel from an unsubmitted draft');
  await expectValue(field(modal, '餐补').locator('input'), '1713', 'new record restores last saved meal');
  await expectValue(field(modal, '杂费').locator('input'), '', 'new record never prefills miscellaneous expenses');
  await field(modal, '餐补').locator('input').fill('1900');
  await included.uncheck();
  await included.check();
  await expectValue(field(modal, '餐补').locator('input'), '1900', 'toggling preserves the current manual input');
  for (const width of [375, 320, 1440]) {
    await o.page.setViewportSize({width, height: 980});
    await modal.getByRole('button', {name: '开始时间', exact: true}).click();
    await noOverflow(o.page, `salary time popup at ${width}px`);
    await o.page.screenshot({path: `.local/october-qa/screens/salary-${width}.png`});
    await o.page.keyboard.press('Escape');
  }
  await cancelDraft(o.page);
  console.log('PASS: draft subsidies, noon time picker, mobile form');
  await goto(o.page, '/pay/salary/self-batch', '本人批量申报');
  await field(o.page, '计费方式').locator('select').selectOption('2');
  await o.page.getByRole('checkbox', {name: '包含补贴（每条）', exact: true}).check();
  await expectValue(field(o.page, '每条餐补').locator('input'), '1713', 'batch filing uses the same saved meal default');
  await expectValue(field(o.page, '每条杂费').locator('input'), '', 'batch miscellaneous starts blank');
  await o.context.close();
  const settings = await api(a.context, '/api/payroll-options');
  const manager = settings.workManagers[0];
  async function reviewFixture(actor, decision) {
    const record = {...createRecord(actor.id), id: 'salary-browser-' + randomUUID(), workDate: '2030-09-10', checkUserId: manager.id, checkUser: manager.label, departmentKey: 'dept-teaching', applyType: 2, rate: 1500, amount: 1, workContent: '审核账号选项独立测试'};
    const result = await api(a.context, '/api/staff/payroll/records', 'POST', {targetUserId: actor.id, record, submit: true}, 201);
    if (decision) await api(a.context, '/api/review/salary-records/' + result.record.id, 'PATCH', {decision, expectedUpdatedAt: result.record.updatedAt});
    return result.record;
  }
  await reviewFixture(other, 'approve');
  const pending = await reviewFixture(owner);
  const reviewItems = await api(a.context, '/api/review/salary-records');
  const ownerIds = new Set(reviewItems.items.filter(item => item.user.id === owner.id && item.record.workDate.startsWith('2030-09')).map(item => item.record.id));
  await goto(a.page, '/review/salary', '工资审核工作台');
  await a.page.locator('input[type="month"]').fill('2030-09');
  for (const width of [1440, 375, 320]) {
    await a.page.setViewportSize({width, height: 980});
    await a.page.locator('.review-account-trigger').click();
    await a.page.getByRole('listbox').waitFor();
    // Account IDs are stable; names may have been changed by another regression.
    const users = await api(a.context, '/api/admin/users');
    const otherName = users.users.find(user => user.id === other.id).displayName;
    const ownerName = users.users.find(user => user.id === owner.id).displayName;
    const green = a.page.getByRole('option').filter({hasText: otherName}).first();
    equal((await green.getAttribute('class'))?.includes('is-complete'), true, 'processed account has a light green completion option');
    equal(await green.locator('.review-account-state').innerText(), '当月审核完毕', 'completion also has text');
    await a.page.screenshot({path: `.local/october-qa/screens/accounts-${width}.png`});
    await a.page.getByLabel('搜索员工', {exact: true}).fill(ownerName);
    const ownerOption = a.page.getByRole('option').filter({hasText: ownerName}).first();
    equal((await ownerOption.getAttribute('class'))?.includes('is-complete') ?? false, false, 'pending employee is not marked completed');
    await noOverflow(a.page, `review account popup at ${width}px`);
    await ownerOption.click();
    const displayedIds = await a.page.locator('.review-table-row').evaluateAll(elements => elements.map(element => element.getAttribute('data-record-id')));
    equal(displayedIds.length > 0 && displayedIds.every(id => ownerIds.has(id)), true, 'account picker shows only actual selected-owner records, including earlier QA runs');
    equal(await a.page.locator(`.review-table-row[data-record-id="${pending.id}"]`).count(), 1, 'selected account retains the newly created record');
    const scroll = a.page.locator('.review-table-scroll');
    await scroll.evaluate(element => {element.scrollLeft = element.scrollWidth;});
    await noOverflow(a.page, `review table scrolled at ${width}px`);
    const operation = a.page.locator('.review-table-row .review-table-operation').first();
    equal(await operation.evaluate(element => getComputedStyle(element).position), 'sticky', 'operation stays fixed while scrolling');
    await a.page.screenshot({path: `.local/october-qa/screens/review-${width}.png`});
  }
  await a.page.locator('.review-account-trigger').click();
  await a.page.getByRole('option', {name: '全部账号', exact: true}).click();
  await a.page.locator('input[type="month"]').fill('2030-10');
  await a.page.locator('.review-account-trigger').click();
  equal(await a.page.locator('.review-account-menu .is-complete').count(), 0, 'month change clears completion markings');
  await a.page.keyboard.press('Escape');
  console.log('PASS: searchable monthly account completion and contained horizontal table');
  await goto(a.page, '/review/summary', '工资汇总');
  await a.page.locator('input[type="month"]').fill('2026-10');
  const downloadPromise = a.page.waitForEvent('download');
  await a.page.getByRole('button', {name: '导出 Excel', exact: true}).click();
  const download = await downloadPromise;
  equal(download.suggestedFilename().endsWith('.xlsx'), true, 'browser downloads a real xlsx file');
  const downloadPath = '.local/october-qa/browser-export.xlsx';
  await download.saveAs(downloadPath);
  const workbook = unzipSync(readFileSync(downloadPath));
  equal(strFromU8(workbook['xl/workbook.xml']).includes('工资总览'), true, 'download includes overview sheet');
  equal(strFromU8(workbook['xl/workbook.xml']).includes('_2026年10月'), true, 'download includes named monthly employee sheets');
  equal(Object.keys(workbook).filter(path => /^xl\/worksheets\/sheet\d+\.xml$/.test(path)).length > 2, true, 'all visible employees have separate sheets');
  await a.context.close();
  const r = await login(reviewer, 375);
  await goto(r.page, '/review/salary', '工资审核工作台');
  const visible = await api(r.context, '/api/review/salary-records');
  await r.page.locator('.review-account-trigger').click();
  equal(await r.page.getByRole('option').count(), new Set(visible.items.map(item => item.user.id)).size + 1, 'reviewer picker cannot reveal unauthorized employees');
  await r.page.keyboard.press('Escape');
  await goto(r.page, '/review/summary', '工资汇总');
  equal(await r.page.getByLabel('汇总查看范围', {exact: true}).inputValue(), 'assigned', 'reviewer default export scope remains assigned only');
  await r.context.close();
  equal(failures, [], 'no browser JavaScript exceptions');
  const result = {result: 'PASS', checks, base, browser: 'Chromium', screenshots: '.local/october-qa/screens', downloadedWorkbook: downloadPath};
  writeFileSync('.local/october-qa/browser-results.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {await browser.close();}
