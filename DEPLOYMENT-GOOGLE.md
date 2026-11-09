# Novara AI — Google Cloud 完整部署方案 v2（执行手册）

> 状态：**已按用户 2026-11-07 的新要求重写，待你确认架构后逐步执行**  
> 依据：`A:\Novara` 代码实测（未使用 README）+ Google 官方定价/文档核实（2026-11-07）  
> 取代：v1（同文件旧版，主题为「严格 $0 免费额度 + 暂不加登录」）  
> 本文件是**唯一权威部署文档**。`agent-ctx/` 下的设计稿与 v1 结论如与本文冲突，以本文为准。

---

## 0. 结论前置（先看这段，能省掉几天返工）

| 你的要求       | 本方案答案                                                                                    | 理由（后面有证据）                                                                                                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 用哪家计算服务    | **Compute Engine e2-micro 常驻 VM**，不是 Cloud Run                                           | Agent 运行在 `after()` 里跑 12 分钟、审批门可等 30 分钟、SSE 心跳靠进程内 `setInterval`、租约心跳每 10 秒。Cloud Run **产品本身有 Free Tier**，但免费额度是给「请求来了才醒、空闲缩到 0」设计的；要跑这些后台任务必须 instance-based billing + `min-instances=1` 常驻，约 **$40–44/月**（用量超额度，不是产品收费）。参见 §2.6：改成任务驱动后 Cloud Run 可以 $0 用 |
| 用哪家数据库     | **继续 SQLite，放在 VM 持久盘**，Cloud Storage 做异地备份                                              | 38 个 Prisma model、零 JSON 列、`db push` 工作流、`sqlite3 .backup` 已接进发布脚本。Cloud SQL **没有永久免费档**，db-f1-micro ≈ $7.67/月且不受 SLA 覆盖；单用户规模换库只有成本与迁移风险，没有收益                                                         |
| 存储         | **Cloud Storage 两个桶**：构建产物 + SQLite 异地备份                                                 | 代码里**没有任何文件上传功能**（导出是即时生成 JSON/Markdown 下载，`src/` 全文只有 `fs.readFileSync` 用于读 `agent/` 与 `RELEASE.json`）。别为了「Storage」这项要求去造一个不存在的需求                                                                     |
| 登录         | **Google Identity Services（Sign in with Google）→ 服务端校验 ID Token → 签名 Cookie**，配**邮箱白名单** | 项目当前是 guest session（localStorage 一个时间戳）、`next-auth` 装了但零引用、`User` 表空置、所有 Novel 平铺无 `userId`。**不做白名单就等于任何 Google 账号都能看你全部小说**                                                                           |
| 域名 / HTTPS | **Cloud DNS（可选）+ VM 上 Caddy 自动签发**                                                       | Cloud Run 域名映射官方文档标注为 Preview /「不建议用于生产」；外部 HTTPS 负载均衡才是官方推荐，但约 $18/月起，还要实例组、健康检查、转发规则。Caddy 免费且已经在仓库里                                                                                                 |
| 月费         | \*\*GCP 侧约 $0–1/月**（域名 ~$10–15/年、模型 token 另计）                                            | 见附录 A。最大的可变成本是 z.ai / 模型供应商，不是 GCP                                                                                                                                                                     |

**我没有碰你的 GCP 账户，没有执行任何部署命令。** 本文与配套文件都是待你确认后使用的配置与操作手册。

### v1 → v2 变更日志

| 项              | v1                      | v2                                               | 触发原因                                                          |
| -------------- | ----------------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| 登录             | 明确「Google OAuth 暂不加」    | **加，且强制白名单**                                     | 你本次要求第 4 项                                                    |
| 凭据存放           | `/etc/.z-ai-config` 手工写 | **Secret Manager 集中托管**，VM 启动拉取                  | 你本次要求第 7 项                                                    |
| 数据库备份          | 仅 VM 本地保留 5 份           | **加 Cloud Storage 异地备份 + 生命周期**                  | 你本次要求第 5、6 项                                                  |
| CI 检查          | 只有 lint                 | **lint + `tsc --noEmit` + 11 套 harness + build** | 你本次要求第 9 项                                                    |
| Cloud Build 机型 | `E2_HIGHCPU_8`          | **删掉，改用默认 `e2-standard-2`**                      | 官方定价页确认 `e2-highcpu-8` **不在免费额度内，$0.0156/分钟**。v1 写「免费构建分钟」是错的 |
| 域名             | Caddy + 域名              | 加 Cloud DNS / 负载均衡的成本对比                          | 你本次要求第 10 项                                                   |
| 架构             | 单一方案                    | **4 个候选量化对比后再选**                                 | 你本次要求「不要先假设适合哪种服务」                                            |

---

## 1. 项目分析（全部来自代码实测，非推断）

### 1.1 语言 / 框架 / 依赖

| 项        | 实测结果                                                                                                            | 证据                                         |
| -------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 语言       | TypeScript 5 strict（`noEmit: true`，`strict: true`，`noImplicitAny: false`）                                       | `tsconfig.json`                            |
| 框架       | **Next.js 16.1.1 App Router**，`output: "standalone"`                                                            | `package.json` / `next.config.ts`          |
| 前端       | React 19、Tailwind 4、shadcn/ui、lucide、framer-motion、zustand、@tanstack/react-query、recharts                       | `package.json`                             |
| 后端       | **57 个 Route Handlers**，全部在 `src/app/api/**/route.ts`；零 server action                                           | `find src/app/api -name route.ts \| wc -l` |
| ORM / DB | Prisma 6.11.1 + **SQLite**，`provider = "sqlite"`，`url = env("DATABASE_URL")`；**38 个 model**（AGENTS.md 写 26，已过时） | `prisma/schema.prisma`                     |
| 运行时      | Bun 1.3（本机）；生产 standalone 用 Node.js 22（`vm-setup.sh` 装）                                                         | `package.json` / `deploy/vm-setup.sh`      |
| AI       | `z-ai-web-dev-sdk`（GLM），**仅后端**，9 个调用点；`src/lib/novara/glm.ts` 是唯一直连封装，带并发信号量（maxConcurrent=2）+ 429/5xx 退避      | grep `ZAI.create()`                        |
| 构建期外部依赖  | `next/font/google`（Geist / Geist_Mono）在 `layout.tsx` → **build 时必须能访问 Google Fonts**。Cloud Build 有公网，VM 运行时不需要  | `src/app/layout.tsx`                       |
| 认证库      | `next-auth@4.24.13` 已安装但**全项目零 import**；`jose` 仅为传递依赖；`google-auth-library` 未安装                                 | grep / `node_modules`                      |
| 本地数据库    | `prisma/db/custom.db`，712 KB                                                                                    | `du -sh`                                   |

### 1.2 路由与页面架构

- **只有 1 个用户可见 page 路由**：`src/app/page.tsx` → `<NovaraApp />`。
- `src/hooks/use-hash-route.ts` 用 `location.hash` 切 7 个视图（home / product / plans / about / terms / privacy / **writer**）。
- `src/components/novara/novara-app.tsx`：`route === "writer"` 时渲染 `WriterApp`，进入前调 `enterGuestSession()` 写一个 localStorage 时间戳。
- **结论（对认证设计是决定性的）**：服务端看不到 URL hash。所以「保护 `#/writer`」只能靠**前端 gate + 服务端 API 门**两件事一起做；不能靠给 `/writer` 加 page 路由或服务端重定向（那会违反 AGENTS.md 法则⑨）。

### 1.3 数据层

- 38 个 model：`User Novel Chapter ChapterVersion ChapterReview Character WorldEntry WorldGroup OutlineBeat Volume Storyline TimelineEntry CharacterArc NovelContract StoryPromise StoryClue ChapterPack ChapterDigest StoryFact CharacterState Foreshadow AgentRun AgentTask AgentEvent AgentMessage ContextSummary SkillInvocation AssetVersion UsageCall UsageProvenance UsageDaily UsageInvoice TeamAgent TeamConversation TeamMessage TeamTask TeamTaskLog TeamTurnLog`。
- `User` 表注释原文：*"Reserved for the future authentication system (NextAuth-ready). The current preview build uses a guest session and does not create users."* —— **空置，无任何关系字段，无 `userId`/租户字段**。
- 采用 `prisma db push`（增量），**不用 migrate**；`db:push:dev` 才带 `--accept-data-loss`（危险，生产禁用）。
- `src/` 全文**零 `$queryRaw` / `$executeRaw` / `PRAGMA` / SQLite 专有语法**；WAL 与 busy_timeout 由 `vm-deploy.sh` 用 `sqlite3` CLI 在库文件上设置。
- 备份格式：`GET /api/novels/[id]/export` 生成 `novara-novel-backup` v2 JSON（含记忆四表 + 稿 N），`POST /api/import` 带完整性对账。
- **写闸 / 定稿锁 / 版本快照 / 审读 / 沉淀**都在数据层，是产品本身，部署不能碰。

### 1.4 真正决定架构的 6 条运行时约束

