# 旅人教育工资管理系统

可直接运行的工资申报、审批、员工档案、账号权限和总审计系统。界面使用左侧标签卡导航，数据库为 Cloudflare D1（SQLite 兼容），附件保存到私有 R2 存储桶。

## 已实现功能

- 三级角色：员工 `employee`、审核员 `reviewer`、管理员 `admin`，权限全部由服务端校验。
- 空数据库首次初始化：第一个账号固定为 `TabitoAdimin01@tabitoedu.com`，部署者在注册页自行设置密码，该账号自动获得管理员权限。
- 首次资料门禁：注册后必须先填中文姓名、现住址和可多行联系方式，才能进入业务页。
- 工资申报：7 种计费方式、服务端重算、图片/PDF 附件、复制草稿和工资状态机。
- 双币种：申报时从下拉框选择日元或人民币；日元为蓝色标识，人民币为暖红色标识。所有月度/年度统计按币种分开，不直接相加。
- 工作负责人仅有“籍诚”。默认部门为事务部、教学部、美术部、正社员、特殊（具体备注）。
- 动态部门：管理员可新增/删除选项。删除为软停用，历史申报保留提交时的部门名称快照。
- 按月审批：待审、通过、驳回同时保留在工作月份内，审批后不会从当月列表消失。
- `06 员工管理`：员工全部资料、附件、历史申报、总工资、按月工资和审批/审计记录。
- `07 总审计`：当月/年度已审批支出、待审/驳回、部门分解、指定账号+月份的全操作追踪。
- 管理员和审核员页面均显示最近 10 条后台/业务操作，并可查看员工上传的证件、银行资料和工资附件。

## 本地启动

需要 Node.js 22.13 或更高版本。

```bash
npm ci
npm run dev
```

访问 `http://localhost:3000/#/account/login`。本地 D1 会保存为 `.local/payroll-demo/` 内的 SQLite 文件，R2 附件也在同一本地状态目录；该目录已被 Git 忽略。

### 两个本地演示账号

在一个终端启动服务，再在另一个终端执行初始化：

```bash
npm run dev:demo
npm run demo:seed
```

| 角色 | 账号 | 本地演示密码 |
|---|---|---|
| 管理员 | `TabitoAdimin01@tabitoedu.com` | `TabitoAdmin2026!` |
| 员工 | `employee@tabito.local` | `TabitoEmployee2026!` |

初始化会放入两条待审记录：`JP¥ 8,000` 和 `CN¥ 5,000`，便于立即试用通过/驳回、月度留存和双币种统计。初始化后公开注册会自动关闭。

## 验证

```bash
npm run lint
npx tsc --noEmit
npm run build
```

后端权限自检必须对一次性本地数据库运行：

```bash
PAYROLL_LOCAL_STATE_PATH=.local/backend-audit npm run dev -- --port 3200

# 另一终端
PAYROLL_TEST_BASE_URL=http://localhost:3200 \
PAYROLL_TEST_ADMIN_PASSWORD='set-a-test-password' \
npm run self-check:backend
```

最新自检通过 185 个断言。详细权限矩阵与边界见 [`docs/backend-self-check.md`](docs/backend-self-check.md)。

## 部署

生产环境推荐 Cloudflare Workers + D1 + 私有 R2，与源码的运行时、SQLite 语义和文件权限模型完全一致。仓库已包含 `wrangler.jsonc`、Drizzle 迁移、生产构建/部署命令和自定义域名流程。

按 [`docs/server-deployment.md`](docs/server-deployment.md) 操作：创建 D1/R2、填入 D1 ID、执行迁移、部署 Worker、绑定域名，然后使用固定首个管理员账号进行初始化。

## 安全与数据

- 密码在浏览器先摘要，服务端再用随机盐 + PBKDF2-SHA-256（120,000 次）保存。
- 会话使用 24 小时 `HttpOnly` + `SameSite=Strict` Cookie，D1 只保存会话令牌的 SHA-256 摘要。
- 连续 5 次密码错误后锁定 15 分钟；停用账号、撤销会话或管理员重置密码会使旧会话失效。
- 附件只接受图片/PDF，单文件上限 10 MB；R2 不开放公共访问，只能通过带会话权限检查的 API 读取。
- 审计日志不记录密码、密码摘要或原始会话令牌。
- 生产数据库、R2 附件、`.env*`、`.local/`、`.wrangler/` 不会进入 Git。

## 主要目录

- `app/components/`：左侧导航、资料、申报、审批、员工管理和总审计页面。
- `app/api/`：账号、工资、附件、审批、部门、员工和审计 API。
- `app/lib/server/payroll-store.ts`：D1/R2 持久化、权限、状态机、快照和审计的服务端权威实现。
- `db/schema.ts` 与 `drizzle/`：可检查的 SQLite/D1 schema 与迁移。
- `scripts/`：两账号演示数据和后端权限自检。
- `.github/workflows/ci.yml`：每次 push/PR 自动执行 lint、TypeScript 和生产构建。

## 与参考站的关系

本工程是根据有权访问的公开前端行为和界面重新实现，并补齐实际可运行的后台、数据库、附件授权和审计能力。它不依赖原站 API、数据库或云存储。
