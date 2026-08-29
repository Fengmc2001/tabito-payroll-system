# 生产服务器与域名部署

本项目的生产运行时是 Cloudflare Workers，数据库是 D1（SQLite 语义），附件是私有 R2。这一组合就是项目的外部服务器、持久化数据库和文件存储；不需要另外安装 MySQL、Nginx 或对象存储服务。

Cloudflare 官方参考：[D1 创建](https://developers.cloudflare.com/d1/get-started/)、[D1 迁移](https://developers.cloudflare.com/d1/reference/migrations/)、[R2 创建](https://developers.cloudflare.com/r2/buckets/create-buckets/)、[Wrangler 与自定义域名](https://developers.cloudflare.com/workers/wrangler/configuration/)。

## 1. 准备

- Cloudflare 账号。
- 如果使用自定义域名，域名的 DNS Zone 需已接入同一 Cloudflare 账号。
- Node.js 22.13 或更高版本。
- 拥有本仓库的部署机或 CI 环境。

```bash
npm ci
npx wrangler login
```

## 2. 创建生产 D1 和 R2

```bash
npx wrangler d1 create tabito-payroll-db
npx wrangler r2 bucket create tabito-payroll-files
```

D1 命令会输出一个 UUID。打开根目录 `wrangler.jsonc`，把下列占位值：

```text
00000000-0000-4000-8000-000000000000
```

替换为刚创建的 D1 `database_id`。不要改变绑定名 `DB` 和 `FILES`，服务端代码使用这两个名称。R2 存储桶应保持私有，不需要启用 `r2.dev` 或 R2 公开域名。

## 3. 执行数据库迁移

```bash
npm run db:migrate:remote
```

该命令对 `tabito-payroll-db` 执行 `drizzle/` 内尚未应用的 SQL 迁移。新版本上线时也要先执行此命令。服务端仍有幂等的运行时 schema 检查，用于本地预览和旧数据自动补列。

## 4. 构建与部署 Worker

```bash
npm run lint
npx tsc --noEmit
npm run deploy:cloudflare
```

`deploy:cloudflare` 会先执行生产构建，再使用生成的 `dist/server/wrangler.json` 发布 Worker 与前端静态资源。命令完成后会输出一个 `workers.dev` HTTPS 地址，可先用它完成首次初始化和验收。

## 5. 绑定自定义域名

有两种做法，选其一。

### 做法 A：Cloudflare 控制台

1. 进入 Workers & Pages，选择 `tabito-payroll-system`。
2. 打开 Settings / Domains & Routes。
3. 选择 Add / Custom Domain。
4. 输入例如 `payroll.example.com`，确认创建 DNS 和 TLS 证书。

### 做法 B：写入 `wrangler.jsonc`

在顶层加入：

```jsonc
"routes": [
  {
    "pattern": "payroll.example.com",
    "custom_domain": true
  }
]
```

然后再次执行：

```bash
npm run deploy:cloudflare
```

## 6. 空数据库首次初始化

1. 打开 `https://你的域名/#/account/register`。
2. 系统检测到 D1 中没有账号时，会锁定首个管理员账号为 `TabitoAdimin01@tabitoedu.com`。
3. 部署负责人自行设置一个强密码。源码和仓库中没有生产默认密码。
4. 提交中文姓名、现住址和多行联系方式，然后补齐证件与收款信息。
5. 进入“账号与权限”，确认管理员角色，再按运营需求关闭或保持新账号注册。

这条规则有服务端强制：在空数据库中，即使绕过页面直接调用注册 API，第一个账号仍会被固定为上述邮箱并成为管理员。邮箱登录按大小写不敏感的规范化值保存。

## 7. 上线验收清单

- HTTPS 域名可打开登录/注册页。
- 首个账号名不能编辑，并且注册后是管理员。
- 新员工首先被强制导向资料页。
- 员工可上传一个测试 PDF，审核员/管理员可从 06 员工管理打开。
- 各创建一条日元和人民币工资，确认月度/年度统计分币种。
- 在员工“工资申报”选择当月，确认待审核、已驳回、已通过分别显示在不同颜色边框中，且审批通过后仍在该页。
- 在另一个月份保留一条草稿，提交当月记录，确认其他月份草稿不会被一起提交。
- 通过一条、驳回一条，确认两条都保留在当月审批页。
- 新增后删除一个部门，确认旧申报仍显示原部门名称。
- 管理员和审核员页面的最近审计不超过 10 条；在 07 总审计选择账号后，确认月度、年度、部门汇总和当月操作记录都只属于该账号。

## 8. 更新、备份与回滚

- 上线新代码前先备份 D1，再执行 `npm run db:migrate:remote`。
- 数据库迁移是向前的；代码回滚不等于数据库回滚。
- R2 保留员工证件和银行资料，应在 Cloudflare 账号中配置适合公司的保留期、管理员 MFA 与账号权限。

## 9. CI 自动部署（可选）

仓库默认 CI 只执行检查，不会擅自改动生产环境。如需在 GitHub Actions 自动部署，可在仓库 Secrets 配置 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID`，然后在工作流中显式调用 `npm run db:migrate:remote` 和 `npm run deploy:cloudflare`。
