# 生产服务器与域名部署

本项目的生产运行时是 Cloudflare Workers，数据库是 D1（SQLite 语义），附件是私有 R2。这一组合就是项目的外部服务器、持久化数据库和文件存储；不需要另外安装 MySQL、Nginx 或对象存储服务。

业务默认时区固定为日本 `Asia/Tokyo`（UTC+9），不需要设置服务器 `TZ`。工资工作日期和工时按日本当地日历填写；默认日/月/年及页面时间显示均使用日本时区，数据库事件时间戳仍保留 UTC。本次时区调整不迁移或重算历史工资。

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

**已有工资系统更新或重新安装时，跳过资源创建。** 从原部署配置恢复 Worker 名称、D1 `database_id` / `database_name`、R2 `bucket_name`、自定义域名/路径和密钥。仓库里的 D1 ID 是占位值，不是你的线上数据库；新建数据库会让旧资料暂时不可见，并不能替代原数据库。以下创建命令仅用于从未上线的全新系统。

```bash
npx wrangler d1 create tabito-payroll-db
npx wrangler r2 bucket create tabito-payroll-files
```

D1 命令会输出一个 UUID。打开根目录 `wrangler.jsonc`，把下列占位值：

```text
00000000-0000-4000-8000-000000000000
```

替换为刚创建的 D1 `database_id`。不要改变绑定名 `DB` 和 `FILES`，服务端代码使用这两个名称。R2 存储桶应保持私有，不需要启用 `r2.dev` 或 R2 公开域名。

## 3. 预先配置初始化密钥

在首次发布前，为同名 Worker 配置至少 16 个字符的随机密钥：

```bash
npx wrangler secret put BOOTSTRAP_SECRET --config wrangler.jsonc
```

若 Wrangler 提示 Worker 尚不存在，确认创建该 Worker 后继续设置密钥。这个密钥不是账号密码；不要提交到 GitHub。首次注册会由后端校验密钥的实际长度和值，长度不足或不匹配都会拒绝初始化。