| # | 约束                                                                                                                            | 证据                                            | 对部署的含义                                                                                                                 |
| - | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1 | **后台执行在响应返回之后**：`POST /api/agent/runs` 用 `after(async () => executeRun(...))`，`team/tasks`、`team/chat`、`resume` 同样用 `after()` | `src/app/api/agent/runs/route.ts:67` 等 5 处    | Cloud Run 默认 request-based billing「CPU 只在请求处理期间分配」，官方文档明确：响应后代码**不能保证继续跑**。要跑必须 instance-based billing + min-instances |
| 2 | **审批门最长等 30 分钟**（`qc.approvalWaitMs: 1800000`），stale run 15 分钟（`sse.staleRunMs: 900000`）                                      | `agent/config/budgets.yaml`                   | 进程必须常驻；serverless 冷启动/缩容会杀掉等待中的 run                                                                                    |
| 3 | **SSE 长连接**：`ReadableStream` + 两个 `setInterval`（快照 1.2s / 心跳 15s），客户端 `EventSource` 断线重连全量对账                                  | `src/app/api/agent/runs/[id]/events/route.ts` | 需要常驻进程；Cloud Run 请求超时默认 300s，需改到 3600s                                                                                 |
| 4 | **租约心跳**：`setInterval` 每 `LEASE_RENEW_MS` 写 DB，用 CAS + epoch fencing 防双写；崩溃后由 `healStaleRuns()` / `resume` 恢复                 | `src/lib/agent/runtime.ts:1250` 等             | 多实例并发会触发 fencing；当前设计围绕**单进程**优化，横向扩展不是免费午餐                                                                            |
| 5 | **SQLite 要真实 POSIX 文件系统 + 文件锁**                                                                                               | `prisma/schema.prisma`                        | Cloud Run 磁盘是临时的；gcsfuse 不提供 SQLite 需要的锁语义，有损坏库风险。v1 已核实并排除                                                            |
| 6 | **运行时读磁盘上的 `agent/` 内容层**：`AGENT_DIR = path.join(process.cwd(), "agent")`，`team.yaml`/`skills.yaml` fail-fast                 | `src/lib/novara/content.ts:22`                | 产物必须把 `agent/` 一起打包，且 `WorkingDirectory` 必须是产物根。`scripts/assemble-standalone.mjs` 已做并有验证门                              |

补充：`next.config.ts` 里 `typescript.ignoreBuildErrors: true` —— **`next build` 会吞掉类型错误**。CI 必须单独跑 `tsc --noEmit`，否则质量门是假的。

### 1.5 认证与存储现状

- `src/lib/novara/session.ts` 只写 `localStorage["novara.guestSession"] = { enteredAt }`，注释明确「不代表账号、订阅或任何权限状态」。
- 全项目零 `getServerSession` / `authOptions` / OAuth 代码。
- **无文件上传**：`src/` 里 `fs` 只用于读 `agent/` 资源与 `RELEASE.json`；导出是 `Response` 直接下载；`upload/` 只在 `.gitignore` 里出现。
- 因此 Cloud Storage 的真实需求只有两个：**CI 构建产物** 与 **数据库异地备份**。

### 1.6 仓库里已有的部署资产（未提交，`git status` 显示 `??`）

`cloudbuild.yaml` · `Dockerfile` · `.dockerignore` · `deploy/vm-setup.sh` · `deploy/vm-deploy.sh` · `deploy/Caddyfile.production` · `scripts/assemble-standalone.mjs` · `src/app/api/health/route.ts`。

- `vm-deploy.sh` 有 3 个硬保证：原子符号链接切换、数据目录在发布树之外（有守卫）、健康门禁（候选版 3100 端口 `/api/health` 200 才切换，失败自动回滚）。**保留，别重写。**
- `/api/health` 真查库，失败返回 503（诚实规则）。但**它公开返回 `database.novels` 数量** —— 加了登录之后这是轻微信息泄漏，第 4 步要改。
- `assemble-standalone.mjs` 第 8 步强制剥离被 `next build` 复制进 standalone 的 `.env*`。**别删。**

### 1.7 AGENTS.md 法则对部署的约束（不可破）

| 法则                           | 约束                                                                       |
| ---------------------------- | ------------------------------------------------------------------------ |
| ⑨ 唯一用户可见路由 `/`               | **不许加 `/login` 页面**。认证 UI 必须是 hash SPA 内的组件/弹窗；`/api/auth/*` 是 API 路由，允许 |
| ⑩ 全部走 API，不用 server action   | 认证回调、session、登出全部是 Route Handler                                         |
| ⑦ 禁 JSON 列、SQLite+Prisma 规范表 | 认证**不改 schema**（用签名 Cookie，不建 Session 表）                                 |
| ⑧ AI SDK 仅后端                 | 凭据、模型调用全在服务端；前端只拿 `/api/auth/config` 的公开 client ID                       |
| ⑤ 诚实规则                       | 健康检查、终报、用量账本不能因加认证而变成「自报即事实」                                             |

---

## 2. c署架构：先比较，再决定

### 2.1 四个候选（成本为 us-central1、单用户、2026-11-07 官方定价口径）

|                     | A. **e2-micro VM + SQLite**（推荐）                | B. Cloud Run（instance-based）+ Cloud SQL PG             | C. VM + Cloud SQL PG          | D. Cloud Run（request-based）+ Cloud Tasks 重写执行器 |
| ------------------- | ---------------------------------------------- | ------------------------------------------------------ | ----------------------------- | ---------------------------------------------- |
| 计算月费                | **$0**（always-free）                            | ≈ **$40–44**（1 vCPU 常驻，见 2.2）                          | $0                            | ≈ $0–5                                         |
| 数据库月费               | $0                                             | ≈ \*\*$10\*\*（db-f1-micro $7.67 + 10GB SSD $1.70 + 备份） | ≈ $10                         | ≈ $10                                          |
| 域名/HTTPS            | Caddy 免费                                       | LB 约 **$18+**（域名映射是 Preview）                           | Caddy 免费                      | LB 约 $18+                                      |
| **GCP 月费合计**        | **≈ $0–1**                                     | **≈ $72**                                              | **≈ $11**                     | **≈ $28–33 + 重写工时**                            |
| 代码改动                | 仅认证层                                           | 认证层 + Prisma provider 换血 + 38 模型迁移 + 数据搬迁              | 认证层 + DB 迁移                   | **重写 `runtime.ts` 执行器模型**（最大）                  |
| 数据丢失风险              | 低（持久盘 + GCS 备份）                                | 最低（托管备份/HA）                                            | 低                             | 最低                                             |
| 维护难度                | 中（要管 OS patch；vm-setup 已装 unattended-upgrades） | **低**                                                  | 中                             | 中高                                             |
| 扩展能力                | 弱（1GB 内存、单进程）                                  | 强                                                      | 中（DB 已外置，将来换 Cloud Run 只换计算层） | 强                                              |
| 能否满足 `after()` 后台执行 | ✅ 天然                                           | ✅ 但要花 $40–44 买常驻                                       | ✅                             | ✅（改成任务队列，见 §2.6 B）                              |

### 2.2 决定性证据（不是偏好，是核实过的硬约束）

1. **Cloud Run CPU 分配**（官方 `docs.cloud.google.com/run/docs/configuring/cpu-allocation`）：
   - *request-based billing*（默认）=「CPU is only allocated during request processing」；响应返回后的后台代码**无 CPU，不保证完成**。
   - *instance-based billing*（原「CPU always allocated」）才能让 `after()` 继续跑；官方还写明「An instance will never stay idle for more than 15 minutes after processing a request unless it is kept active using minimum instances」→ 必须 `min-instances=1`。
   - 官方建议的长任务路径是 **Cloud Tasks**（可重试，单次最长 30 分钟）—— 那就是方案 D，要改执行器。
2. **成本口径冲突（2026-11-07 复核后修正）**：官方两个页面给的免费额度数字不一致，别把任何一个当定值：
   - `cloud.google.com/free` 的 Cloud Run **request-based** 行：**180,000 vCPU-s + 360,000 GiB-s + 2M 请求/月**。
   - `cloud.google.com/run/pricing` 的 Free tier 行：**342,857 vCPU-s + 642,857 GiB-s**（另有 Worker pools 池 384,204 / 728,744）。两个池**不叠加、不滚存**。
   - 第三方引用 Cloud Billing Catalog 给的是 instance-based **240,000 / 450,000**（v1 文档用的是这组）。
   - **但任何口径下结论不变**：1 vCPU 常驻 30 天 = 2,592,000 vCPU-s，是 342,857 的 **7.6 倍**、180,000 的 **14.4 倍**。按 instance-based 单价 $0.000018/vCPU-s、$0.000002/GiB-s 估算，扣掉免费额度后约 **$40–44/月**（CPU ~$42 + 内存 ~$1.7）。这是估算，不是账单；以控制台为准。
3. **有个更便宜的 Cloud Run 配置，但功能不对（v1 漏了，这里补上）**：`request-based billing + min-instances=1` 的**空闲费率**只有 $0.0000025/vCPU-s（active 是 $0.000024，便宜 9.6 倍），1 vCPU 空闲一个月约 **$6.5 CPU + $3.2 内存 ≈ $10/月**。看着很划算，**但便宜不等于能用**：request-based 下 CPU 仍只在请求处理期间分配，min-instances 只保证进程不被回收、不保证后台代码有 CPU。官方 cpu-allocation 页明确要求后台任务用 instance-based billing。所以这 $10 买不到 `after()` 的可靠执行。
4. **Cloud SQL 无永久免费档**（官方 `cloud.google.com/sql/pricing` + `cloud.google.com/free`）：官方 Free Tier 表里**没有 Cloud SQL**，只有「30 天 Cloud SQL free trial 实例」；新客 $300/90 天抵扣金是**试用信用，不是 Free Tier**。`db-f1-micro` = **$0.0105/小时**（≈ $7.67/月，730h），SSD $0.000232877/GiB·小时（≈ $0.17/GiB·月），备份 $0.000109589/GiB·小时（≈ $0.08/GiB·月）；且**共享核机型不受 Cloud SQL SLA 覆盖**。
5. **Cloud Build 机型陷阱**（官方 `cloud.google.com/build/pricing`）：免费额度只覆盖默认池 `e2-standard-2`（`cloud.google.com/free` 写 2,500 build-minutes/月；pricing 页另有 120/天口径，**以控制台账单为准**）。`e2-highcpu-8` 明确标 `No`，**$0.0156/分钟**。现有 `cloudbuild.yaml` 的 `machineType: E2_HIGHCPU_8` 会持续计费 —— 必须删。
6. **Cloud Run 自定义域名**（官方 `cloud.google.com/run/docs/mapping-custom-domains`）：直接 domain mapping 是 **Limited availability / Preview**，文档原文「not recommended for production services」；生产推荐外部 Application Load Balancer（自带证书、可配 Cloud CDN / Armor），那是每月十几美元起。
7. **请求超时**（官方）：Cloud Run 默认 300s，最大 3600s；SSE 与 12 分钟任务需要显式改 `--timeout=3600`，且官方提示超过 15 分钟必须做幂等与重连。项目已有 SSE 重连对账，但 `after()` 后台部分仍不归请求超时管。

