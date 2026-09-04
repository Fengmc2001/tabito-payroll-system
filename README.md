# 旅人教育工资管理系统

可直接运行的工资申报、审批、员工档案、账号权限和总审计系统。界面使用左侧标签卡导航，数据库为 Cloudflare D1（SQLite 兼容），附件保存到私有 R2 存储桶。

## 已实现功能

- 三级角色：员工 `employee`、审核员 `reviewer`、管理员 `admin`，权限全部由服务端校验。
- 空数据库首次初始化：第一个账号固定为 `TabitoAdimin01@tabitoedu.com`，必须同时提交由部署者预先配置的 `BOOTSTRAP_SECRET`（至少 16 个字符）并自行设置账号密码，该账号自动获得管理员权限。
- 首次资料门禁：注册后先提交中文姓名、现住址和可多行联系方式。进入工资功能前，页面会用常驻提示、页内错误和弹窗同时列出尚缺的每一项，不再无提示地跳回资料页。
- 资料校验：生日必须是四位年份的有效日期；登录身份证件、资格外活动许可和抚养资料均为选填；“银行卡正反面”须上传 1–2 个附件。
- 工资申报：默认显示当前自然月，也可选择其他月份；未提交、待审核、已驳回、已通过完整保留，提交动作只处理所选月份的草稿。
- 状态提示：成功、警示和说明会同时显示为页面内嵌提醒与右上角弹窗，字段范围、文件数量和业务校验错误也使用同一套双重提示。
- 双币种：申报时从下拉框选择日元或人民币；`JPY` 使用蓝色文字，`CNY` 使用暖红色文字。所有月度/年度统计按币种分开，不直接相加。
- 工作负责人是独立账号权限。管理员可在“账号与权限”中授予或取消，工资申报只显示当前启用的负责人；历史记录保留申报时的姓名快照。
- 工时申报由员工自行填写休息小时和分钟，系统按分钟精确计算并从总时长中扣除；不再按连续工作时长自动扣除休息时间。
- 默认部门为事务部、教学部、美术部、正社员、特殊（具体备注）。
- 动态部门：管理员可新增/删除选项。删除为软停用，历史申报保留提交时的部门名称快照。
- 按月审批：默认查看当月全部账号，也可按账号单独查看；账号、月份和状态可组合筛选，顶部金额随当前账号范围更新。待审、通过、驳回同时保留在工作月份内，审批后不会从当月列表消失。
- 工资代报：审核员和管理员可为员工新建单条申报，或按日期范围批量生成固定排班；一次最多生成 62 条，提交失败时不会留下半批数据。同一批次使用 `requestId` 保证安全重试，不会重复创建。
- 左侧申报导航：审核员和管理员可直接从“工资申报”下进入“本人申报 / 他人单条申报 / 他人多条申报”；普通员工只显示本人可用的工资申报入口。
- 定期申报：批量排班可保存为按月规则，支持暂停、恢复、删除和手动生成。Cloudflare 定时任务会分页处理到期规则，同一规则同一月份只生成一次。
- 审批来源可追踪：本人申报、单条代报、批量代报和定期生成都会保存工资所属人、创建人、提交人、批次及规则来源。按当前运营规则，管理员和审核员可以审批本人或自己代报的记录，最终付款前仍由人工核对。
- 并发保护：本人草稿、代报草稿、账号权限和定期规则使用版本校验；整月提交、批量代报和关键审计写入使用 D1 原子批处理，过期页面不能覆盖较新的修改。
- `04 工资审核`：左侧分为“工资审批”和“工资汇总”。工资汇总可按月查看姓名、联系方式、收款资料、分币种已审批金额与全部 PDF，并可将纯文本字段导出为 Excel。
- `06 员工管理`：按账号查看员工全部资料、附件、历史申报、总工资、按月工资和审批/审计记录。
- `07 总审计`：当月/年度已审批支出、待审/驳回、部门分解；选择员工后，月度、年度、逐月及部门汇总都会按该账号过滤，并显示该账号当月操作追踪。
- 管理员和审核员页面均显示最近 10 条后台/业务操作，并可查看员工上传的证件、银行资料和工资附件。操作人优先显示已注册姓名，缺失时才回退到邮箱。
- 导航、提醒、审计指标、附件和转账操作使用语义一致的 SVG 图标，减少阅读纯文本的时间；图标来自 [Lucide](https://lucide.dev/)（ISC License）。

## 本地启动

需要 Node.js 22.13 或更高版本。

```bash
npm ci
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars，把 BOOTSTRAP_SECRET 换成至少 16 个字符的本地专用密钥
npm run dev
```

访问 `http://localhost:3000/#/account/login`。空库首次注册时，在页面的“首次设置密钥”中填入 `.dev.vars` 里的同一值。`npm run dev` 会在启动前自动执行本地 D1 迁移。D1 会保存为 `.local/payroll-v2/` 内的 SQLite 文件，R2 附件也在同一本地状态目录；该目录已被 Git 忽略。旧版本的 `.local/payroll-demo/` 不含迁移日志，因此会原样保留，新启动命令不会改动它。

### 完整本地灰度演示（12 个账号）

灰度演示会创建泠泠、阿惟、UP、阿稳、john 和授课老师 A–G，并写入 35 条双币种工资样例。它必须使用独立的本地 D1/R2；先把 `.dev.vars` 设置为：

```dotenv
DEPLOYMENT_STAGE=gray
GRAY_ENVIRONMENT_ID=tabito-payroll-isolated-gray-v1
BOOTSTRAP_SECRET=LocalGrayBootstrap2026!
```

在一个终端启动独立灰度服务，再在另一个终端用一行命令初始化并验证：

```bash
PAYROLL_LOCAL_STATE_PATH=.local/gray-demo npm run dev -- --port 3200

PAYROLL_GRAY_BASE_URL=http://localhost:3200 PAYROLL_BOOTSTRAP_SECRET='LocalGrayBootstrap2026!' npm run gray:install
```

密码会随机生成并只保存在 Git 忽略的 `0600` 本地文件中。需要登录时运行：

```bash
PAYROLL_GRAY_BASE_URL=http://localhost:3200 npm run gray:credentials
```

完整账号、金额、币种、验证和一行清除命令见 [`docs/gray-testing.md`](docs/gray-testing.md)。原来的 `npm run demo:seed` 仍保留为两账号快速烟雾测试，但不作为完整审计初始化。

## 验证

```bash
npm run lint
npx tsc --noEmit
npm run self-check:logic
npm run self-check:delegated-ui
npm run build
npm audit --omit=dev
```

后端权限自检必须对一次性本地数据库运行：

```bash
# 先在 .dev.vars 中设置：BOOTSTRAP_SECRET="SelfCheckBootstrap2026!"
PAYROLL_LOCAL_STATE_PATH=.local/backend-audit \
npm run dev -- --port 3200

# 另一终端
PAYROLL_TEST_BASE_URL=http://localhost:3200 \
PAYROLL_TEST_ADMIN_PASSWORD='set-a-test-password' \
PAYROLL_TEST_BOOTSTRAP_SECRET='SelfCheckBootstrap2026!' \
npm run self-check:backend

PAYROLL_TEST_BASE_URL=http://localhost:3200 \
PAYROLL_TEST_ADMIN_PASSWORD='set-a-test-password' \
PAYROLL_TEST_BOOTSTRAP_SECRET='SelfCheckBootstrap2026!' \
npm run self-check:proxy
```

2026-09-04 的完整回归结果：纯逻辑 27 个断言、代报与导航界面 18 个断言、后端账号/权限/业务 408 个断言、代报/批量/定期规则 226 个断言，全部通过。回归还覆盖一次 62 条批量代报及重放、21 条同月草稿原子提交、旧密码登录与管理员改密竞态、改密会话轮换，以及从空库依次执行 `0000`–`0006` 迁移。独立灰度库另外完成重复幂等初始化、205 项校验和安全清除。详细权限矩阵见 [`docs/backend-self-check.md`](docs/backend-self-check.md)，浏览器与鲁棒性检查见 [`docs/robustness-test-report.md`](docs/robustness-test-report.md)。

## 部署

生产环境推荐 Cloudflare Workers + D1 + 私有 R2，与源码的运行时、SQLite 语义和文件权限模型完全一致。仓库已包含 `wrangler.jsonc`、Drizzle 迁移、生产构建/部署命令和自定义域名流程。

按 [`docs/server-deployment.md`](docs/server-deployment.md) 操作：创建 D1/R2、填入 D1 ID、执行迁移、部署 Worker、用 `wrangler secret put` 配置首次初始化密钥、绑定域名，然后使用固定首个管理员账号进行初始化。

需要在独立 D1/R2 中试用 12 个管理员、审核员和员工账号时，按 [`docs/gray-testing.md`](docs/gray-testing.md) 使用 `gray:install` 一行初始化并验证，用 `gray:retire` 一行清除并恢复正式空库。测试密码只写入本地忽略文件；生产环境不会自动写入测试数据。

### 为什么不使用 GitHub Pages

GitHub Pages 只能托管静态文件，无法运行本项目的登录 API、`HttpOnly` 会话、工资审批、D1 数据库、私有 R2 附件和服务端权限校验。因此它不能作为完整测试环境；最多只能另做一份无真实数据、无登录和无审批的 UI 样稿。本仓库保持完整服务器版本，测试部署请使用 Cloudflare Workers 或兼容的全栈服务器。

## 安全与数据

- 密码在浏览器先摘要，服务端再用随机盐 + PBKDF2-SHA-256（120,000 次）保存。
- 会话使用 24 小时 `HttpOnly` + `SameSite=Strict` Cookie，D1 只保存会话令牌的 SHA-256 摘要。
- 连续 5 次密码错误后锁定 15 分钟；停用账号、撤销会话或管理员重置密码会使旧会话失效。
- 附件只接受图片/PDF，单文件上限 10 MB；每个账号最多保存 200 个附件、合计 250 MB。R2 不开放公共访问，只能通过带会话权限检查的 API 读取。
- 审计日志不记录密码、密码摘要或原始会话令牌。
- `BOOTSTRAP_SECRET` 只通过本地忽略的 `.dev.vars` 或 Cloudflare 加密 Secret 提供，不写入 `wrangler.jsonc` 或 GitHub 仓库。
- 生产数据库、R2 附件、`.env*`、`.local/`、`.wrangler/` 不会进入 Git。

## 主要目录

- `app/components/`：左侧导航、资料、本人申报、工资代报、审批、员工管理和总审计页面。
- `app/api/`：账号、工资、代报批次、定期规则、附件、审批、部门、员工和审计 API。
- `app/lib/server/payroll-store.ts`：D1/R2 持久化、权限、状态机、快照和审计的服务端权威实现。
- `db/schema.ts` 与 `drizzle/`：可检查的 SQLite/D1 schema 与迁移。
- `scripts/`：隔离灰度初始化与清除、两账号烟雾数据、逻辑/界面/后端/代报回归脚本。
- `.github/workflows/ci.yml`：每次 push/PR 自动执行 lint、TypeScript、生产依赖审计、纯逻辑、代报界面、生产构建、两组后端回归和定时任务冒烟测试。

## 与参考站的关系

本工程是根据有权访问的公开前端行为和界面重新实现，并补齐实际可运行的后台、数据库、附件授权和审计能力。它不依赖原站 API、数据库或云存储。
