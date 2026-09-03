# 灰度测试数据

本项目的灰度数据不会随启动或部署自动写入。只有显式执行 `gray:seed`，且服务端同时满足 `DEPLOYMENT_STAGE=gray` 与固定的 `GRAY_ENVIRONMENT_ID=tabito-payroll-isolated-gray-v1` 时，才能创建测试数据。

## 隔离要求

灰度环境必须使用独立的 Worker、D1 数据库和 R2 存储桶。`gray:clear` 会清空这组专用 D1/R2，绝不能将生产 D1/R2 绑定到灰度 Worker。固定环境标识是防误操作的第二道门槛，不能替代资源隔离。

- 灰度 Worker：`DEPLOYMENT_STAGE=gray` 且 `GRAY_ENVIRONMENT_ID=tabito-payroll-isolated-gray-v1`
- 生产 Worker：`DEPLOYMENT_STAGE=production` 或不设置
- 任一标识缺失或不精确匹配时，`/api/admin/gray-fixtures` 一律返回 404
- 清除还要求有效管理员会话和完整确认口令
- seed、verify 和 clear 脚本会核对服务端返回的固定环境标识，不匹配就立即停止

本地灰度测试可在已被 Git 忽略的 `.dev.vars` 中填写：

```dotenv
DEPLOYMENT_STAGE=gray
GRAY_ENVIRONMENT_ID=tabito-payroll-isolated-gray-v1
BOOTSTRAP_SECRET=replace-with-a-gray-only-secret
```

然后用一个全新的本地状态目录启动：

```bash
PAYROLL_LOCAL_STATE_PATH=.local/gray-runtime npm run dev -- --port 3200
```

Cloudflare 灰度 Worker 则应在它自己的 Wrangler 配置中设置：

```json
{
  "vars": {
    "DEPLOYMENT_STAGE": "gray",
    "GRAY_ENVIRONMENT_ID": "tabito-payroll-isolated-gray-v1"
  }
}
```

不要在生产配置中使用该值。

## 初始化

第一次运行会生成 12 个随机密码，并仅写入 `.local/gray-fixture-credentials.json`。文件权限固定为 `0600`，`.local/` 已被 Git 忽略，脚本不会把密码打印到终端。

推荐用一行命令完成初始化并立即验证：

```bash
PAYROLL_GRAY_BASE_URL=https://你的灰度域名 PAYROLL_GRAY_MONTH=2026-09 PAYROLL_BOOTSTRAP_SECRET=replace-with-the-same-gray-bootstrap-secret npm run gray:install
```

`gray:install` 内部依次执行 `gray:seed` 和 `gray:verify`。生产部署和普通启动命令均不会调用它。需要分步排查时，仍可分别运行底层命令，并为 `gray:seed` 显式设置 `PAYROLL_GRAY_CONFIRM=SEED-GRAY-FIXTURE`。

如果灰度库已有首管理员，但本机还没有凭据文件，可在首次运行时另外传入 `PAYROLL_GRAY_ADMIN_PASSWORD`。它会和其他随机密码一样只写入本机权限文件。

初始化完成后，如需查看本机灰度账号密码，显式运行：

```bash
PAYROLL_GRAY_BASE_URL=https://你的灰度域名 npm run gray:credentials
```

该命令只读取与当前灰度地址匹配的本地凭据文件。请勿把输出复制到源码、工单、截图或生产配置；清除灰度数据时，凭据文件也会默认删除。

脚本通过正常注册、资料保存、附件上传、权限设置、代申报、批量申报、自动规律和审批 API 创建：

- 管理员：泠泠（固定邮箱 `TabitoAdimin01@tabitoedu.com`）
- 审核员：阿惟、UP、阿稳、john
- 员工：授课老师 A–G
- 授课老师 F/G 只有 CNY，D 同时有 JPY/CNY
- 待审、通过、驳回三种状态，以及本人、他人单条、他人多条三种创建来源
- 7 条固定授课自动规律

同一地址、月份和凭据文件下可重复执行；批量请求使用确定性 `requestId`，已有工资不会被重复创建。如果管理员佣金已创建为草稿，但上一次 seed 在提交前中断，重跑会继续提交该草稿并收敛到待审状态。如果 D1 中出现不属于这 12 个账号的用户，初始化会立即停止。

账号、姓名、角色和工资样例均由仓库中的 `scripts/gray-fixture-common.mjs` 统一定义，`seed` 与 `verify` 共用同一份定义；固定密码不在仓库内。默认样例如下：