> **一句话回答「Cloud Run 不是免费的吗」**：Cloud Run 这个产品**确实在 Free Tier 内**，但免费额度是给「请求来了才醒、空闲缩到 0」的无状态工作负载设计的。要让它跑 Novara 的 `after()` 后台 Agent，必须把实例配成 24 小时常驻 + 常分配 CPU —— 那是**用超了额度**，不是产品在收费。同理，你的 RM1223 抵扣金是**限时信用**，不是「永久免费额度」。

### 2.3 最终选择：**方案 A**（e2-micro VM + SQLite + Google 托管周边服务）

```
GitHub push (main)
      │  Cloud Build GitHub App 触发
      ▼
Cloud Build（默认 e2-standard-2，免费额度内）
  install → db:generate → lint → tsc --noEmit → 11 套 harness（临时库）
      → next build → assemble-standalone（剥离 .env、验证 agent/ + Prisma 引擎）
      → tar → gs://novara-artifacts/{latest.tar.gz, releases/<sha>}
      → gcloud compute scp/ssh（OS Login，无 SSH 私钥）
      ▼
e2-micro VM（us-central1-a，30GB pd-standard，always-free）
  /etc/novara/novara.env ← Secret Manager（开机拉取，root:600）
  /etc/.z-ai-config      ← Secret Manager（root:novara:640）
  /var/lib/novara/custom.db  ← 持久盘，在发布树之外
  systemd novara.service（MemoryMax=768M）
  Caddy（自动 HTTPS）→ :443
      │  夜间 sqlite3 .backup → gs://novara-backups/
      ▼
用户浏览器 ── Google Sign In (GIS) ── /api/auth/google ── 签名 Cookie
              /api/* 由 proxy.ts 守门（health 与 auth 端点豁免）
```


**用到的 Google 官方服务**：Compute Engine、Cloud Storage、Cloud Build、Secret Manager、Cloud Logging / Monitoring、Cloud DNS（可选）、Google Identity Services / OAuth 2.0、IAM、Cloud Billing Budgets。

### 2.4 明确不用、以及为什么

| 服务                                     | 不用     | 原因                                                                                 |
| -------------------------------------- | ------ | ---------------------------------------------------------------------------------- |
| Cloud Run                              | 现在不用   | `after()` 后台执行 + 常驻要求 → 要么 $40–44/月 常驻，要么按 §2.6 B 改成任务驱动（计算可 $0，但 DB 仍要外置）            |
| Cloud SQL                              | 现在不用   | 无永久免费档；38 模型 + 真实小说数据迁移有风险；单用户规模零收益                                                |
| Firestore / BigQuery / Spanner         | 不用     | 关系是规范化的 38 张表，文档型/分析型都是错配                                                          |
| Firebase Auth                          | 备选，不首选 | 托管、免费到 50K MAU，但要接 Firebase 项目 + 客户端 SDK + Admin SDK；本项目只需「白名单 gate」，GIS + 服务端校验更轻 |
| Artifact Registry                      | 不用     | 产物是 tar 包走 Cloud Storage，不构建容器镜像（`Dockerfile` 保留给本地复现与未来迁移）                        |
| Cloud Load Balancer / Cloud Armor      | 现在不用   | 约 $18+/月；Caddy 免费 HTTPS + `rate_limit`（装插件后）够单用户                                   |
| GKE / Cloud Composer / Cloud Scheduler | 不用     | 严重过度设计                                                                             |

### 2.5 演进触发条件（现在不做，但门在哪）

| 触发条件             | 迁移动作                                                                                                                                 | 前置工作         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| 需要多实例 / 1GB 内存不够 | 先 **VM + Cloud SQL PG**（方案 C）：改 `datasource.provider = "postgresql"`、生成 migrate、用 `/api/export` + `/api/import` 或 `pgloader` 搬数据、连接池 | 数据迁移演练 + 备份  |
| 需要弹性扩缩 / 免运维     | 再上 Cloud Run（instance-based + min-instances=1）+ 外部 LB，`Dockerfile` 直接就是部署单元                                                          | DB 必须先外置     |
| 需要真正的多用户隔离       | **独立项目**：给 `Novel` 及所有级联表加 `ownerId`、备份 schema 加字段、全 API 加租户过滤、写闸/审读/账本同步                                                            | 不是部署任务，别塞进这次 |

### 2.6 「那 Cloud Run 到底什么情况下用、用来干什么？」

Cloud Run 适合的负载画像：**无状态、请求驱动、单次请求短（秒~几分钟）、可水平扩缩、DB 外置、没有进程内定时器/后台任务、能接受冷启动**。它的免费额度正是按这个画像定的。

套到 Novara，有三层答案，按「改动量」从低到高：

| 层 | 用法 | 能不能 $0 | 硬前置 / 代价 |
|---|---|---|---|
| **A. 拆无状态端点** | 把纯请求-响应的端点单独部署成 Cloud Run service：`/api/detect/*`（AI 检测）、`/api/usage/statement`（CSV）、`/api/novels/[id]/export/markdown`、health。它们 scale-to-zero、无后台定时器 | ✅ 在额度内 | **数据库必须先外置**：这些端点几乎都读写 `UsageCall` / `Novel`（`src/lib/db.ts` 在模块加载就建 PrismaClient）。SQLite 是文件数据库，不能跨网络给 Cloud Run 用。外置 = Cloud SQL ~$10/月，或换成别的网络 DB |
| **B. 把 Agent 执行器改成任务驱动**（真正的「for what」） | `POST /api/agent/runs` 只创建 `AgentRun` 行 → 投 **Cloud Tasks** → 唤起 **Cloud Run Jobs / worker service** 执行 → 跑完实例退出。主服务 scale-to-zero，只有真跑任务时才起实例 | ✅ **实例生命周期只覆盖任务时长**：12 分钟 × 每天 10 次 ≈ 7,200 vCPU-s/月，远在免费额度内 | 改 `runtime.ts`：把进程内 `setInterval` 租约心跳换成外部调度/DB 时间戳、内存态 checkpoint 全部持久化、SSE 改为纯轮询 DB（**现在 `events/route.ts` 已经是每 1.2s 查 DB**，这半步已做完）。代码其实已为此铺路：`claimLease` CAS、`leaseEpoch` fencing、`healStaleRuns()`、`resume` 路由的注释明确写了「no in-process executor」恢复路径。仍需 DB 外置（多 worker 共享状态） |
| **C. 整站搬上 Cloud Run 常驻** | 现有架构原样搬，配 instance-based + `min-instances=1` | ❌ ~$40–44/月（+ Cloud SQL ~$10 + LB ~$18） | 除了钱，还要去掉 SQLite 本地文件依赖。这是「花 VM 的钱买更少控制权」，只有真需要弹性扩容时才值 |

**触发条件（什么时候该从 VM 迁走）**：

- 用户数上来、1GB 内存 / 单进程不够 → 先做 **DB 外置**（方案 C），再谈 Cloud Run。
- 流量有明显波峰波谷、要自动扩缩 → Cloud Run 才发挥价值。
- 不想自己管 OS patch / systemd / Caddy → 托管收益开始超过成本。
- 需要 HA、多实例、跨区 → Cloud Run + Cloud SQL。
- **单用户 / 优先 $0 / 12 分钟常驻任务 / SQLite 本地库 → 继续 VM。** 这不是保守，是计费模型与执行模型对齐的结果。

> 注意：**A 和 B 都要求先外置数据库**，而官方 Free Tier 表里没有 Cloud SQL。所以「用 Cloud Run 且完全 $0」在这个项目里不是免费的 —— 免费的是计算，数据库那 ~$10/月跑不掉，除非换一个同样有免费档的网络数据库（那又是另一轮 schema/驱动验证）。

---

## 3. 执行顺序总览

> 严格按序。**带 [你] 的步骤必须你本人登录 Google / GitHub 账号操作**，我不碰你的账户；我只给命令、生成配置、检查你贴回来的输出。  
> 带 [我] 的是我可以在本机替你做好的文件。

| Step | 内容                                | 谁做        | 前置  | 产出                          | 新增月费                 |
| ---- | --------------------------------- | --------- | --- | --------------------------- | -------------------- |
| 0    | 五个决策 + 本机工具                       | 你 + 我     | —   | 项目 ID / 域名 / 白名单邮箱          | $0                   |
| 1    | GCP 项目、结算、API、IAM、SA              | [你]       | 0   | 可部署的项目                      | $0                   |
| 2    | OAuth 同意屏幕 + Web Client ID        | [你]       | 1   | `GOOGLE_CLIENT_ID`          | $0                   |
| 3    | Secret Manager 建 5 个 secret       | [你]       | 1   | 密钥资源                        | $0（≤6 版本）            |
| 4    | 应用侧认证改造（代码）                       | [我]       | 2、3 | 6 个新文件 + 3 处改动              | $0                   |
| 5    | 数据库：持久盘 + WAL + 备份 / Cloud SQL 备选 | [我]       | 1   | 脚本 + 步骤                     | $0（选 PG 则 ~$10）      |
| 6    | Cloud Storage 两个桶 + 生命周期          | [你]       | 1   | 桶                           | $0（<5GB）             |
| 7    | VM、Caddy、Cloud DNS、HTTPS          | [你] + [我] | 1、6 | 可访问的站点                      | $0（Cloud DNS ~$0.20） |
| 8    | GitHub → Cloud Build 连接           | [你]       | 1   | Trigger                     | $0                   |
| 9    | CI/CD 流水线 + 日志排查                  | [我]       | 8   | `deploy/cloudbuild.v2.yaml` | $0（必须删 E2_HIGHCPU_8） |
| 10   | 安全 / 配额 / 预算告警                    | [你]       | 1   | $1 预算告警                     | $0                   |
| 11   | 首次部署 + 端到端验证                      | 你 + 我     | 全部  | 上线                          | —                    |
| 12   | 日常运维 / 回滚 / 换 key                 | 文档        | 11  | runbook                     | —                    |

