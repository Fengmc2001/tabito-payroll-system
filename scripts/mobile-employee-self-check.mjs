import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {chromium, webkit} from 'playwright';

const project = process.env.PAYROLL_TEST_PROJECT_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.PAYROLL_TEST_BASE_URL;
const fixture = JSON.parse(await readFile(join(project, '.local/permissions-qa-accounts.json'), 'utf8'));
if (!base || fixture.base !== base || !['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Use the matching isolated localhost QA fixture.');
const {createRecord} = await import(pathToFileURL(join(project, 'app/lib/payroll.ts')));
const engine = process.env.PAYROLL_TEST_ENGINE || 'chromium';
const browser = await (engine === 'webkit' ? webkit : chromium).launch({headless: true, ...(engine !== 'webkit' && process.env.PAYROLL_TEST_BROWSER_CHANNEL ? {channel: process.env.PAYROLL_TEST_BROWSER_CHANNEL} : {})});
const output = process.env.PAYROLL_TEST_OUTPUT || join(project, '.local/mobile-employee-qa', engine);
await mkdir(output, {recursive: true});
let checks = 0;
const evidence = [], errors = [];
const equal = (a, b, label) => {assert.deepEqual(a, b, label); checks++;};
const month = '2032-10';
const [adminActor,,,employeeActor] = fixture.accounts;
async function api(context, path, method = 'GET', data, expected = 200) {
  const response = await context.request.fetch(base + path, {method, headers: {origin: base}, ...(data === undefined ? {} : {data})});
  const result = await response.json();
  equal(response.status(), expected, `${method} ${path}: ${JSON.stringify(result)}`);
  return result;
}
async function login(actor, width = 375, height = 812) {
  const context = await browser.newContext({viewport: {width, height}, isMobile: true, hasTouch: true, deviceScaleFactor: 2, timezoneId: 'Asia/Tokyo'});
  const {account} = await api(context, '/api/users/login', 'POST', {email: actor.email, passwordDigest: createHash('sha256').update(actor.password).digest('hex')});
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  return {context, page, account};
}
const field = (page, label, within = page) => within.locator('.form-field').filter({has: page.locator('.form-field__label', {hasText: new RegExp('^' + label + '\\*?$')})}).first();
async function settleValue(locator, value) {
  await locator.page().waitForFunction(([element, wanted]) => element.value === wanted, [await locator.elementHandle(), value]);
  equal(await locator.inputValue(), value, 'field value after React update');
}
async function geometry(page, label, width) {
  const result = await page.evaluate(() => ({width: innerWidth, scroll: document.documentElement.scrollWidth, scale: visualViewport?.scale,
    boxes: [...document.querySelectorAll('.content-card,.salary-draft-section,.salary-record-section,.history-item,.record-detail-modal,.small-modal,.time-input__popover')].filter(e => e.getClientRects().length).map(e => ({name: e.className, left: e.getBoundingClientRect().left, right: e.getBoundingClientRect().right}))}));
  evidence.push({label, ...result});
  equal(result.width, width, `${label}: viewport does not shrink to fit overflow`);
  equal(result.scroll <= width + 1, true, `${label}: document remains inside viewport`);
  equal(result.boxes.every(box => box.left >= -1 && box.right <= width + 1), true, `${label}: cards and popup frames stay inside viewport`);
}
async function goto(page, route, heading) {
  await page.goto(base + '/#' + route);
  await page.getByRole('heading', {name: heading, exact: true}).waitFor();
}
async function chooseMonth(page) {
  await page.locator('input[type="month"]').first().fill(month);
  await page.waitForFunction(value => document.querySelector('input[type="month"]').value === value, month);
}
async function screenshot(page, name) {await page.screenshot({path: join(output, name + '.png')});}
async function assertTimePicker(page, button, label, width) {
  await button.click();
  const picker = page.getByRole('group', {name: label + '选择', exact: true});
  await picker.waitFor();
  const sizes = await picker.locator('select').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().width));
  equal(sizes.length, 2, 'hour and minute controls both present');
  equal(sizes.every(size => size >= 70), true, `${label}: time values are readable beside native select arrows`);
  await geometry(page, label + ' picker', width);
  await screenshot(page, `${width}-${label}-picker`);
  await page.keyboard.press('Escape');
  await picker.waitFor({state: 'hidden'});
}
try {
  const admin = await login(adminActor);
  const user = await login(employeeActor);
  equal(user.account.role, 'employee', 'ordinary employee role');
  equal(user.account.access.subjectUserIds, [], 'ordinary employee has no approval grants');
  equal(user.account.access.features, {summary: false, employees: false, audit: false}, 'no privileged feature grants');
  const options = await api(user.context, '/api/payroll-options');
  const manager = options.workManagers[0];
  const fileResponse = await user.context.request.post(base + '/api/uploads', {headers: {origin: base}, multipart: {file: {name: 'mobile-' + randomUUID() + '.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF')}}});
  equal(fileResponse.status(), 201, 'isolated attachment fixture');
  const file = (await fileResponse.json()).file.key;
  const created = [];
  for (const status of [1, 2, 3, 4]) {
    const record = {...createRecord(user.account.id), id: 'salary-mobile-' + randomUUID(), workDate: month + '-15', checkUserId: manager.id, checkUser: manager.label,
      departmentKey: 'dept-teaching', applyType: 2, currency: status === 4 ? 'CNY' : 'JPY', rate: 10000000, amount: 1,
      includeTravel: true, includeSubsidies: true, travelFee: 10000000, mealFee: 100, miscFee: 33,
      workContent: '手机边界测试 https://example.invalid/' + 'A'.repeat(180), memo: '编号' + 'XYZ0123456789'.repeat(20), attachments: [file]};
    const result = await api(admin.context, '/api/staff/payroll/records', 'POST', {targetUserId: user.account.id, record, submit: status !== 1}, 201);
    if (status > 2) await api(admin.context, '/api/review/salary-records/' + record.id, 'PATCH', {decision: status === 3 ? 'approve' : 'reject', auditMemo: status === 4 ? '请核对测试补贴' : '', expectedUpdatedAt: result.record.updatedAt});
    created.push({id: record.id, status});
  }
  await admin.context.close(); await user.context.close();
  console.log('PASS: ordinary employee fixture with four statuses and long content');

  for (const width of [320, 375, 390, 430]) {
    const {context, page} = await login(employeeActor, width);
    await goto(page, '/pay/salary', '本期工资申报'); await chooseMonth(page);
    await page.locator('.salary-table-wrap').nth(3).waitFor();
    equal(await page.locator('.app-nav').getByRole('button', {name: '账号权限', exact: true}).count(), 0, 'employee has no admin navigation');
    await geometry(page, `${width} salary`, width);
    for (const section of await page.locator('.salary-draft-section,.salary-record-section').all()) {
      const wrap = section.locator('.salary-table-wrap');
      await wrap.evaluate(element => {element.scrollLeft = element.scrollWidth;});
      equal(await wrap.evaluate(element => element.scrollLeft > 0), true, 'only salary table scrolls horizontally');
      await section.getByRole('button', {name: '详情与审批记录', exact: true}).first().click();
      await page.getByRole('heading', {name: '提交与审批记录', exact: true}).waitFor();
      const detail = page.getByRole('dialog', {name: '工资明细与审批记录', exact: true});
      await geometry(page, `${width} detail`, width);
      await detail.locator('summary').first().click();
      const money = await detail.locator('.record-history-entry .money-value').evaluateAll(elements => elements.map(e => ({right: e.getBoundingClientRect().right, parent: e.closest('dd')?.getBoundingClientRect().right})));
      equal(money.length > 0 && money.filter(item => item.parent).every(item => item.right <= item.parent + 1), true, 'large amounts do not overlap adjacent detail columns');
      const body = detail.locator('.record-detail-body');
      const scrolled = await body.evaluate(element => {element.scrollTop = element.scrollHeight; return {top: element.scrollTop, max: element.scrollHeight - element.clientHeight};});
      equal(Math.abs(scrolled.top - scrolled.max) <= 1, true, 'detail history scrolls to its bottom');
      const attachment = detail.locator('.attachment-links a').first();
      const download = await context.request.get(new URL(await attachment.getAttribute('href'), base).href);
      equal(download.status(), 200, 'employee can read own wage attachment');
      await screenshot(page, `${width}-detail-${await section.locator('h2').first().innerText()}`);
      await page.getByRole('button', {name: '关闭详情', exact: true}).click();
    }
    await geometry(page, `${width} salary after closing all details`, width);
    if (engine !== 'webkit') {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.synthesizePinchGesture', {x: Math.floor(width / 2), y: 350, scaleFactor: 1.7, gestureSourceType: 'touch'});
      equal(await page.evaluate(() => visualViewport.scale > 1.2), true, 'mobile pinch actually zooms in');
      await page.locator('.salary-table-wrap').first().evaluate(element => {element.scrollLeft = element.scrollWidth;});
      await cdp.send('Emulation.setPageScaleFactor', {pageScaleFactor: 1});
      await geometry(page, `${width} zoom-scroll-reset`, width); await cdp.detach();
    }
    await page.setViewportSize({width: 844, height: 390}); await geometry(page, 'landscape', 844);
    await page.setViewportSize({width, height: 812}); await geometry(page, 'portrait after horizontal scroll', width);
    await page.getByRole('button', {name: /新建工资记录/}).click();
    await page.locator('.record-modal').waitFor();
    await assertTimePicker(page, page.getByRole('button', {name: '开始时间', exact: true}), '开始时间', width);
    await page.locator('.record-modal').getByRole('button', {name: '取消', exact: true}).click();

    await goto(page, '/pay/history', '往期工资一览'); await chooseMonth(page);
    await page.locator('.history-item').first().waitFor();
    await geometry(page, `${width} long URL and memo in history`, width);
    await screenshot(page, `${width}-history`);
    await goto(page, '/profile/setting', '个人&账户信息');
    for (const tab of ['基本信息', '证件信息', '账户信息', '重设密码']) {
      await page.getByRole('button', {name: tab, exact: true}).click();
      await geometry(page, `${width} profile ${tab}`, width);
    }
    await goto(page, '/pay/salary/self-batch', '本人批量申报');
    await page.getByRole('button', {name: '逐日安排', exact: true}).click();
    equal(await field(page, '休息时间').locator('select').evaluate(element => element.getBoundingClientRect().width >= 200), true, 'calendar rest duration has room for its full label');
    equal(await page.locator('.batch-payroll-form .form-section').nth(1).evaluate(element => getComputedStyle(element).paddingTop), '24px', 'fieldset preserves batch section spacing');
    for (const label of ['开始', '结束']) await assertTimePicker(page, page.getByRole('button', {name: label, exact: true}).first(), label, width);
    await page.getByRole('button', {name: '+添加日期', exact: true}).click();
    equal(await page.locator('.calendar-session-row').count(), 2, 'employee can add another day');
    await page.getByRole('button', {name: '删除这个时段', exact: true}).last().click();
    equal(await page.locator('.calendar-session-row').count(), 1, 'employee can remove extra day');
    await field(page, '工作内容').locator('input').fill('手机未保存确认');
    await page.locator('.app-nav').getByRole('button', {name: '个人&账户信息', exact: true}).click();
    await page.getByRole('alertdialog').waitFor();
    await geometry(page, `${width} unsaved confirmation`, width);
    await screenshot(page, `${width}-unsaved`);
    await page.getByRole('button', {name: '继续填写', exact: true}).click();
    equal(await field(page, '工作内容').locator('input').inputValue(), '手机未保存确认', 'cancel navigation preserves inputs');
    await context.close();
  }
  console.log('PASS: mobile tables, details, history, profile tabs, time controls and unsaved confirmation');

  const {context, page} = await login(employeeActor);
  await goto(page, '/pay/salary/self-batch', '本人批量申报'); await chooseMonth(page);
  await page.getByRole('button', {name: '逐日安排', exact: true}).click();
  await field(page, '工作负责人').locator('select').selectOption({index: 1});
  await field(page, '工作所属部门').locator('select').selectOption('dept-teaching');
  await field(page, '计费方式').locator('select').selectOption('2');
  await field(page, '单价').locator('input').fill('100'); await field(page, '件数').locator('input').fill('1');
  await field(page, '工作内容').locator('input').fill('独立手机批量复测-' + randomUUID());
  const included = page.getByRole('checkbox', {name: '包含补贴（每条）', exact: true});
  await included.check();
  await field(page, '每条交通费（往返）').locator('input').fill('400'); await field(page, '每条餐补').locator('input').fill('800');
  await field(page, '每条杂费').locator('input').fill('100'); await included.uncheck();
  await page.getByRole('checkbox', {name: '生成后直接提交审核', exact: true}).uncheck();
  let release, notify; const gate = new Promise(resolve => {release = resolve;}); const started = new Promise(resolve => {notify = resolve;});
  await page.route('**/api/staff/payroll/batches', async route => {notify(); await gate; await route.continue();});
  const response = page.waitForResponse(r => r.url().endsWith('/api/staff/payroll/batches') && r.request().method() === 'POST');
  await page.getByRole('button', {name: '生成 1 条记录', exact: true}).click(); await started;
  try {
    const controls = await page.locator('.batch-payroll-form input,.batch-payroll-form select,.batch-payroll-form button').evaluateAll(elements => elements.map(element => element.matches(':disabled')));
    equal(controls.length > 10 && controls.every(Boolean), true, 'every batch form control is locked while generating');
  } finally {release();}
  equal((await response).status(), 201, 'batch generation succeeds');
  await page.waitForFunction(() => !document.querySelector('.batch-submit-row button').disabled);
  await page.unroute('**/api/staff/payroll/batches');
  await included.check(); await settleValue(field(page, '每条杂费').locator('input'), '');
  await settleValue(field(page, '单价').locator('input'), '100');
  await field(page, '每条交通费（往返）').locator('input').fill('400'); await field(page, '每条餐补').locator('input').fill('800');
  await field(page, '每条杂费').locator('input').fill('100');
  const generated = page.waitForResponse(r => r.url().endsWith('/api/staff/payroll/batches') && r.request().method() === 'POST');
  await page.getByRole('button', {name: '生成 1 条记录', exact: true}).click();
  const saved = await (await generated).json();
  equal([saved.records[0].travelFee, saved.records[0].mealFee, saved.records[0].miscFee, saved.records[0].finalSalary], [400, 800, 100, 1400], 'saved draft includes exactly entered subsidies');
  await page.waitForFunction(() => !document.querySelector('.batch-submit-row button').disabled);
  await settleValue(field(page, '每条杂费').locator('input'), '');
  await included.uncheck(); await included.check(); await settleValue(field(page, '每条杂费').locator('input'), '');
  await settleValue(field(page, '每条餐补').locator('input'), '800');
  await context.close();
  equal(errors, [], 'no browser JavaScript errors');
  const result = {result: 'PASS', engine, checks, widths: [320, 375, 390, 430], landscape: [844, 390], fixtureMonth: month, base, evidence, screenshots: output};
  await writeFile(join(output, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({...result, evidence: undefined}));
} finally {await browser.close();}