| 姓名 | 角色 | 样例币种 | 当月样例合计 |
|---|---|---|---:|
| 泠泠 | 管理员 | JPY | JPY 42,000 |
| 阿惟 | 审核员 | JPY | JPY 60,000 |
| UP | 审核员 | JPY | JPY 36,000 |
| 阿稳 | 审核员 | JPY | JPY 40,000 |
| john | 审核员 | JPY | JPY 32,000 |
| 授课老师 A | 员工 | JPY | JPY 24,000 |
| 授课老师 B | 员工 | JPY | JPY 33,600 |
| 授课老师 C | 员工 | JPY | JPY 25,600 |
| 授课老师 D | 员工 | JPY、CNY | JPY 24,000；CNY 1,600 |
| 授课老师 E | 员工 | JPY | JPY 24,000 |
| 授课老师 F | 员工 | CNY | CNY 1,440 |
| 授课老师 G | 员工 | CNY | CNY 3,200 |

固定课表和阿惟的授课样例使用“按时”，管理收入使用“定给”，泠泠佣金及一次性教学资料支援使用“其他（固定金额）”。验证脚本还会按账号检查当月总额：仅为判断测试数据是否合理，固定使用 `1 CNY = 20 JPY`，并要求每个账号不超过 JPY 100,000 等值。该换算不会进入业务页面、工资统计或审批逻辑。

## 验证

```bash
PAYROLL_GRAY_BASE_URL=http://localhost:3200 npm run gray:verify
```

验证脚本会从凭据文件自动读取初始化月份，并检查：

- 12 个账号的登录、角色、姓名、资料与附件
- 35 条工资的币种、金额、状态、幂等性与来源
- 工资申报类别及每个账号的测试月合计上限
- 7 条结构化自动规律
- 管理员、审核员、普通员工的权限边界
- 管理员和审核员审批本人记录的既定权限与审计来源
- 员工本人、审核员和管理员的附件读取
- 审计动作和灰度实体清单

建议连续执行两次 `gray:seed`，再运行 `gray:verify`，用于确认重试不会产生重复记录。

## 一键清除并恢复 bootstrap

`gray:clear` 会先用审核员会话验证禁止访问，再用错误确认口令验证拒绝，最后才会执行真实清除。真正清除前，服务端还必须验证 `gray-v1` 清单中至少登记了完整的 12 个账号、这些账号仍然存在，且固定首管理员仍正常。任一条件不符合都会以 409 拒绝整库操作。

验证通过后，服务端会先确认清单中每一个 R2 附件在当前绑定中真实存在，再锁定不可变的清除计划。它只会删除该计划中的精确附件键，不会扫描或清空整个存储桶；随后清除这个专用 D1 内的账号和业务数据，并在同一个 D1 批处理中重建默认部门、开放注册设置，写入不可逆的“灰度维护已退役”标志。若误绑到不包含这些附件的 R2，操作会在删除 D1 前拒绝。

```bash
PAYROLL_GRAY_BASE_URL=https://你的灰度域名 npm run gray:retire
```

`gray:retire` 内置完整确认口令并调用底层 `gray:clear`；服务端仍会核对隔离环境标识、管理员会话、12 个精确账号和附件清单。需要直接调用底层脚本时，使用 `PAYROLL_GRAY_CONFIRM=DELETE-ALL-GRAY-PAYROLL-DATA npm run gray:clear`。

成功后：

- 所有旧会话失效
- `/api/bootstrap-status` 返回 `bootstrapRequired: true`
- 下一个注册账号仍被服务端固定为 `TabitoAdimin01@tabitoedu.com`
- `/api/admin/gray-fixtures` 永久返回 404，即使灰度的两个环境标识仍保留也无法再 seed 或清除
- 本地凭据文件会被删除；如需临时保留，可设置 `PAYROLL_GRAY_KEEP_CREDENTIALS=1`

因此这一条命令已经将数据状态和维护能力一并切换到正式模式。随后由真实部署者为固定首管理员设置新密码即可。为了配置语义也一致，仍建议在下次部署时将 `DEPLOYMENT_STAGE` 改为 `production`；这不是恢复正式模式的前置条件。

退役是 one-way 操作。如需重新进行灰度测试，必须创建新的隔离 D1/R2，不应删除或改写退役标志。

## 清除的不可分割边界

D1 事务与 R2 对象删除无法组成一个跨服务事务。维护端点会在 D1 中持久化清除计划，再删除并验证计划内的 R2 附件，最后批量清理 D1。如果网络在两步之间中断，在绑定不变的同一隔离灰度环境重新执行 `gray:clear`，会沿用原计划并收敛到完全清空状态。
