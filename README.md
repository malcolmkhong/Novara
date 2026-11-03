# Novara AI — Your AI Novel Writing Team

AI 驱动的长篇小说创作系统：**用户提出创作意图，AI Agent 团队负责理解、分析、规划、写作、维护和验证整个小说系统。**

- 官网 + 写作工作台单页应用（Next.js 16 App Router，hash 路由 `#/writer`）
- 五角色 Agent 团队（Atlas / Sage / Prism / Nova / Forge）在审批制或全权限模式下协同产稿
- 结构化数据库为唯一真源（Prisma + SQLite），支持版本快照、定稿锁、一致性体检与备份导入导出

---

## 功能总览

### 🤖 Agent 创作闭环

| 能力 | 说明 |
|---|---|
| **New with AI team 向导** | 四步创建：Logline → Premise → 人物 + 世界书 → 大纲，全部 GLM 真实生成、可编辑，Create 时把人物/世界书（自动归入"世界规则"分组）/大纲/构想快照原子落库 |
| **对话第一界面** | 在对话框描述目标（支持 **Pin-to-Chat** 钉住任意资产作上下文），团队自动拆解执行；章节被钉住时先跑**只读影响评估**再动手 |
| **五角色团队** | Atlas 策划派单 · Sage 执笔 · Prism 审读 · Nova 查询研究 · Forge 库卫生/导出；角色卡与技能即提示词文件（`agent/` 目录） |
| **双执行模式** | `Approval`（写操作暂停等作者批准，批准由代码提交）与 `Full Access`（连续执行，仍受写闸与核验约束） |
| **诚实核验** | 任务完成状态只在验证写库后翻转；终报强制 claimed vs verified 数字对照，虚报标红；GLM 429/5xx 指数退避 + 全局并发限流 |

### 📚 七区信息架构（仓库视图）

左树与 Memory 面板共用同一套分区，对应目标目录结构：

1. **世界书 World Bible** — 二级分组（如 世界规则 / 人物档案），未分组条目恒显示
2. **作品契约 Story Contract** — 类型承诺/读者/文风/禁忌，注入每一次 AI 写作上下文；支持 AI 起草
3. **大纲 Outline** — 故事骨架（节拍）+ 卷规划（Volume 1~N）
4. **账本 Story Ledger** — 五本账：故事线 · 时间线 · 人物弧线 · 承诺 · 线索
5. **本书记忆 Novel Memory** — 9 类沉淀事实（world_rule / character_state / relationship / story_fact / open_loop / decision / style / dialogue / inspiration）+ 打分检索
6. **定稿 Canon** — 已定稿章独立分区
7. **草稿区 Draft Workspace** — 草稿章（可展开稿1~稿N 版本行）+ 材料包 + 定稿准备包 + 审核

### 🔒 定稿 = Immutable Canon（代码强制）

- 定稿章 PATCH 直接 409；修订必须显式 reopen（原版自动归档、状态降级，绝不借道重定稿）
- 非正文资产（人物/世界条目/节拍/卷/账本/契约）同一部法律：reopen 走 `AssetVersion` 不可变历史层
- 定稿闸：最新审读 0 blocking 才允许 settle；每次提交正文自动留 `ChapterVersion` 快照（稿N）
- 人机共享同一写闸（write-gate），Agent 没有旁路

### 🧰 其他

- 章节审读管线（作者 Review 标签与 Prism 共用）、一致性体检（doctor）、QC 行为探针 24 项（`/api/agent/qc/evals` + QC 标签）
- 记忆沉淀管线：审读 0 blocking 后一键沉淀 digests / facts / states / foreshadows
- 备份导入导出 v2（integrity 计数校验）+ Markdown 导出（Obsidian 兼容形态）
- 官网五页（Home / Product / Plans / About / Writer）+ 法务页，移动端响应式

---

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Next.js 16 (App Router) · TypeScript 5 strict |
| UI | Tailwind CSS 4 · shadcn/ui (New York) · Lucide icons · next-themes |
| 数据 | Prisma ORM + SQLite（26 models，无 JSON 列，全部规范表） |
| AI | z-ai-web-dev-sdk（GLM，仅后端；`src/lib/novara/glm.ts` 唯一直连点） |
| 运行时 | Bun（dev 端口固定 3000） |

## 快速开始

```bash
# 1. 安装依赖
bun install

# 2. 配置环境变量
cp .env.example .env        # 默认 DATABASE_URL=file:./db/custom.db 即可用

# 3. 初始化数据库（生成 Prisma Client + 建表）
bun run db:generate
bun run db:push

# 4. 启动开发服务器
bun run dev                 # http://localhost:3000
```

打开首页后点击 **Start Creating / Login** 进入 `#/writer` 书库，用 **New with AI team** 体验从一句话到完整故事基础的创建流程。

## 常用脚本

| 命令 | 作用 |
|---|---|
| `bun run dev` | 开发服务器（3000 端口，日志 tee 到 `dev.log`） |
| `bun run lint` | ESLint 检查 |
| `bun run db:push` | Prisma schema 增量推送到 SQLite |
| `bun run db:generate` | 生成 Prisma Client |
| `bun run db:migrate` / `db:reset` | Prisma migrate（可选） |

## 架构速览

```
src/
  app/page.tsx                  # 唯一路由：官网 + #/writer（hash 路由）
  app/api/                      # novels / chapters / agent/runs / ai / import …
  lib/agent/runtime.ts          # Agent 编排核心（规划→派单→写入门→审批→核验→终报）
  lib/novara/                   # 写闸 · asset-gate · 审读 · 沉淀 · 记忆 · QC · 导出
  components/novara/writer/     # 左树仓库视图 / 十标签工件区 / 对话与任务板
agent/                          # Agent 内容层：system/*.md 角色卡 + skills + config
prisma/schema.prisma            # 26 models
db/custom.db                    # SQLite 数据文件
```

**一次 Agent 运行的生命周期**：
作者下目标（可钉上下文）→ 章节任务自动先跑影响评估 → Atlas 拆解派单（Sage/Prism/Nova/Forge 认领）→ 成员在受限工具循环中读写 → 写入暂停待批准（approval 模式）→ 批准后代码提交 + 定稿锁复检 → 写后核验（修复轮 ≤2）→ 终报数字审计。

## 文档

- `NOVARA_AI_DEVELOPMENT_PLAN.md` — 完整开发计划与各 Phase 实测记录
- `AGENTS.md` — 给 AI 编码代理的工作守则（不可协商法则 + 架构地图 + 任务配方）
- `.env.example` — 环境变量样例