---

## STEP 0 · 前置决策与本机准备

**你要先定 5 件事**（不知道就留空，我按默认给命令，但第 4 项不能空）：

1. `PROJECT_ID` —— 建议 `novara-ai-<6位数字>`（全局唯一）。
2. `REGION / ZONE` —— 默认 `us-central1` / `us-central1-a`。**免费 e2-micro 只在美国部分区**，选错就开始计费。
3. `DOMAIN` —— 有就填；没有留空，先用 VM 外部 IP + `:80` 冒烟测试（**不要长期公网裸奔**）。
4. `ALLOWED_GOOGLE_EMAILS` —— **必填**，逗号分隔的 Gmail / Workspace 邮箱。没有它我不会开登录（等于把你的小说公开）。
5. 模型网关 key：z.ai / 智谱的 API key + **从哪个控制台拿的**（决定 baseUrl，见 `A:\Novara\.env` PART 2）。

本机需要：`gcloud` CLI、`git`、一个能收告警的邮箱。

```bash
gcloud auth login                      # [你] 用你自己的 Google 账号，不产生密钥文件
gcloud components update --quiet
```

> **不需要任何 Google API key**：VM 靠机器身份 + OS Login，Cloud Build 用自带 SA，GitHub 授权走浏览器 OAuth，TLS 由 Caddy 自动签发。别把服务账号 JSON 贴进聊天。

---

## STEP 1 · GCP 项目、结算、API、IAM

### 1.1 建项目并绑定结算

```bash
export PROJECT_ID="novara-ai-XXXXXX"       # 换成你的
export REGION="us-central1"
export ZONE="us-central1-a"

gcloud projects create "$PROJECT_ID" --name="Novara AI"
gcloud config set project "$PROJECT_ID"
# [你] Cloud Console → Billing → 绑定结算账号（免费额度 + 抵扣金在这里生效）
gcloud beta billing projects describe "$PROJECT_ID"   # 确认 billingEnabled: true
```

### 1.2 必须启用的 APIs（逐条给理由）

```bash
gcloud services enable \
  compute.googleapis.com \
  cloudbuild.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  cloudresourcemanager.googleapis.com \
  iamcredentials.googleapis.com \
  oslogin.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com \
  billingbudgets.googleapis.com \
  dns.googleapis.com \
  --project="$PROJECT_ID"
```

| API                                                          | 为什么必须                             |
| ------------------------------------------------------------ | --------------------------------- |
| `compute.googleapis.com`                                     | VM、防火墙、OS Login 元数据               |
| `cloudbuild.googleapis.com`                                  | CI/CD 触发与构建                       |
| `storage.googleapis.com`                                     | 产物桶、备份桶                           |
| `secretmanager.googleapis.com`                               | 5 个密钥集中托管                         |
| `iam.googleapis.com` / `cloudresourcemanager.googleapis.com` | 服务账号与项目级 IAM 绑定                   |
| `iamcredentials.googleapis.com`                              | SA 身份签发 / OS Login 链路             |
| `oslogin.googleapis.com`                                     | Cloud Build 免 SSH 私钥连 VM          |
| `logging.googleapis.com` / `monitoring.googleapis.com`       | 构建日志、VM 日志、预算告警                   |
| `billingbudgets.googleapis.com`                              | Step 10 用命令行建预算                   |
| `dns.googleapis.com`                                         | 仅当你用 Cloud DNS 托管域名；用注册商 DNS 可不启用 |

**不需要启用的**：GIS「Sign in with Google」的 ID Token 流程**不需要项目侧 API**（`google-auth-library` 直接取 Google 公开 JWKS 校签），只要 OAuth 同意屏幕 + Web Client ID。要读 Google 通讯录/更多 profile 才需要 People API —— 本项目不需要。

### 1.3 服务账号与最小权限（v1 的 IAM 清单不完整，这里补齐）

```bash
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
CB_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
VM_SA="novara-runtime@${PROJECT_ID}.iam.gserviceaccount.com"

# 给 VM 建专用 SA，不用默认 Compute SA
gcloud iam service-accounts create novara-runtime \
  --display-name="Novara VM runtime" --project="$PROJECT_ID"

# Cloud Build SA：上传产物 + SSH 部署
for ROLE in \
  roles/storage.objectAdmin \
  roles/compute.instanceAdmin.v1 \
  roles/iam.serviceAccountUser \
  roles/compute.osAdminLogin; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${CB_SA}" --role="$ROLE" --quiet
done

# VM SA：读密钥 + 拉产物
for ROLE in \
  roles/secretmanager.secretAccessor \
  roles/storage.objectViewer \
  roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${VM_SA}" --role="$ROLE" --quiet
done

# 开 OS Login（Cloud Build 用 SA 身份 ssh，无需私钥）
gcloud compute project-info add-metadata --metadata enable-oslogin=TRUE
```

> ⚠️ **v1 漏了三项**：`roles/compute.osAdminLogin`（`vm-deploy.sh` 里用 `sudo`，没有它 SSH 进去后提权失败）、VM SA 的 `roles/storage.objectViewer`（VM 上 `gcloud storage cp` 拉产物要 IAM，光有 `--scopes=cloud-platform` 不够）、以及 `iamcredentials`。这三项是首次部署最可能卡住的地方，Step 11 会实测。

---

## STEP 2 · Google OAuth 2.0 / Google Sign-In

### 2.1 操作路径（[你]，Console）

1. **APIs & Services → OAuth consent screen**（新版叫 **Google Auth Platform → Branding**）
   - User Type：**External**
   - App name：`Novara AI`；User support email / Developer contact：你的邮箱
   - Scopes：**只勾 `openid`、`email`、`profile`**（非敏感，免验证）
   - **Publishing status：保持 `Testing`**，在 **Test users** 里把 `ALLOWED_GOOGLE_EMAILS` 的每个邮箱都加进去。
   - 为什么：我们是白名单制，本就不让公众登录。Testing 模式不需要 Google 审核、不需要域名验证、不花钱。要对外开放才需要提交验证（可能要收费/几周审核）。
2. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type：**Web application**
   - **Authorized JavaScript origins**：`https://<你的域名>`；本地开发加 `http://localhost:3000`
   - **Authorized redirect URIs**：GIS 按钮的 ID Token 流程**不需要**（不走 auth code 交换，因此也**不需要 client secret**）
   - 复制 **Client ID**（形如 `xxxx.apps.googleusercontent.com`）。这是公开值，不是密钥。
3. 记下 `GOOGLE_CLIENT_ID`。

> 为什么不选 `next-auth` v4：它虽已安装，但 Next 16 把 `cookies()`/`headers()` 改成异步 API、`middleware.ts` 更名为 `proxy.ts`，v4 与 Next 16 的兼容性未在本项目验证过；而且 v4 的 Google Provider 走 auth code 流程会多一个 client secret 要管。**GIS ID Token + `google-auth-library` 官方校验 + 签名 Cookie** 依赖更少、路径更短、全部是 Route Handler，且完全符合法则⑨⑩。

### 2.2 需要给应用的两个值

- `GOOGLE_CLIENT_ID`（公开，写入 Secret Manager 便于统一管理）
- `AUTH_SECRET`（随机 32+ 字节，签 Cookie 用）

---

## STEP 3 · Secret Manager

### 3.1 创建 5 个 secret（[你]执行，值不要贴聊天）

```bash
# 随机签名密钥
openssl rand -base64 48 | gcloud secrets create novara-auth-secret \
  --data-file=- --replication-policy=automatic --project="$PROJECT_ID"

printf '%s' 'xxxx.apps.googleusercontent.com' | gcloud secrets create novara-google-client-id \
  --data-file=- --replication-policy=automatic --project="$PROJECT_ID"

printf '%s' 'you@gmail.com,second@gmail.com' | gcloud secrets create novara-allowed-emails \
  --data-file=- --replication-policy=automatic --project="$PROJECT_ID"

# z.ai 网关配置整体存一个 JSON。baseUrl 按 key 来源选，填错就是 401：
#   标准  https://api.z.ai/api/paas/v4
#   Coding Plan  https://api.z.ai/api/coding/paas/v4
#   智谱国内  https://open.bigmodel.cn/api/paas/v4
printf '%s' '{"baseUrl":"https://api.z.ai/api/paas/v4","apiKey":"<你的key>"}' \
  | gcloud secrets create novara-zai-config --data-file=- \
      --replication-policy=automatic --project="$PROJECT_ID"

# 预留：将来 provider 适配层的额外凭据（当前留占位，别编造假值）
printf '%s' '{}' | gcloud secrets create novara-provider-extras --data-file=- \
  --replication-policy=automatic --project="$PROJECT_ID"
```

### 3.2 免费额度边界

官方口径：**6 个活跃 secret 版本免费**，之后 $0.06/版本/月；\*\*10,000 次读取免费\*\*，之后 $0.03/万次。上面正好 5 个 secret × 1 版本，在免费档内。**轮换 key 时记得销毁旧版本**，否则版本数超 6 开始计费。VM 只在开机拉一次（不是每请求），读取量可忽略。

### 3.3 安全纪律

- 密钥**只在服务端内存/受保护文件里**，不进客户端、不进日志、不进 API 响应。
- 不建服务账号 JSON key；用**机器身份**（VM 附加 SA）+ OS Login。
- `.env` / `.z-ai-config` / `*.db` 已在 `.gitignore` 与 `.dockerignore`；`assemble-standalone.mjs` 第 8 步会剥离打进产物的 `.env*`。**别删这段。**