发布脚本需要部署机环境变量 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN`。Token 仅授权目标 Cloudflare 账号，需具备 Worker 发布/读取设置、D1 读写、R2 存储桶读取与绑定，以及绑定域名所需权限。附件日常读写由 Worker 的 `FILES` 绑定承担；本发布脚本不清理 R2 对象。通过系统或 CI 的秘密管理配置，不要写进代码或命令记录。脚本会核对 Worker 当前绑定与本地配置，目标不一致即中止。

### 数据库迁移

```bash
npm run db:migrate:remote
```

该命令仅执行版本化 schema 迁移，不清空业务数据。正常发布脚本在构建成功后执行经过检查的增量迁移，不必重复执行。服务端启动后只做只读的最新 schema 探测；如果未迁移到最新版本，接口会拒绝服务，不会在业务请求中自动建表或回填数据。本次新增的餐补和杂费存入原工资 JSON，无需新增数据库迁移。

## 4. 构建与部署 Worker

```bash
npm run lint
npx tsc --noEmit
npm run deploy:cloudflare
```

现行 `npm run deploy:cloudflare` **始终保留数据**，即使数据库没有旧版重置完成标记，也不会清空。流程为：检查现有资源绑定与维护状态 → 检查迁移为增量变更 → 构建并核对构建产物的数据绑定 → 仅应用尚未执行的迁移 → 再次核对绑定 → 更新 Worker。不会删除 D1 业务记录、R2 附件、账号、会话或 Secret，不执行测试初始化。

发布前建议备份 D1 和 R2；脚本不会替你创建备份。若出现绑定不一致、旧版重置未完成或非增量迁移，脚本会停止，不自动恢复、清空或改绑。`--resume` 已禁用，不能用旧版重置步骤处理正常更新。若确有历史维护状态，先由部署管理员核对当前数据与备份，再另行决定恢复方案。

已有账号继续使用原密码登录，不需要重新注册。**只有真正的空数据库**才触发固定首管理员 `TabitoAdimin01@tabitoedu.com` 的初始化流程，需要预设 `BOOTSTRAP_SECRET` 和自行设置的密码。全新 Worker 可先发布，再运行 `wrangler secret put BOOTSTRAP_SECRET` 后初始化。

失败后修复报错并重新执行正常发布命令即可。不要同时发布两个版本。仓库 CI 只检查，不自动部署线上。重新下载源码时，务必保留原部署环境的资源配置、域名/路径配置及密钥；保留数据不等于自动查找或复制你的线上配置。

`wrangler.jsonc` 已配置四个每日定时触发点，用于分页处理到期的工资定期规则。Cloudflare 按 UTC 解释 Cron；当前四次触发对应日本时间每日 00:05、00:20、00:35、00:50。每个规则和月份都有唯一实例，多次触发不会重复生成工资。

如需更换初始化密钥，可重新执行：

```bash
npx wrangler secret put BOOTSTRAP_SECRET --config wrangler.jsonc
```

Wrangler 会在终端中隐藏输入内容，Cloudflare 将它作为加密 Worker Secret 保存。不要把生产值写入 `wrangler.jsonc`、`.env` 并提交，也不要在文档、日志或截图中留存。密钥未配置或长度不足时，空库注册会由服务端拒绝，不会降级为无保护的首管理员创建。

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

域名生效后，在 Cloudflare 的 SSL/TLS / Edge Certificates 中启用 [Always Use HTTPS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/always-use-https/)，确保所有 HTTP 请求先跳转到 HTTPS。服务端对除 `localhost`、`127.0.0.1` 和本机 IPv6 回环以外的主机始终签发 `Secure` 会话 Cookie；未正确启用 HTTPS 时会话不会通过明文连接工作。确认全站及所有子域都稳定支持 HTTPS 后，再按公司的域名策略评估启用 HSTS。

## 6. 空数据库首次初始化

1. 打开 `https://你的域名/#/account/register`。
2. 系统检测到 D1 中没有账号时，会锁定首个管理员账号为 `TabitoAdimin01@tabitoedu.com`。
3. 在“首次设置密钥”中输入与 `BOOTSTRAP_SECRET` 完全一致的值。该字段只在空库初始化时显示。
4. 部署负责人自行设置一个强账号密码。初始化密钥与账号密码是两个不同的值；源码和仓库中都没有生产默认值。
5. 提交中文姓名、现住址和多行联系方式，再按页面清单补齐工资功能所需资料。银行卡/支付宝账户截图、身份证件、My Number 番号、资格外活动许可和抚养资料均为选填；填写真实收款资料并核对账号。
6. 进入“账号与权限”，确认管理员角色和工作负责人权限。新账号注册默认开启，可按运营需求关闭。
7. 创建并验证第二个管理员账号，避免首管理员暂时锁定时失去全部后台入口。
8. 首管理员和第二管理员均验收完成后，可执行 `npx wrangler secret delete BOOTSTRAP_SECRET --config wrangler.jsonc` 删除只用于空库初始化的密钥；灾难恢复前再生成新的随机一次性值。

这些规则有服务端强制：在空数据库中，即使绕过页面直接调用注册 API，第一个账号仍会被固定为上述邮箱并成为管理员，而且必须提交正确的初始化密钥。邮箱登录按大小写不敏感的规范化值保存。

## 7. 上线验收清单

