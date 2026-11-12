# AGENTS.md — AI Agent 工作指南

> 本文件是给在本仓库工作的 AI 编码代理（以及新加入的人类开发者）的速查守则。
> 项目背景与完整演进史见 `NOVARA_AI_DEVELOPMENT_PLAN.md`；本文只讲"必须遵守的法则 + 上手地图"。

## 1. 这是什么项目

**Novara AI** — AI 小说创作系统。核心哲学：

- **结构化数据库是真源**（Prisma/SQLite），磁盘 `.md` 只是可选导出形态
- **用户负责提出创作意图，AI Agent 团队负责理解、分析、规划、修改、维护和验证整个小说系统**
- **已定稿 = Immutable Canon**（代码强制锁），未定稿 = 可编辑工作区
- 人机共享同一套写闸（write-gate），没有旁路

## 2. 不可协商的法则（改代码前先读这段）

1. **定稿锁是代码强制，不是 UI 提示**
   - `Chapter.status === 'final'` 时，PATCH 返回 409，除非显式 `reopen: true`（reopen 强制降级为 `revised`，绝不借道重定稿）
   - Agent runtime 在审批通过后的 commit 时刻**再查一次 final**（防审批窗口期被定稿）— `src/lib/agent/runtime.ts`
   - 替换非空正文必须显式 `overwrite: true`（防误覆盖）
2. **非正文资产同法**：Character / WorldEntry / OutlineBeat / Volume / 账本五表 / 契约都有 `status: draft|final` + `finalizedAt`；final 的修订走 reopen，原版先归档进 **AssetVersion**（`src/lib/novara/asset-gate.ts`）
3. **每次提交正文都留版本**：`ChapterVersion`（稿1~稿N，`createdBy: author|agent`）在作者保存、Agent 写入、审批提交、导入时都会快照 — 保留不重写
4. **E2 定稿闸**：定稿前要求最新持久化审读 0 blocking（`ChapterReview` 由 `src/lib/novara/review.ts` 独家写入，UI 与 Agent 共用同一条管线）
5. **诚实规则**：task `done` 只在验证写入数据库后翻转；`finalReport` 强制 claimed vs verified 对照，虚报会被数字审计标红。不要引入任何"模型自报即事实"的路径
6. **wordCount 服务端重算**，永不信任客户端传值
7. **SQLite + Prisma：禁止 JSON 列**，一切关系建规范表；schema 原始类型不能是 list
8. **z-ai-web-dev-sdk 只能在后端用**（`src/lib/novara/glm.ts` 是唯一直连点：全局并发信号量 maxConcurrent=2 + 429/5xx 指数退避）。客户端一律走自家 `/api/*`
9. **只有 `/` 一个用户可见路由**（hash 路由切官网/Writer），不要新增 page 路由
10. **全部走 API，不用 server action**；API 写法参考 `src/app/api/` 现有模式（`parseBody` + zod schema + `jsonError`）

## 3. 架构地图

```
src/
  app/
    page.tsx                    # 唯一路由：官网 + #/writer 工作台（hash 路由）
    api/
      novels/[id]/...           # 小说 CRUD + characters/world-entries/world-groups/
                                # volumes/outline-beats/ledger/packs/memory/export
      chapters/[id]/...         # CRUD + versions + review + sediment
      agent/runs/...            # 运行生命周期（create/detail/approve/cancel/mode + SSE events）
      ai/wizard, ai/draft       # GLM 薄封装（向导 6 个 section / 行内续写）
      import/                   # 备份导入（integrity 校验）
  lib/
    agent/runtime.ts            # Agent 编排核心（Atlas 主控循环、门、审批、核验）
    agent/tool-protocol.ts      # 工具行协议（novel-tool / novel-write / team-delegate 等）
    agent/snapshot.ts           # loadStorySnapshot：前情摘要+记忆层+账本+契约 注入写作上下文
    novara/
      write-gate.ts             # 正文写闸（人机共享，保留不重写）
      asset-gate.ts             # 非正文资产 canon 状态机（reopen 归档 AssetVersion）
      review.ts                 # 审读核心（唯一可写 ChapterReview）
      sediment.ts               # 沉淀管线（审读 0 blocking 后写入记忆四表）
      memory.ts / summary.ts    # 记忆检索（打分召回）与前情摘要
      qc.ts / qc-evals.ts       # QC 纯函数门族 + 24 行为探针
      versions.ts / export.ts / backup-schema.ts
      wizard-parse.ts           # 向导文本解析（cast/world/beats，容错式）
  components/novara/
    writer/asset-tree.tsx       # 左树外壳（身份块 + Write|Book 切换 + 搜索行 + 运行列表）
    writer/doc-tree-panel.tsx   # 左树主体 = 文档树渲染器（文件夹/文档两种行）
    writer/doc-pane.tsx         # 右侧文档区（打开的文档标签 + 只读投影 + Document/Markdown）
    writer/conversation-pane.tsx# 对话第一界面 + Pin-to-Chat + 运行历史
agent/                          # Agent 内容层（提示词即代码）
  system/{atlas,sage,prism,nova,forge}.md
  skills/**                     # 角色技能卡（team.yaml 白名单注入）
  config/{team.yaml,skills.yaml,budgets.yaml}   # 角色注册/技能/魔法数收编
prisma/schema.prisma            # 26 models（SQLite）
db/custom.db                    # 数据库文件
```