---

## STEP 4 · 应用侧认证改造（代码，[我]可在确认后落地）

> 这一步改代码，会**暂时让本地 `bun run dev` 无法进入 Writer**（没有 secret）。所以我先把完整方案放这里，**等你确认架构再落地**，避免把你现在能用的环境弄坏。

### 4.1 依赖

```bash
bun add google-auth-library jose     # jose 显式声明（原本只是传递依赖）
```

### 4.2 新增文件 1：`src/lib/auth/session.ts`

```ts
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "novara_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 天

export type SessionPayload = {
  sub: string;              // Google sub（稳定唯一 ID）
  email: string;
  name?: string;
  picture?: string;
};

function key(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET missing or too short");
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(p: SessionPayload): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    email: p.email,
    name: p.name ?? null,
    picture: p.picture ?? null,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(p.sub)
    .setIssuer("novara")
    .setAudience("novara-app")
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_MAX_AGE)
    .sign(key());
}

export async function verifySession(token: string | null | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), {
      issuer: "novara",
      audience: "novara-app",
    });
    if (typeof payload.sub !== "string" || typeof payload.email !== "string") return null;
    return {
      sub: payload.sub,
      email: payload.email,
      name: typeof payload.name === "string" ? payload.name : undefined,
      picture: typeof payload.picture === "string" ? payload.picture : undefined,
    };
  } catch {
    return null; // 过期/篡改/算法不对，一律视为未登录
  }
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}`;
}

export const clearSessionCookie = `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
```


### 4.3 新增文件 2：`src/proxy.ts`（Next 16 的 `middleware.ts` 已更名）

```ts
// Next.js 16: middleware.ts → proxy.ts（官方已确认 deprecated/renamed）。
// 放在 src/ 下与 app/ 同级；Node.js runtime 是默认值，jose 可直接用。
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

// 必须公开：健康检查（外部探活 / 部署门禁）、认证自身。
const PUBLIC_API = [
  "/api/health",
  "/api/auth/config",
  "/api/auth/google",
  "/api/auth/session",
];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_API.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 纵深防御：即使 Cookie 是旧白名单签发的，也在边缘重查一次。
  const allow = (process.env.ALLOWED_GOOGLE_EMAILS ?? "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allow.length > 0 && !allow.includes(session.email.toLowerCase())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.next();
}

// 只守 API。官网 "/" 保持公开；#/writer 是 hash，服务端看不见，由前端 gate 负责。
export const config = { matcher: ["/api/:path*"] };
```

### 4.4 新增文件 3：`src/app/api/auth/config/route.ts`

```ts
export const dynamic = "force-dynamic";

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? null;
  // Client ID 是公开值；AUTH_SECRET 永不出现在这里。
  return Response.json(
    { clientId, enabled: Boolean(clientId) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
```

### 4.5 新增文件 4：`src/app/api/auth/google/route.ts`

```ts
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { parseBody } from "@/lib/novara/api-helpers";
import { signSession, sessionCookie } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ credential: z.string().min(20) });

export async function POST(req: Request) {
  // CSRF：只接受同源 POST（Caddy 传 X-Forwarded-Host）。
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin && host && new URL(origin).host !== host) {
    return Response.json({ error: "Origin mismatch" }, { status: 403 });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const allow = (process.env.ALLOWED_GOOGLE_EMAILS ?? "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  // 没有白名单就拒绝登录 —— 绝不开放注册，否则所有小说对全网可见。
  if (!clientId || allow.length === 0) {
    return Response.json({ error: "Authentication is not configured" }, { status: 503 });
  }

  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;
  const input = bodySchema.safeParse(parsed.data);
  if (!input.success) return Response.json({ error: "Invalid credential" }, { status: 400 });

  let payload;
  try {
    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({
      idToken: input.data.credential,
      audience: clientId,          // 校 aud，防止别的应用签发的 token
    });
    payload = ticket.getPayload();
  } catch {
    return Response.json({ error: "Invalid Google ID token" }, { status: 401 });
  }

  if (!payload?.email || !payload.sub || payload.email_verified !== true) {
    return Response.json({ error: "Unverified Google account" }, { status: 401 });
  }
  if (!allow.includes(payload.email.toLowerCase())) {
    return Response.json({ error: "Account is not allowed" }, { status: 403 });
  }

  const token = await signSession({
    sub: payload.sub,
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
  });

  const user = { email: payload.email, name: payload.name ?? null, picture: payload.picture ?? null };
  return new Response(JSON.stringify({ user }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Set-Cookie": sessionCookie(token),
    },
  });
}
```

### 4.6 新增文件 5：`src/app/api/auth/session/route.ts`

```ts
import { SESSION_COOKIE, verifySession, clearSessionCookie } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const raw = req.headers.get("cookie") ?? "";
  const token = raw.split(";").map((s) => s.trim())
    .find((s) => s.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  const session = await verifySession(token);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(
    { user: { email: session.email, name: session.name ?? null, picture: session.picture ?? null } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE() {
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": clearSessionCookie, "Cache-Control": "no-store" },
  });
}
```

### 4.7 新增文件 6：前端 GIS 按钮 + 类型声明

`src/types/google-gis.d.ts`：

```ts
interface IdConfiguration {
  client_id: string;
  callback: (response: { credential: string }) => void;
  use_fedcm_for_button?: boolean;   // 官方要求新应用开启 FedCM
  auto_select?: boolean;
}
interface GsiButtonOptions { theme?: "outline" | "filled_blue" | "filled_black"; size?: "large" | "medium" | "small"; }
declare namespace google.accounts.id {
  function initialize(config: IdConfiguration): void;
  function renderButton(parent: HTMLElement, options: GsiButtonOptions): void;
  function prompt(): void;
  function disableAutoSelect(): void;
}
```

`src/components/novara/google-sign-in.tsx`（要点，非完整 UI）：

```tsx
"use client";
import { useEffect, useRef } from "react";

export function GoogleSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cfg = await fetch("/api/auth/config").then((r) => r.json());
      if (cancelled || !cfg.clientId) return;
      // 加载官方 GIS 脚本（唯一允许的第三方前端脚本）
      if (!document.getElementById("gsi-client")) {
        const s = document.createElement("script");
        s.id = "gsi-client";
        s.src = "https://accounts.google.com/gsi/client";
        s.async = true;
        document.head.appendChild(s);
        await new Promise<void>((resolve) => { s.onload = () => resolve(); });
      }
      google.accounts.id.initialize({
        client_id: cfg.clientId,
        use_fedcm_for_button: true,
        callback: async ({ credential }) => {
          const res = await fetch("/api/auth/google", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ credential }),
          });
          if (res.ok) onSignedIn();
          else alert(`登录失败：${(await res.json()).error ?? res.status}`);
        },
      });
      if (ref.current) google.accounts.id.renderButton(ref.current, { theme: "outline", size: "large" });
    })();
    return () => { cancelled = true; };
  }, [onSignedIn]);

  return <div ref={ref} />;
}
```

### 4.8 三处必须同步改动

1. **`src/components/novara/novara-app.tsx`**：`enterWriter` 先查 `/api/auth/session`；未登录显示 `<GoogleSignIn />`，登录后 `navigate("writer")`。保留官网 7 个视图公开。
2. **`src/lib/novara/api.ts` 的 `request()`**：`res.status === 401` 时抛带 `status: 401` 的错误并触发全局「重新登录」事件。这是 57 个 API 的唯一客户端出口，改一处全覆盖。
3. **`src/app/api/health/route.ts`**：公开响应**去掉 `database.novels` 计数**（加登录后再对外暴露小说数量是无意义的信息泄漏）；保留 `database.ok: true` 与 503 语义，诚实规则不变。

### 4.9 本地验证（不接 GCP 也能先跑）

```bash
# 本机 .env 追加（.env 已 gitignore）
AUTH_SECRET=<openssl rand -base64 48 的结果>
GOOGLE_CLIENT_ID=<Step 2 的 Client ID>
ALLOWED_GOOGLE_EMAILS=<你的邮箱>
bun run lint && bunx tsc --noEmit
bun run dev
# 预期：未登录 GET /api/novels → 401；GET /api/health → 200；
#      白名单 Google 账号点按钮 → 200，随后 /api/novels → 200；
#      非白名单账号 → 403。
```

---

## STEP 5 · Database

### 5.1 选择：SQLite + 持久盘（推荐）

理由已在 §2.1–2.2。创建/配置/连接由现有脚本完成，**你不需要手工建库**：

```bash
# vm-setup.sh 已做：/var/lib/novara 在发布树之外、novara.service 的 EnvironmentFile
# /etc/novara/novara.env 里写绝对 URL：
DATABASE_URL=file:/var/lib/novara/custom.db

# vm-deploy.sh 首次部署时做：prisma db push（不带 --accept-data-loss）
# 然后：sqlite3 "$DB" "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=15000;"
```

**为什么绝对路径是必须的**：Prisma 把相对 sqlite URL 解析到 `prisma/` 目录（本机才变成 `prisma/db/custom.db`）；在发布树里那样会把库放进「下次部署会删掉的目录」。

**异地备份**（新增，[我]已生成 `deploy/db-backup.sh`）：

```bash
# VM 上每日 03:17 由 systemd timer 调 deploy/db-backup.sh：
#   sqlite3 .backup（安全拷贝活库，避免 torn state）
#   → gcloud storage cp gs://novara-backups/sqlite/<UTC>.db
```

恢复演练（**上线前必做一次**）：

```bash
gcloud storage cp gs://novara-backups/sqlite/<时间戳>.db /tmp/restore.db
sudo systemctl stop novara
sudo cp /tmp/restore.db /var/lib/novara/custom.db
sudo chown novara:novara /var/lib/novara/custom.db
sudo sqlite3 /var/lib/novara/custom.db "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=15000;"
sudo systemctl start novara
curl -s localhost:3000/api/health | jq
```