- HTTPS 域名可打开登录/注册页。
- `http://你的域名/` 会自动跳转到 HTTPS，登录后的会话 Cookie 带有 `Secure`、`HttpOnly` 和 `SameSite=Strict`。
- 空库下用缺失或错误的首次设置密钥无法注册。
- 使用正确密钥时，首个账号名不能编辑，并且注册后是管理员。
- 新员工首先被强制导向资料页。
- 点击工资申报时若资料不完整，确认常驻提示、页内提醒和弹窗均明确列出缺项；补齐后无需手动刷新即可进入。
- 员工可上传测试 PDF；管理员能查看，指定审核员只能下载对应申报的附件，不能下载员工证件和银行卡。为账号开通员工管理并授权该员工完整资料后，才可查看后者；撤销后直接下载地址也应被拒绝。
- 在 04 工资审核下打开“工资汇总”，选择月份后确认所需收款字段、PDF 下载和 Excel 导出。
- 管理员在“工资审批”中确认默认显示全部账号；审核员只显示指定给自己的申报。选择一个账号后，三张状态卡与审核记录只能显示该账号在当前权限范围内的数据。
- 所有账号左侧显示“本人申报 / 本人多条申报”；只有管理员额外显示两种他人申报入口。
- 各创建一条日元和人民币工资，确认月度/年度统计分币种。
- 申报长时段并填写休息小时/分钟，确认只扣除手动填写的休息时间，没有自动扣除。
- 在账号与权限中授予另一账号工作负责人权限，确认工资申报选项立即更新；取消后不能用于新申报，旧记录名称不变。
- 在员工“工资申报”选择当月，确认待审核、已驳回、已通过分别显示在不同颜色边框中，且审批通过后仍在该页。
- 在另一个月份保留一条草稿，提交当月记录，确认其他月份草稿不会被一起提交。
- 通过一条、驳回一条，确认两条都保留在当月审批页。
- 用管理员创建单条代报、批量排班与定期规则；员工和审核员只能为本人批量申报。指定两个负责人对应不同审核员，确认同一员工两笔收入不会跨审核员泄露金额、附件或审计；管理员仍能查看完整收入。
- 在账号配置授予和撤销完整资料查看权，确认生效不需要退出登录；配置功能入口本身不能增加可见员工。
- 管理员转交待审申报后，旧审核员失去访问权，新审核员看到这条申报的全部已有审批记录。旧版本没有快照的操作只显示原审计记录，不伪造历史明细。
- 新增后删除一个部门，确认旧申报仍显示原部门名称。
- 管理员和审核员页面的最近审计不超过 10 条；在 07 总审计选择账号后，确认月度、年度、部门汇总和当月操作记录都只属于该账号。

## 8. 公开访问防护

新账号注册按业务要求默认开放，因此绑定公网域名前，应在 Cloudflare Security / WAF 中为写入接口建立按来源 IP 计数的 [Rate Limiting Rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)。至少分别保护：

- 所有 `POST`、`PATCH`、`DELETE /api/*`：设置较宽的基础限速，覆盖登录后的资料、申报、审批和管理写入；
- `POST /api/users`：注册；
- `POST /api/users/login`：登录；
- `POST /api/uploads` 和 `POST /api/staff/payroll/uploads/*`：本人及代办附件上传。

阈值应按员工是否共用办公室出口 IP 调整。基础规则应明显宽于正常员工短时间连续保存和批量申报所需的请求量，再用专用规则收紧注册、登录和上传；可先采用注册每 10 分钟 10 次、登录每分钟 4 次、上传每 10 分钟 30 次。登录和注册优先使用 Managed Challenge，再根据 Security Events 中的真实流量调整。服务端还会对单账号连续登录失败执行 15 分钟锁定，并把每个账号的附件限制为 200 个、合计 250 MB；附件数量和总量在 D1 写入时原子校验，并发上传不能越过配额。

若注册页持续受到自动化攻击，可再接入 [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/get-started/)；必须同时完成浏览器组件和服务端 Siteverify 校验，不能只放前端组件。Cloudflare 配置属于部署环境，不应把任何 WAF/Turnstile 密钥写入仓库。

Worker 会为登录、注册和全部已登录写操作校验浏览器 `Origin` 与 Fetch Metadata，拒绝其他站点或同一主域的兄弟子域借用 Cookie。所有响应还会发送 `frame-ancestors 'none'` 与 `X-Frame-Options: DENY`，后台页面不能被其他站点嵌入 iframe；部署代理不得删除这些响应头。

## 9. 更新、备份与回滚

- 第一次发布本版本和后续更新均建议先备份，再执行 `npm run deploy:cloudflare`；不清空正式数据。
- 保留原 Worker、D1 ID、R2 存储桶、密钥与域名/路径配置。重新下载源码不需要重建云端数据库。
- 本地演示数据库与附件不会被服务器发布命令操作。
- 数据库迁移是向前的；代码回滚不等于数据库回滚。
- R2 保留员工证件和银行资料，应在 Cloudflare 账号中配置适合公司的保留期、管理员 MFA 与账号权限。

## 10. CI 自动部署（可选）

仓库默认 CI 只执行检查，不会改动生产环境。`CI-Only-Bootstrap-2026!` 只用于可丢弃的本地 D1，不是生产密钥。若以后授权 CI 发布，需要先配置真实的原数据库与附件绑定，以及 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`，再显式调用保留数据的发布命令。生产 `BOOTSTRAP_SECRET` 仍通过 Cloudflare Secret 独立管理，不复用 CI 值。