## 4. 数据模型速记（26 models）

| 分区 | 模型 |
|---|---|
| 正文 | `Novel` · `Chapter`（含 brief 章细纲）· `ChapterVersion`（稿N 快照）· `ChapterReview` |
| 世界书 | `WorldGroup`（二级分组）· `WorldEntry` |
| 人物 | `Character`（含 aliases）· `CharacterState`（沉淀）· `CharacterArc`（账本） |
| 大纲 | `Volume`（卷规划）· `OutlineBeat`（故事骨架） |
| 契约/构想 | `NovelContract` · `Novel.conceptSnapshot`（创建时由向导写入） |
| 账本（5 本） | `Storyline` · `TimelineEntry` · `CharacterArc` · `StoryPromise`（承诺）· `StoryClue`（线索） |
| 记忆沉淀 | `ChapterDigest` · `StoryFact`（9 类 category）· `CharacterState` · `Foreshadow` |
| 草稿区 | `ChapterPack`（kind: material 材料包 / prep 定稿准备，按 chapterIndex 键控） |
| Agent | `AgentRun` · `AgentTask` · `AgentEvent` · `SkillInvocation` |
| 不可变层 | `AssetVersion`（非正文资产 reopen/finalize/manual 快照） |

 canon 状态约定：正文用 `draft|revised|final`；非正文资产用 `draft|final`（账本两表叫 `lock`，避免与线程生命周期 `status` 混淆）。

## 5. Agent 运行时速记

- **五角色**：Atlas（leader/策划）· Sage（执笔）· Prism（审读）· Nova（查询/研究）· Forge（库卫生/导出）；注册表 `agent/config/team.yaml`，工具面白名单在 runtime 的 `MEMBER_TOOLS`
- **流程**：作者在对话框下 goal（可 Pin 上下文）→ 章节被 Pin 时自动先跑 **Task 0 影响评估**（只读）→ Atlas 拆解派单（CODE 派单，verified 结果回灌）→ 成员执行（bounded 工具循环）→ 写入门 → 审批门（approval 模式暂停，批准由**代码**提交）→ 写后核验（修复轮 ≤2）→ 终报核验
- **双模式**：`approval`（默认，写操作等作者批准）/ `full_access`（连续执行，仍受写闸与核验约束）
- **流式**：`GET /api/agent/runs/[id]/events`（SSE），前端 `use-agent-run.ts`
- 改 runtime 提示词行为时，**先改 `agent/` 内容层，不要硬编码进 runtime**；魔法数进 `budgets.yaml`

## 6. 常见任务配方

**加一个 schema 字段**：改 `prisma/schema.prisma` → `bun run db:push`（全增量，别删列）→ 同步 `src/lib/novara/types.ts` + `schemas.ts`（zod）→ 需要进备份的话补 `backup-schema.ts`。

**加一个 API**：参考 `src/app/api/packs/[id]/route.ts` 的形态——`parseBody` + zod + canon 检查（若该资产有 status 字段，final 时 409/reopen 语义必须对齐 asset-gate）。

**加一个左树分区/行**：左树只有两种行——文件夹（展开）与文档（打开）。新行先加进 `lib/novara/doc-tree.ts` 的 `buildDocTree`（文件夹 id 固定 `f:<name>`，文档 id 固定 `<DocKind>:<ref>`），再在 `lib/novara/doc-markdown.ts` 注册同名渲染器（`DOC_RENDERERS`），最后跑 `bun scripts/check-doc-tree.ts`（校验 id 唯一、每个文档都有渲染器、空文件夹必须带 badge）。渲染与搜索过滤在 `components/novara/writer/doc-tree-panel.tsx`。

**加一个向导 section**：`/api/ai/wizard` 的 zod enum + switch 加分支 → `api.ts` 的 `WizardSection` → 向导 UI 加 textarea + GenerateButton → 需要结构化落库则加 `wizard-parse.ts` 解析器（容错式：解析不出的行不能静默丢弃）。

**动写闸/审读/QC 之前**：先读对应文件头注释里的设计契约；这三块是全系统的诚信底座，改动必须跑 `bun run lint` + 浏览器 E2E（走一遍 审批→写入→审读→定稿）。

## 7. 命令与红线

```bash
bun run dev        # 开发服务器（固定 3000 端口，日志 tee 到 dev.log）
bun run lint       # ESLint，提交前必须全绿
bun run db:push    # schema 增量推送（本项目用 push，不用 migrate dev）
bun run db:generate
```

红线：不要 `next build`（本环境只跑 dev）；不要把 AI SDK 用进客户端；不要新增 page 路由；不要绕过写闸新开写入口；不要让树/Memory 面板出现"数据存在但看不见"的分区（宁显未分组，不藏数据）。