### 5.2 备选：Cloud SQL for PostgreSQL（[你]要托管备份/HA 时走这条）

**代价明确**：无永久免费档，db-f1-micro ≈ $7.67/月 + 10GB SSD ≈ $1.70/月 + 备份 ≈ $0.80/月 ≈ **$10/月**，且共享核不受 SLA 覆盖。

```bash
gcloud sql instances create novara-pg \
  --database-version=POSTGRES_16 --tier=db-f1-micro \
  --region=us-central1 --storage-size=10GB --storage-type=SSD \
  --no-assign-ip \
  --network=default --availability-type=ZONAL \
  --backup-start-time=03:00 --project="$PROJECT_ID"

gcloud sql databases create novara --instance=novara-pg
gcloud sql users create novara_app --instance=novara-pg --password=<强密码>
```

代码侧：

```prisma
datasource db {
  provider = "postgresql"                 // 原来是 "sqlite"
  url      = env("DATABASE_URL")
}
generator client {
  provider = "prisma-client-js"
  binaryTargets = ["native", "debian-openssl-3.0.x"]   // Cloud Build 是 Linux，本机是 Windows
}
```

```bash
bun run db:generate
DATABASE_URL="postgresql://novara_app:<pw>@<private-ip>:5432/novara?schema=public&connection_limit=5" \
  bunx prisma db push
```

数据搬迁用**应用自己的备份格式**最安全：逐本 `GET /api/novels/[id]/export` 存 JSON → 新库 `POST /api/import`（带完整性对账），比 `pgloader` 更贴合这个项目的语义。搬完核对 `integrityOk`、`chapterCount`、`totalWords` 三项再切流量。

> ⚠️ 换成 Postgres 之后 `vm-deploy.sh` 里的 `sqlite3 .backup` / WAL 步骤必须删掉，改跑 `prisma db push`；`deploy/db-backup.sh` 换成 Cloud SQL 自动备份。别两套并存。



---

## STEP 6 · Cloud Storage

```bash
# 构建产物桶
gcloud storage buckets create "gs://novara-artifacts" \
  --location=us-central1 --uniform-bucket-level-access --project="$PROJECT_ID"

# 数据库备份桶
gcloud storage buckets create "gs://novara-backups" \
  --location=us-central1 --uniform-bucket-level-access --project="$PROJECT_ID"

# 备份桶 30 天自动清理（免费 5GB 内）
cat > /tmp/lifecycle.json <<'JSON'
{"lifecycle":{"rule":[{"action":{"type":"Delete"},"condition":{"age":30}}]}}
JSON
gcloud storage buckets update gs://novara-backups --lifecycle-file=/tmp/lifecycle.json
```

- 产物桶由 `cloudbuild.yaml` 保留最近 `_KEEP_RELEASES=5` 份（约 124MB × 5 ≈ 620MB，在 5GB 免费档内）。
- **不要给桶开 public access**。VM SA 有 `storage.objectViewer`，Cloud Build SA 有 `storage.objectAdmin`，够用。
- 代码里没有用户文件上传，所以**没有签名 URL / 上传 API 这一步**。别造。

---

## STEP 7 · VM、Caddy、域名与 HTTPS

### 7.1 建 VM（[你]；三个红线一个都不能错）

```bash
gcloud compute instances create novara-vm \
  --zone=us-central1-a \
  --machine-type=e2-micro \
  --boot-disk-size=30GB \
  --boot-disk-type=pd-standard \
  --image-family=debian-12 --image-project=debian-cloud \
  --service-account="$VM_SA" \
  --scopes=cloud-platform \
  --metadata enable-oslogin=TRUE \
  --metadata-from-file=startup-script=deploy/vm-setup.sh \
  --project="$PROJECT_ID"
```

> **免费额度红线**：`e2-micro` + `us-central1-a`（或 us-west1/us-east1）+ `pd-standard` + **不超过 30GB**。任何一项选错就开始计费。创建时**取消勾选** Ops Agent / 自动快照 / 备份；**不要预留静态 IP**（预留但未挂载会计费）。

防火墙：

```bash
gcloud compute firewall-rules create allow-novara-http \
  --allow=tcp:80,tcp:443 --source-ranges=0.0.0.0/0 \
  --target-tags=http-server --project="$PROJECT_ID"
gcloud compute instances add-tags novara-vm --tags=http-server --zone=us-central1-a
```

### 7.2 密钥落地（[我]已生成 `deploy/fetch-secrets.sh`）

systemd `ExecStartPre` 调它，用 VM 附加 SA 从 Secret Manager 拉 5 个 secret，写：

| 文件 | 权限 | 内容 |
|---|---|---|
| `/etc/novara/novara.env` | `root:root 600` | `NODE_ENV` `PORT` `HOSTNAME` `DATABASE_URL`（非机密）+ `AUTH_SECRET` `GOOGLE_CLIENT_ID` `ALLOWED_GOOGLE_EMAILS` |
| `/etc/.z-ai-config` | `root:novara 640` | `novara-zai-config` 的 JSON 原文（SDK 只认这个文件，不读 env） |

```ini
# /etc/systemd/system/novara.service 追加
ExecStartPre=/usr/local/bin/novara-fetch-secrets.sh
```
```ini
# /etc/systemd/system/novara-db-backup.timer
[Timer]
OnCalendar=*-*-* 03:17:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
```

### 7.3 域名 / DNS / HTTPS

**方案 7A（推荐，免费）**：Cloud DNS 托管区 + Caddy 自动证书

```bash
gcloud dns managed-zones create novara-zone --dns-name="<你的域名>." \
  --description="Novara AI" --project="$PROJECT_ID"
gcloud dns record-sets transaction start --zone=novara-zone
gcloud dns record-sets transaction add "<VM外部IP>" \
  --name="<你的域名>." --ttl=300 --type=A --zone=novara-zone
gcloud dns record-sets transaction execute --zone=novara-zone
# 到注册商把 NS 改成 Cloud DNS 给的 4 个 nameserver
```

```bash
sudo cp deploy/Caddyfile.production /etc/caddy/Caddyfile
sudo sed -i 's/novara.example.com/<你的域名>/g' /etc/caddy/Caddyfile
# 首次先注释掉 rate_limit 整块：该指令需要 caddy-ratelimit 插件，v1 未核实语法
#   sudo caddy add-package github.com/mholt/caddy-ratelimit
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Cloud DNS 约 **$0.20/托管区/月 + 查询费**（首个 25 个区 $0.20/月，查询按百万次计，单用户可忽略）。用注册商自带 DNS 则 $0。

**方案 7B（Google 原生但付费）**：外部 Application Load Balancer + Google 托管证书 + 可选 Cloud Armor / CDN。需要实例组、后端服务、健康检查、URL map、转发规则；约 **$18+/月** 的转发规则基础费。好处：可强制 TLS 1.2、可上 WAF、可多服务路由。**单用户没必要，别选。**

> Caddy 自动签发 Let's Encrypt 证书，免费且自动续期。`deploy/Caddyfile.production` 已经带安全头、`flush_interval -1`（SSE 不缓冲）、3600s 读写超时（覆盖 12 分钟 Agent run）。

---

## STEP 8 · GitHub → Google Cloud 集成

仓库实测：`origin = https://github.com/malcolmkhong/novara.git`，分支 `main`。

**Console 路径（[你]，必须本人授权）**：

1. Cloud Console → **Cloud Build → Triggers → Connect repository**（或 *Repositories*，2nd gen）
2. 选 **GitHub** → 首次会装 **Google Cloud Build GitHub App**，在 GitHub 授权 `malcolmkhong/novara`
3. Event：**Push to a branch**；Branch：`^main$`
4. Configuration：**Cloud Build configuration file (yaml)** → `/cloudbuild.yaml`
5. 保存，记下 Trigger ID

> 1st-gen 触发器（GitHub App 直连）用 `gcloud builds triggers create github`；2nd-gen 走 **Developer Connect**（`developerconnect.googleapis.com`，需建 Connection + Repository）。**本文按 1st-gen + 现成 `cloudbuild.yaml` 走**，步骤最少。若 Console 强推 2nd gen，把 `developerconnect.googleapis.com` 加进 Step 1.2 的 API 列表，并按向导建连接，其余不变。

**等价命令行（1st gen，连接已授权后）**：

```bash
gcloud builds triggers create github \
  --name="novara-main" \
  --repo-owner="malcolmkhong" --repo-name="novara" \
  --branch-pattern="^main$" \
  --build-config="cloudbuild.yaml" \
  --project="$PROJECT_ID"
```

**别用 PAT**：GitHub App 授权走 OAuth，不需要也不应该把 Personal Access Token 存到 GCP。

---

## STEP 9 · CI/CD 自动化

### 9.1 [我] 已生成 `deploy/cloudbuild.v2.yaml`

关键改动（相对现有 `cloudbuild.yaml`）：

| 改动 | 原因 |
|---|---|
| **删除 `options.machineType: E2_HIGHCPU_8`** | 官方定价 `$0.0156/分钟`、不享免费额度。默认 `e2-standard-2`（8GB RAM）足够跑 Next 16 build |
| 新增 `typecheck` 步骤 `bunx tsc --noEmit` | `next.config.ts` 的 `ignoreBuildErrors: true` 会吞掉类型错误 |
| 新增 `harness` 步骤：临时 SQLite 库跑 11 套 `scripts/verify-*.ts` | 这些脚本用 `new PrismaClient()` 且会 `deleteMany`，**绝不能指到 dev 库**；v1 有 3 套因本地库污染失败 |
| `build` 步骤注入临时 `DATABASE_URL` | `src/lib/db.ts` 在模块加载时构造 PrismaClient，`next build` 期间可能被求值 |
| `logging: CLOUD_LOGGING_ONLY` 保留、每步有 `id` | 失败时能定位到具体步骤 |
| `deploy` 步骤保留 `scp` + `ssh` + `vm-deploy.sh` | 健康门禁 / 原子切换 / 自动回滚不能丢 |

启用：把 `deploy/cloudbuild.v2.yaml` 复制成仓库根的 `cloudbuild.yaml`（或把 Trigger 的配置路径指到它）。

```bash
cp deploy/cloudbuild.v2.yaml cloudbuild.yaml
git add cloudbuild.yaml && git commit -m "ci: free-tier build machine, typecheck + harness gates" && git push origin main
```

### 9.2 流水线各阶段

```
install (bun install --frozen-lockfile)
  → prisma-generate (bun run db:generate)
  → lint (bun run lint)
  → typecheck (bunx tsc --noEmit)              ← 真实 TS 门
  → harness (临时库 prisma db push + 11 套 verify-*.ts，零 GLM 调用)
  → build (bun run build → postbuild 组装 + 剥离 .env)
  → package (tar .next/standalone)
  → upload (gs://novara-artifacts/latest.tar.gz + releases/<sha>)
  → deploy (gcloud compute scp/ssh → vm-deploy.sh <bucket>)
```

`vm-deploy.sh` 在切换前：备份现库 → `prisma db push`（**无** `--accept-data-loss`）→ 3100 端口起候选版 → `curl /api/health` 200 才切 → 切完再验 3000 端口，失败自动 `--rollback`。

### 9.3 失败时看日志（你要求的可排查）

```bash
# 最近 5 次构建
gcloud builds list --limit=5 --project="$PROJECT_ID" \
  --format='table(id,status,createTime,duration)'

BUILD_ID=$(gcloud builds list --limit=1 --format='value(id)' --project="$PROJECT_ID")
gcloud builds log "$BUILD_ID" --project="$PROJECT_ID"          # 全量日志
```

- Console：**Cloud Build → History → 点构建 → 展开失败的 step**；每步都有 `id:`。
- VM 侧：`journalctl -u novara -n 200 --no-pager`、`journalctl -u caddy -n 100`、`/tmp/novara-stage-*.log`（候选版日志）、`/tmp/novara-dbpush.log`。
- Cloud Logging：`gcloud logging read 'resource.type="cloud_build" OR resource.type="gce_instance"' --limit=50 --project="$PROJECT_ID"`（首 50 GiB/月免费）。
- **常见失败对照**：`harness` 失败 → 看是不是临时库路径；`build` OOM → 默认 8GB 不够才考虑付费机型；`deploy` 权限错 → 回头查 Step 1.3 那三个补齐的 role；`health gate failed` → 看 `/tmp/novara-stage-*.log`，多半是 `agent/` 没打包或 Prisma 引擎平台不对（脚本已显式拦截 Windows 引擎）。

### 9.4 CI 诚实边界

- 11 套 harness 是**零 GLM 的集成探针**，不是单元测试；它们会写库、会 `deleteMany`。首次 CI 运行前我没在干净 Linux 环境实测过全部 11 套，Step 11 要跑一遍并记录结果。
- CI **不跑真实模型调用**（会花钱）。模型链路的验证放在 Step 11 的人工冒烟测试里。

---

## STEP 10 · 安全、资源限制、成本与预算告警

### 10.1 安全清单

- **无 SA JSON key**：VM 用附加 SA，Cloud Build 用自带 SA + OS Login。
- **最小权限**：Step 1.3 的角色表；别给 `roles/editor` / `roles/owner`。
- **白名单登录**：`ALLOWED_GOOGLE_EMAILS` 为空 → `/api/auth/google` 直接 503，绝不开放注册。
- **Cookie**：`HttpOnly` `Secure` `SameSite=Lax`、HS256 签名、7 天过期、服务端校验 `iss`/`aud`/`exp`/`email_verified`。
- **CSRF**：`/api/auth/google` 校 `Origin` 与 `X-Forwarded-Host` 一致。
- **会话不落库**：不改 schema，符合法则⑦。
- **`/api/health` 必须保持公开且不含小说数量**（Step 4.8 第 3 点）——否则外部监控被 401 挡住、或泄漏信息。
- **Caddy**：安全头、`rate_limit`（装插件后）、SSE 不缓冲、3600s 超时。
- **systemd**：`User=novara`、`ProtectSystem=full`、`ReadOnlyPaths=/opt/novara`、`MemoryMax=768M`、`TasksMax=256`。
- **仓库**：`.gitignore` 已修 `prisma/db/`（公开仓库，原规则匹配不到真实库）；`.dockerignore` 排除 `.env` / `.z-ai-config` / `*.db`。提交前 `git status --short` 确认没有密钥或库文件。

### 10.2 资源 / 配额限制

| 项 | 值 | 位置 |
|---|---|---|
| 应用内存上限 | 768M（1GB 机器留 OS） | `vm-setup.sh` systemd |
| Cloud Build 超时 | 1200s | `cloudbuild.yaml` |
| Cloud Build 产物保留 | 5 份 | `_KEEP_RELEASES` |
| 备份保留 | 30 天 | 桶 lifecycle |
| GLM 并发 | 2（全局信号量） | `budgets.yaml` |
| 单次 GLM 超时 | 60s + 2 次重试 | `budgets.yaml` |
| Caddy 模型接口限流 | 10 req/min/IP | `Caddyfile.production`（需插件） |

### 10.3 预算告警（[你]，唯一能发现「免费额度配错了」的机制）

```bash
BILLING_ACCOUNT=$(gcloud beta billing accounts list --format='value(name)' | head -n1)

gcloud billing budgets create \
  --billing-account="$BILLING_ACCOUNT" \
  --display-name="Novara $1 guard" \
  --budget-amount=1USD \
  --threshold-rule=percent=50 \
  --threshold-rule=percent=90 \
  --threshold-rule=percent=100 \
  --project="$PROJECT_ID"
```

Console 路径：**Billing → Budgets & alerts → Create budget**，金额 `$1`，阈值 50/90/100%，勾邮件通知。

> 预算告警**只通知、不硬停**。不要用「超预算自动关闭结算」的 Pub/Sub 自动化 —— 那会把 VM 一起关掉，等于用几毛钱的风险换整站宕机。

**免费额度红线复核清单**（建完 VM 立刻核一遍）：
- [ ] `e2-micro` / `us-central1-a` / `pd-standard` / 30GB
- [ ] 未开 Ops Agent、未开自动快照、未预留闲置静态 IP
- [ ] Cloud Build 未指定 `E2_HIGHCPU_8`
- [ ] Secret Manager ≤ 6 个活跃版本
- [ ] 两个桶合计 < 5GB
- [ ] 出站流量 1GB/月（北美出发，不含中国/澳洲）；SSE 长连接会吃流量

---

## STEP 11 · 首次部署与最终验证

### 11.1 首次手动部署（证明链路，再交给 CI）

```bash
gcloud compute ssh novara-vm --zone=us-central1-a --project="$PROJECT_ID" \
  --command='sudo /opt/novara/vm-deploy.sh novara-artifacts && curl -s localhost:3000/api/health | jq'
```
期望：`{"status":"ok","database":{"ok":true},"release":{"commit":...},...}` 且 **200**。

### 11.2 逐项验收（你要求的 4 件事，逐条给命令）

**① 部署成功**
```bash
curl -sS https://<域名>/api/health | jq '{status,database,runtime,release}'
curl -sSI https://<域名>/ | head -n 5        # 200 + 安全头；证书由 Caddy 自动签发
gcloud compute ssh novara-vm --zone=us-central1-a \
  --command='systemctl is-active novara && systemctl is-active caddy'
```

**② Google Authentication 正常**
```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://<域名>/api/novels          # 401（未登录）
curl -sS https://<域名>/api/auth/config | jq                                 # {clientId: "...", enabled: true}
# 浏览器：打开站 → 点 Sign in with Google → 白名单账号 → 进 #/writer
#   非白名单账号应 403；退出登录后 /api/novels 应回到 401
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE https://<域名>/api/auth/session   # 204
```


**③ Database 连接正常**
```bash
curl -sS https://<域名>/api/health | jq '.database'      # {ok:true}，且不含 novels 计数
# 浏览器：新建一本小说 → 刷新 → 仍在；导出备份 → 导入 → integrityOk: true
gcloud compute ssh novara-vm --zone=us-central1-a \
  --command='sudo sqlite3 /var/lib/novara/custom.db "PRAGMA journal_mode; PRAGMA busy_timeout; SELECT count(*) FROM Novel;"'
sudo /usr/local/bin/novara-db-backup.sh && gcloud storage ls gs://novara-backups/sqlite/ | tail -n 3
```

**④ GitHub 更新自动触发重新部署**
```bash
# 记下当前 release commit
curl -sS https://<域名>/api/health | jq -r '.release.commit'
# 推一个无害改动
printf '\n' >> agent/config/budgets.yaml   # 或改一个注释
git add -A && git commit -m "ci: verify auto deploy" && git push origin main
# 盯构建
gcloud builds list --limit=1 --project="$PROJECT_ID"
# 构建成功后，release.commit 应变成新 SHA，且 uptimeSeconds 变小（服务重启过）
curl -sS https://<域名>/api/health | jq '{commit:.release.commit,uptime:.uptimeSeconds,db:.database.ok}'
```

**⑤ 失败可排查**：故意在 `main` 推一个 lint 错误，确认构建在 `lint` 步失败、**线上版本不受影响**（`release.commit` 不变）；随后 revert。这一步验证的是「失败不污染生产」，比只看成功更重要。

**⑥ 模型链路冒烟**（会花少量 token）：在 #/writer 用 AI 向导或行内续写发一次请求，确认 `UsageCall` 有真实 usage 行、`/api/usage/ledger` 能看到。这一步同时验证 `/etc/.z-ai-config` 生效。

### 11.3 验收记录要求（诚实规则）

把上面每条的**实际输出**贴回来，我逐条对照。不要只说「成功了」。特别是：11 套 harness 在干净 Linux 环境的结果、Cloud Build SA 的 OS Login 是否真能 `sudo`、Caddy `rate_limit` 插件是否装上、`/api/health` 的 `release.commit` 前后是否变化。

---

## STEP 12 · 日常运维 / 回滚 / 换 key

| 场景 | 操作 |
|---|---|
| 回滚到上一版 | `sudo /opt/novara/vm-deploy.sh --rollback` |
| 轮换 z.ai key | `printf '<新JSON>' \| gcloud secrets versions add novara-zai-config --data-file=-` → 销毁旧版本 → VM 上 `sudo /usr/local/bin/novara-fetch-secrets.sh && sudo systemctl restart novara` |
| 加/减白名单邮箱 | 更新 `novara-allowed-emails` + **OAuth Test users 同步** → 重启服务 |
| 看日志 | `journalctl -u novara -n 200 --no-pager` / `gcloud builds log <ID>` / Cloud Logging |
| 手动备份 | `sudo /usr/local/bin/novara-db-backup.sh` |
| 恢复数据 | §5.1 恢复演练 |
| 停机不产生费用 | 别停 VM（e2-micro 常开才免费）；停机期间静态 IP 闲置会计费 |

---

## 附录 A · 费用明细（us-central1，2026-11-07 核实）

| 服务 | 用量 | 免费额度 | 月费 |
|---|---|---|---|
| Compute Engine e2-micro + 30GB pd-standard | 1 台常开 | always-free（限美国指定区） | **$0** |
| Cloud Storage | 产物 ~620MB + 备份 <5GB | 5GB | **$0** |
| Cloud Build | 每次 ~5 min，默认 e2-standard-2 | 默认池免费额度（官方 120 min/天；另有 2,500 min/月口径，以账单为准） | **$0** |
| Cloud Build（若保留 `E2_HIGHCPU_8`） | 每次 ~5 min | **无** | **$0.078/次**（$0.0156/min） |
| Secret Manager | 5 个 secret × 1 版本、开机读一次 | 6 版本 / 10,000 次读 | **$0** |
| Cloud Logging | < 50 GiB/月 | 50 GiB | **$0** |
| Google Sign-In / OAuth | 白名单少量登录 | 无使用费 | **$0** |
| Cloud DNS（可选） | 1 托管区 | 无 | **~$0.20 + 查询费** |
| 外部 HTTPS 负载均衡（不选） | 1 转发规则 | 无 | **~$18+** |
| Cloud SQL PG（不选） | db-f1-micro + 10GB | **无永久免费** | **~$10** |
| Cloud Run request-based + min-instances=1（**不选**，便宜但跑不了 `after()`） | 1 vCPU 512MiB 保活 | 空闲费率 $0.0000025/vCPU-s | **~$10**，但 CPU 仍只在请求期间分配 |
| Cloud Run instance-based（不选） | 1 vCPU 512MiB 常驻 | 官方口径冲突：180k / 240k / 342,857 vCPU-s，见 §2.2 | **~$40–44**（估算） |
| 出站流量 | 文本应用 + SSE | 1GB/月（北美，不含中/澳） | 超出约 **$0.12/GiB** |
| 域名 | 1 个 | 无 | **~$10–15/年** |
| **模型 token（z.ai / 未来 4 家）** | 按写作量 | 无 | **最大可变成本，与 GCP 分开计** |

**推荐方案 GCP 侧合计：≈ $0–1/月**（域名与模型 token 另计）。你有 3 个月抵扣金作兜底，正常一分用不到。

---

## 附录 B · 环境变量与密钥总表

| 名称 | 来源 | 存放位置（VM） | 客户端可见 | 说明 |
|---|---|---|---|---|
| `DATABASE_URL` | `vm-setup.sh` 生成 | `/etc/novara/novara.env` | 否 | `file:/var/lib/novara/custom.db`，绝对路径 |
| `AUTH_SECRET` | Secret Manager `novara-auth-secret` | 同上 | **否** | ≥32 字节，签 Cookie |
| `GOOGLE_CLIENT_ID` | Secret Manager `novara-google-client-id` | 同上 | **是**（经 `/api/auth/config`） | Client ID 是公开值 |
| `ALLOWED_GOOGLE_EMAILS` | Secret Manager `novara-allowed-emails` | 同上 | 否 | 逗号分隔，为空拒登 |
| `novara-zai-config` | Secret Manager | `/etc/.z-ai-config` | 否 | SDK 只认文件，不读 env；`root:novara 640` |
| `NODE_ENV` `PORT` `HOSTNAME` `NEXT_TELEMETRY_DISABLED` | `vm-setup.sh` | 同上 | 否 | 非机密 |
| `COMMIT_SHA` `BRANCH_NAME` `BUILD_ID` | Cloud Build 自动注入 | `RELEASE.json`（产物） | 是（health） | 构建元数据 |
| `DEEPSEEK_API_KEY` 等 5 个 | 未来 provider | 待定 | 否 | **当前无代码读取**，见 `A:\Novara\.env` PART 4 |

> `.env` 是本机交接板（gitignored）；`.env.example` 只放键名。生产**不依赖 `.env`**，`assemble-standalone.mjs` 会剥离它。

---

## 附录 C · APIs 与 IAM 速查

**必须启用**：compute、cloudbuild、storage、secretmanager、iam、cloudresourcemanager、iamcredentials、oslogin、logging、monitoring、billingbudgets。可选：dns（用 Cloud DNS 时）、developerconnect（2nd-gen GitHub 连接时）。

| 主体 | 角色 |
|---|---|
| Cloud Build SA `<NUM>@cloudbuild.gserviceaccount.com` | `storage.objectAdmin`、`compute.instanceAdmin.v1`、`iam.serviceAccountUser`、`compute.osAdminLogin` |
| VM SA `novara-runtime@…` | `secretmanager.secretAccessor`、`storage.objectViewer`、`logging.logWriter` |
| 你（操作者） | Owner / 或 compute.admin + cloudbuild.builds.editor + secretmanager.admin + dns.admin + billing.budgets.create |

**不创建任何服务账号 JSON 密钥。**

---

## 附录 D · 风险与未核实项（不编造）

| # | 风险 | 状态 | 应对 |
|---|---|---|---|
| 1 | 1GB 内存跑 Next 16 + Prisma + 认证 | **未实测** | `MemoryMax=768M`；OOM 则升 e2-small（脱离免费额度，用抵扣金） |
| 2 | 出站 1GB/月对 SSE 是否够 | **未实测** | 盯账单；可在前面挂 Cloudflare 免费 CDN 缓存静态资源 |
| 3 | Caddy `rate_limit` 指令语法 | **未核实** | 首次部署先注释掉，`caddy add-package github.com/mholt/caddy-ratelimit` 后再开 |
| 4 | Cloud Build SA 经 OS Login 执行 `sudo` | **未实测** | Step 1.3 已补 `compute.osAdminLogin`；Step 11 实测 |
| 5 | 11 套 harness 在干净 Linux 环境全绿 | **未实测** | v1 有 3 套因 dev 库污染失败；CI 用临时库，首次运行记录结果 |
| 6 | `next-auth` v4 与 Next 16 兼容性 | **已规避** | 不用 next-auth，改 GIS + 官方校验 + 签名 Cookie |
| 7 | `next/font/google` 构建期需公网 | 已确认 | Cloud Build 有公网；VM 运行时不需要 |
| 8 | Cloud Build 免费额度口径（120/天 vs 2500/月） | 两种口径 | 以控制台账单为准；关键是**别用 E2_HIGHCPU_8** |
| 9 | OAuth Testing 模式测试用户上限 / 7 天 | 已知限制 | 白名单邮箱都加进 Test users；个人长期用足够，要公众开放再提交验证 |
| 10 | 多用户数据隔离 | **本方案不做** | 38 张表无 `userId`；加登录 ≠ 多租户。要做是独立项目（§2.5） |
| 11 | 模型供应商费用 | 不可预估 | 与 GCP 账单分离，`budgets.yaml` 已有并发/重试帽 |
| 12 | Cloud Run 免费额度官方口径不一致 | **已核实存在冲突** | `cloud.google.com/free` 给 180,000 vCPU-s；`run/pricing` 给 342,857；第三方 Billing Catalog 给 240,000。$40–44 是估算，以控制台账单为准。任何口径下常驻都超额 |
| 13 | Free Tier vs 抵扣金混淆 | 已澄清 | Free Tier = 按月额度、无到期日、超额即计费、不滚存；$300/90天（你的 RM1223/3个月）= **限时试用信用**，不是永久免费。官方 Free Tier 表里**没有 Cloud SQL** |

---

## 附录 E · 上线前勾选清单

- [ ] Step 0 五项决策已定，尤其 `ALLOWED_GOOGLE_EMAILS`
- [ ] `$1` 预算告警已建（Step 10.3）
- [ ] VM 三红线复核（e2-micro / us-central1-a / pd-standard 30GB）
- [ ] 未开 Ops Agent、未开快照、未预留闲置静态 IP
- [ ] `cloudbuild.yaml` 已换成 v2（无 `E2_HIGHCPU_8`）
- [ ] `bun run lint` + `bunx tsc --noEmit` 本地全绿
- [ ] Step 4 认证代码已落地并本地验过 401/403/200
- [ ] `/api/health` 已去掉公开的小说计数
- [ ] 5 个 secret 建成，旧版本已销毁
- [ ] `/etc/.z-ai-config` 权限 `root:novara 640`，实测一次真实模型调用成功
- [ ] Caddy `caddy validate` 通过，HTTPS 证书已签发
- [ ] 备份 timer 跑过一次，GCS 里能看到 `.db`
- [ ] 恢复演练做过一次
- [ ] 首次手动 `vm-deploy.sh` + `/api/health` 200
- [ ] GitHub push 触发构建，`release.commit` 变化
- [ ] 故意制造一次失败构建，确认线上未受影响
- [ ] `git status --short` 无密钥 / 无 `*.db` 被提交
