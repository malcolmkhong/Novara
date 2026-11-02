# NOVARA AI — Development Plan (AI Novel Writer)

> Status: PLAN v1.0（待确认后实施） · Date: 本轮调查基于磁盘实测与真实仓库检查
> 核心原则: 先简化架构，再逐步扩展 · MVP 优先 · 每个技术选择附理由

---

## 0. Verified Facts / Recommendations / To-Confirm

### ✅ Verified Facts（磁盘/仓库实测）
- 项目根 `/home/z/my-project`：Next.js 16 App Router + TS + Tailwind 4 + shadcn/ui + Prisma/SQLite + bun，dev server 健康（port 3000）
- 源码处于**回滚后残缺状态**：`src/lib/novel/` 仅剩 glm/prompts/server/types；`pipeline.ts`、`events.ts`、SSE 路由、前端同步桥、多项审计防线**已丢失**
- 幸存可回收件：ai-team 脚手架（prompts/novel-tools/工具循环/委派/收尾自愈/写入核验 v1）、novel lib 四件（loadNovelDetail、sediment/review 提示词构建器、glmJson）、schema 12 models（含 review/revision 列）、novel+ai-team UI 组件壳、检测器面板
- DB 数据完好：3 本小说（含 12 章 final）、团队会话/任务/遥测
- Prisma 残留脚手架：`User`/`Post` models（未使用 → 清理）
- 平台自带 `/skills/` 目录（18 个 SKILL.md）= Z.ai 资产，**不计入本项目、不依赖、不修改**
- 开源仓库 `lingfengQAQ/webnovel-writer` 已实际克隆检查（v6，Claude Code 插件，GPL-3.0）：8 skills + 4 agents + Python 记忆引擎 + 只读 dashboard，详见 §9

### 📌 Recommendations（技术建议，附理由见正文）
- 结构化检索优先，向量库缓行（FTS5 + 启发式排序足够覆盖单书语料）
- 采用 webnovel-writer 的"审查 issue 清单 + blocking 门"替代单一总分
- 文件化 System Instructions/Skills（`agent/` 目录）+ YAML 注册表 + 代码强制层

### ❓ To-Confirm（待确认事项）
- z-ai-web-dev-sdk 是否提供 embedding 接口（影响 Phase 4 路线；未确认前不做向量）
- SQLite FTS5 在本机 Prisma/SQLite 的可用性（需 raw migration 验证）
- 多用户/登录是否进入 MVP（建议：否，单用户先行）
- 是否需要 git 版本化正文导出（建议：Phase 2 仅 markdown 导出，git 化缓行）

---

## 1. Project Overview

- **定位**: Novara AI = 网页版长篇小说创作工作台 + 多智能体写作团队
- **一句话**: 让 AI 写到几百章，仍记得设定、接得住伏笔、守得住大纲 —— 一致性系统，非一次性生成器
- **形态**: Next.js 全栈单仓（本沙箱），SQLite 单文件存储，GLM 单一 LLM 供应商
- **设计底线**: 模型只能"建议"，代码负责"强制"；完成断言一律 DB 实测；写评分离

## 2. Core Functions（10 类拆解）

图例: 优先级 P0>MVP必需 / P1 / P2 / P3 · 依赖写在其后

### 2.1 Core Functions
- 会话管理（聊天/任务双形态）— P0 — 依赖: DB(TeamConversation/Message)
- Agent 对话与工具循环（bounded loop）— P0 — 依赖: GLM, 工具协议
- 任务队列与后台执行 — P0 — 依赖: TeamTask, TaskLog
- 写入核验与反虚报审计 — P0 — 依赖: DB 直查
- 进度实时推送（SSE）— P1 — 依赖: EventBus
- 遥测（turn log / tool receipts）— P0 — 依赖: TeamTurnLog

### 2.2 Novel Creation & Management
- 书籍 CRUD + 书架 — P0
- 创建向导（题材/一句话/金手指 → bible）— P0 — 依赖: GLM
- 书籍设置（目标章数/平台/调性）— P0
- 版本快照与 markdown 导出 — P2 — 依赖: 章节定稿

### 2.3 Story Planning & Worldbuilding
- 世界观/力量体系/主题 bible 编辑 — P0
- 卷纲规划（卷边界/核心冲突/高潮/钩子）— P0 — 依赖: bible
- 章纲生成（goal/mustCover/endHook/timeAnchor）— P0 — 依赖: 卷纲
- 承诺台账（伏笔 ledger: plant/advance/pay）— P0 — 依赖: 章纲
- 时间线 append-only 表 — P1 — 依赖: 章纲 timeAnchor

### 2.4 Character Management
- 角色卡（名字/欲望/缺陷/弧光）— P0
- 章节级角色状态沉淀 charStates — P0 — 依赖: 沉淀管线
- 名册（正名/别名/首现章，防指代漂移）— P1
- 角色关系图 — P3

### 2.5 Chapter Writing & Editing
- 章节编辑器（手写/改写）— P0
- AI 起草（写作任务书 → 起草 → 落库）— P0 — 依赖: 上下文组装器
- 一章一任务约束（1000-2500 字/次）— P0
- 防覆盖闸（有内容章节需 overwrite 显式确认）— P0
- 草稿/定稿状态机（outlined→drafted→final）— P0

### 2.6 AI Writing Tools
- 润色/扩写/缩写/换风格 — P1 — 依赖: 章节编辑器
- 参考知识检索（题材套路/场景写法，来自 references 表）— P2 — 依赖: FTS
- A/B 草稿对比 — P3

### 2.7 Novel Quality Control
- 结构化审查（issue 清单 + blocking 门）— P0 — 依赖: reviewer
- 修订回路（≤2 轮定点修复）— P0 — 依赖: 审查
- 沉淀管线（summary/facts/charStates/伏笔结算）— P0 — 依赖: 审查通过
- 一致性体检 doctor（设定/时间线/伏笔冲突扫描）— P1
- AI 味检测（复用现有 detector 面板）— P2

### 2.8 Publishing & Export
- Markdown 整书导出 — P2
- TXT 分卷导出 — P2
- 平台格式适配（番茄/起点风格检查单）— P3

### 2.9 User Management
- 单用户本地模式（无登录）— P0（MVP 边界）
- 多用户 + 登录 — P3（NextAuth 预留，schema 预留 ownerId）

### 2.10 Admin & Configuration
- 预算/阈值配置（budgets.yaml 单一事实源）— P0
- 团队/技能注册表（team.yaml/skills.yaml）— P0
- 系统体检页（doctor: 文件/DB/内容完整性自检）— P1
- 模型供应商切换 — P3

## 3. System Architecture（模块/输入/输出/依赖）

```
Frontend (Next.js App Router, RSC + client islands)
  ├─ 书架/工作台/章节编辑器/审查面板/任务面板/聊天浮窗
  └─ I/O: REST API + SSE 订阅 → 只信 API，不直连 DB

Backend (Route Handlers /api/*)
  ├─ /api/novel/*        CRUD + plan/write/review/sediment/export
  ├─ /api/team/*         chat/agents/tasks/turns
  ├─ /api/events         SSE 总线（novel+task 变更）
  └─ 依赖: lib/ai-team (runtime), lib/novel (domain), lib/memory (P4)

AI Layer
  ├─ glm.ts            唯一 LLM 网关（z-ai-web-dev-sdk, 仅后端, capForGlm+timeout）
  ├─ glmJson           结构化 JSON 输出（parse 校验, 失败重试）
  └─ 依赖: budgets.yaml（预算数字）

Agent Runtime (lib/ai-team)
  ├─ 工具循环 glmAgentTurn: Think→Tool→Observe→…≤3轮
  ├─ 任务执行 runTask: 原子认领→执行→核验→落库→汇报
  ├─ 门禁层（代码强制）: 写入核验/目标章核验/E2审查门/防覆盖
  └─ 依赖: agent/ 内容目录（system prompts + skills）

Content Layer (agent/ 目录, 运行时 fs 读取)
  ├─ system/*.md       角色 System Instructions
  ├─ skills/**/*.md    技能正文（YAML frontmatter）
  ├─ config/*.yaml     team/skills/budgets 注册表
  └─ content.ts        唯一加载器: fs + zod 校验 + 缓存 + fail-fast

Data Layer (Prisma + SQLite 单文件)
  └─ 结构化事实唯一真相源; 派生物(索引/摘要)可随时重建
```

- **依赖方向**: Frontend → API → Runtime/Domain → (Content, Data, AI)；禁止反向
- **SSE 选型理由**: 内置零依赖，单向进度推送足够；WebSocket 仅在 P5 多人协作时再评估

## 4. AI Agent Architecture（6 能力 → 具体机制）

| 能力 | 机制 | 状态 |
|---|---|---|
| 1. AI Agent | leader 聊天轮 = bounded 工具循环；工具结果以 tool-result 消息回灌，模型据此决定下一步；禁止"只说话不落库"（写入核验强制） | 机制已验证，重建即可 |
| 2. Long-running | TeamTask 状态机 pending→in_progress→(paused)→completed/failed；进度+日志持久化；断点续跑=从 finalMessages 检查点追加一条 user 指令继续；autoDepth 限制自续深度 | paused 字段新增；续跑机制已验证 |
| 3. Agentic Loop | Verify 为代码步骤而非模型自觉: ①写入核验(声称完成但 0 写入→修复轮→仍 0→fail) ②目标章核验(任务指向章节 wc>0) ③E2 审查门(blocking=0 才可 final) ④数字审计(报告字数 vs DB 实测→📌 系统核验) | 全部需重建（上会话已验证过实现） |
| 4. Background | after()/顺序执行器 + 孤儿任务 heal 轮询；多任务并行；进度/log 实时写 TeamTaskLog → 前端任务面板 + SSE；完成/失败落状态 | 大部分幸存，补 paused+heal 扩展 |
| 5. Multi-Agent | Leader=read-only 工具+delegate 协议（```team-delegate 块，≤3 派单/轮）；成员=12 工具+专属 skills；成员报告自动转发 leader 会话；leader 以 DB 读验证成员报告（不信转述）；派单修复轮（漏块→CASE A/B 裁决→NO_BLOCK） | 协议已验证；skills 注入为新增 |
| 6. Persistent Session | TeamConversation/TeamMessage 按 sessionKey 持久；可重开历史会话；chat 与 task 执行在消息层区分（任务信封 🎯/工具流水 system 行/报告 📦）；历史窗口 12 条×1200 字符 | 已幸存 |

## 5. RAG Architecture（务实方案：结构化检索 + FTS，向量缓行）

### 5.1 内容分层（什么放哪）

| 层 | 内容 | 理由 |
|---|---|---|
| 传统 DB（结构化真相） | bible/卷纲/章纲/角色卡/伏笔台账/charStates/facts/审查结果/任务与会话 | 需要硬一致性（唯一章号/状态机/台账结算），SQL 精确查询零漂移 |
| 检索层（"RAG"） | 章节正文 chunks（FTS5 关键词索引）、历史章摘要、MemoryItem（世界规则/角色状态/关系/悬而未决线） | 语料=单书几十章~几百章≈1-2M 字，FTS+启发式足够；无向量基础设施成本 |
| Session Memory | 近 12 轮对话、当前任务 brief（1800 字符帽）、本次写作任务书（可留档审计） | 生命周期=单次交互 |
| 不进任何库 | 长聊天原文、中间草稿 | 可再生，占空间 |

### 5.2 检索管线（写章时的 context pack 组装）

```
1. 结构化召回(精确): 目标章章纲 + bible 包 + 上一章 summary + charStates 增量 + 开放伏笔(≤8, 按最久未动排序)
2. 语义召回(FTS5): 章纲关键词/出场角色名 → 正文 chunks top-N
3. MemoryItem 召回: category 优先级 world_rule > character_state > relationship > story_fact > open_loop (借鉴 webnovel-writer)
4. 启发式排序: 新近度权重 + 实体频次 + 钩子加分(悬念/反转/冲突) + 冲突预警置顶   ← ContextRanker 思路, 纯确定性, 无模型调用
5. 预算分配: write=30 条(working 45%/episodic 30%/semantic 25%), review=40 条(35/35/30)  ← 借鉴其 budget.py
6. 输出"写作任务书"五段定序: 本章硬约束 → 情节节点(CBN/CPNs/CEN) → 禁区 → 风格指引 → 动态参考(仅风格, 不得覆盖约束)
```

### 5.3 冲突避免（设定/时间线/正文）

- 单一真相源: 每类事实只在一个表可写；沉淀管线是 charStates/facts 唯一写入方
- 时间线 append-only: 章纲 timeAnchor 必填，doctor 扫描乱序/回跳
- 伏笔台账状态机: open→advanced→paid，结算只能在沉淀步；重复 plant 自动转 advance
- 写评分离: 起草与审查不同上下文；机检（占位符/字数/禁区词）先于模型审查
- 冲突检测: MemoryItem.conflicts() 同类目互斥检查 → 写作任务书"预警"段置顶
- 宪法级优先级（写进系统提示词）: 用户当前指令 > 状态机硬门槛 > 项目约束(bible/台账) > skill 流程 > 参考资料

### 5.4 向量路线（Phase 4 评估门）
- 触发条件: FTS 排序质量实测不足 或 SDK 确认提供 embedding 接口
- 方案: sqlite-vec 或 DB 存 embedding + JS 余弦（零新增基础设施）；rerank 仅在质量实测不足时加
- 明确不做: 独立向量数据库服务（成本/运维不成比例）

## 6. Database Structure（Prisma/SQLite）

### 保留（现有 12 models 中）
- Novel（+bible JSON）· Volume · NovelChapter（outline+prose+review JSON+revision+summary+facts+charStates+status）· Foreshadow（伏笔台账）
- TeamAgent · TeamConversation · TeamMessage · TeamTask（+status: paused, +resumeContext?）· TeamTaskLog · TeamTurnLog

### 调整
- 删除脚手架: User/Post（多用户进入 P3 时再按需引入，schema 预留 ownerId 注释）

### 新增（按阶段）
- P1: 无（先跑通现有）
- P4: `MemoryItem`（novelId/category/status: active|resolved/confidence/content/sourceChapter/firstSeen/lastSeen）· `ChapterChunk`（novelId/chapterId/seq/text + FTS5 虚表 raw migration）· `StateChange`（实体/章/旧值/新值，供"最近变化"召回）
- P5: `SkillInvocation`（taskId/skillId/verdict，追溯用）

## 7. Tools & Skills

### 7.1 工具清单（协议: ```novel-tool JSON 块 + ```novel-write 正文块，代码解析执行）
- Leader（只读+派单）: list_novels / read_novel / read_chapter / read_foreshadows / team-delegate — 逐字 TOOL INVENTORY 锚定
- Member（读写）: 4 读 + create_novel / create_chapter / update_novel / update_chapter_content / update_chapter_outline / create_foreshadow / update_foreshadow + novel-write 块；防覆盖闸=代码强制
- P4 新增工具: memory_query(category/query) / reference_search(table/query) / doctor_scan
- 规则: 每轮 ≤3 动作；所有写入真实且永久；id 只能来自快照/读取结果

### 7.2 Skills（agent/ 目录, YAML frontmatter, 按 appliesTo 注入）

**Atlas（4）**: task-decomposition · clarify-before-act(ASK OR ACT + NO_BLOCK) · ground-truth-reporting(反虚构/DB 实测, 收敛原 5 条重复规则) · novel-orchestration(续作链/未写章清单用法)
**Member（映射 webnovel-writer 8-skill 生命周期）**: story-planning(init+plan) · chapter-writing(write: 六步=上下文→起草→审查→润色→提交→备份的网页化) · reviewing(review: issue 清单 schema) · memory-sediment(learn: 沉淀纪律) · project-query(query: 只读查询) · library-hygiene(doctor: 体检)
**Shared**: novel-write-contract(落库契约) · output-contract(完成报告契约) · library-hygiene(id 卫生/防覆盖)
**注入机制**: 成员 system prompt = 角色卡 md + 默认 skill + shared 契约（去重, ≤3000 字符帽）；delegate 协议可选 `skills:["id"]` 字段（registry 白名单校验）；TaskLog 记录实际注入的 skill id

## 8. Sub-Agent Responsibilities

| Agent | 职责 | 工具面 | 专属 Skill |
|---|---|---|---|
| Atlas(leader) | 理解目标/拆解/派单/验证结果/汇报；不写正文 | 4 读 + delegate | 上 4 件 |
| Sage(writer) | 起草/修订章节并落库 | 12 工具 | chapter-writing |
| Nova(researcher) | 设定调研/资料检索（本地知识库优先） | 读 + memory_query | project-query |
| Prism(analyst) | 结构化审查/一致性体检/节奏分析 | 读 + doctor_scan | reviewing |
| Forge(engineer) | 导出/格式转换/系统维护脚本 | 读 + 受限写 | library-hygiene |

- **防偏离**: 任务信封含 mission-lock 段（"你被指派的任务=标题+描述，超范围动作=失败"）+ 目标章核验兜底
- **Leader 验证闭环**: 成员报告仅作线索，leader/代码以 DB 读复核（黄金路径已在旧会话验证）

## 9. Open-Source Integration（webnovel-writer 实测结论）

### 直接复用（方法论/设计，非代码）
- 8-skill 生命周期 → Novara skills 映射（§7.2）
- 审查 issue schema（severity/category/location/evidence/fix_hint/blocking；critical 自动阻断；**无总分**）→ Prism 审查输出格式 + E2 门判定改为 blocking 驱动
- 写作任务书五段定序 + "上下文不足返回 blocker 而非硬编"
- Memory 三层（working/episodic/semantic）+ 类目优先级 + 任务类型预算分配
- ContextRanker 启发式（recency/frequency/hook bonus）
- 优先级宪法（用户>硬门槛>项目约束>skill>reference）
- SubagentRun 遥测 JSON（status/problems/auto_handled，禁止静默）
- story-repo 领域模型: 承诺(P)每条一档/信息差(S)/名册/时间线 append-only/章摘要卷摘要/上下文包留档审计

### 需改造（换底座重写为 TS）
- Python memory/orchestrator+index → lib/memory（Prisma 实体）
- reference CSV 检索（reference_search.py）→ FTS 表 + API 工具（题材知识入库为静态内容）
- write-gate/preflight/doctor（CLI）→ API 端点 + 系统体检页

### 不采纳
- Claude Code 插件宿主形态 / hooks 机制（换成 API 中间件+代码门禁）
- Flask+React 只读 dashboard（已有全功能 React 前端）
- git-as-repo 的 book 存储（SQLite 单真相源；导出走 markdown；若未来要 diff/回滚再评估）
- v8/DeepSeek Harness 分支内容（非本沙箱可运行形态）

## 10. Technology Stack（选择理由）

| 层 | 选择 | 理由 |
|---|---|---|
| 框架 | Next.js 16 App Router + TS strict | 沙箱标准; RSC 减少 JS; API routes 即后端 |
| UI | Tailwind 4 + shadcn/ui + Lucide | 成熟/一致/组装快; 组件已在库内 |
| DB | Prisma + SQLite(单文件) | 零运维零成本; 未来切 Postgres 仅改 provider |
| 检索 | SQLite FTS5 + 确定性启发式 | 单书语料规模下性价比最高; 无新增服务 |
| LLM | z-ai-web-dev-sdk → GLM（仅后端） | 沙箱唯一可用供应商; capForGlm+60s timeout 已验证 |
| 实时 | SSE（原生 Response 流） | 零依赖; 进度推送单向足够 |
| 校验 | zod | API body + YAML 注册表 + GLM JSON 输出三处共用 |
| 内容解析 | gray-matter（skill frontmatter） | 轻量; 与 YAML 注册表同栈 |
| 包管理 | bun | 沙箱标准 |
| 明确不引入 | 向量库/socket.io/Redis/队列服务/第二 LLM 供应商 | MVP 复杂度控制（§5.4/P5 再评估） |

## 11. Development Phases

### Phase 1 — Core Foundation（MVP 地基）
- 清理脚手架(User/Post) + schema 定稿 + db:push
- `agent/` 目录骨架 + content.ts 加载器（zod fail-fast）+ budgets.yaml 收编全部魔法数
- atlas.md/成员 md 平迁（行为零变化）+ 书籍 CRUD API/UI + SSE 总线重建
- **验收**: 创建→列表→打开空书全流程无手写 SQL; 内容文件缺失→启动报错

### Phase 2 — Novel Creation System
- 创建向导（GLM 生成 bible/角色/卷纲/章纲）+ 编辑器四视图（bible/outline/chapters/foreshadow）
- AI 起草→落库 + 沉淀管线重建（summary/facts/charStates/伏笔结算）
- markdown 导出
- **验收**: 手动走通 建书→规划→写1章→沉淀→导出

### Phase 3 — AI Agent & Agent Runtime（MVP 完成线）
- 工具循环硬化 + 任务队列（认领/进度/日志/收尾自愈/断点续跑/paused）
- 防线重建: 写入核验/目标章核验/数字审计/幽灵id清洗/WRITE_CLAIM_RE(含"同步")/防覆盖闸
- 后台执行 + heal 轮询 + 任务面板 + leader followup 链
- **验收（MVP Gate）**: 派单写章 → 后台完成 → DB 有货 → 报告数字=DB 实测 → 虚报被核验戳打脸（人为注入一次虚假声明做红队测试）

### Phase 4 — RAG & Memory System
- MemoryItem/ChapterChunk/StateChange 落地 + FTS5 验证
- context pack 组装器（三层召回+启发式排序+预算分配）+ 写作任务书五段化
- memory_query 工具 + 冲突检测 + doctor 体检端点/页面
- **验收**: 写第 10 章时任务书自动含第 3 章伏笔与角色状态变化；向量路线 go/no-go 决策留档

### Phase 5 — Multi-Agent System
- 全员就位 + 专属 skills 充实 + delegate `skills` 字段 + mission-lock
- leader 验证闭环 + SkillInvocation 遥测 + 题材参考库（references CSV 改造入库, 可选）
- **验收**: 一句话→Atlas 拆单→Sage 写→Prism 审→blocking 定点修→leader 汇报全程无人工干预

### Phase 6 — Quality Control & Optimization
- E2 门定稿（blocking=0 才 final）+ 修订回路 ≤2 轮 + 行为 evals（fixtures 思路）
- 性能（并发任务限流/GLM 429 韧性复核）+ A/B 草稿 + 导出打磨
- **验收**: 连续 10 章自动写作, 0 虚报穿透, 0 覆盖事故, 审查 blocking 全部闭环

## 12. Dependencies（新增包最小集）

- 新增: `zod`(已在) · `gray-matter` · `yaml`
- 复用: @prisma/client · z-ai-web-dev-sdk · 全套 radix/shadcn
- 明确不加: 向量库客户端 / socket.io / 队列 / ORM 之外的 DB 驱动

## 13. Priority Matrix

- **P0（MVP=Phase1-3）**: 会话/任务队列/工具循环/写入核验/书籍与章节 CRUD/创建向导/沉淀/审查门/防覆盖/预算配置/SSE
- **P1（Phase4）**: 记忆三层/FTS/任务书组装器/doctor/时间线/名册
- **P2（Phase5-6）**: 全员多智能体/skills 注入协议/参考库/导出/AI 味检测
- **P3（远期）**: 多用户/A/B/关系图/平台适配/模型切换/向量升级

## 14. Future Expansion

- Postgres 迁移（Prisma provider 一改）· 多书并行创作 · 用户系统与协作 · 插件化工具注册 ·
- 多模型路由（审查/写作分模型）· 发布管道对接 · git 化导出仓 · 移动端适配

## 15. Risks

| 风险 | 缓解 |
|---|---|
| 环境快照回滚再丢代码（本次已发生） | 关键里程碑后提示用户快照/导出; 核心逻辑保持小文件高内聚便于重放 |
| GLM 限流/超时打断长链路 | capForGlm+timeout+收尾轮+断点续跑（已验证机制重建） |
| 模型虚报/越权（RC1-RC4 教训） | 代码门禁四件套+审计+任务信封 mission-lock, 永不信任模型自述 |
| FTS 中文分词质量 | SQLite FTS5 默认 unicode61 对中文可用性待测（To-Confirm）, 备选=bigram 分词入库 |
| 复杂度回潮 | 每 Phase 有 MVP Gate 与验收线; 不达 Gate 不进下一 Phase |

---

*本计划基于 2026-02 本轮实测：项目磁盘状态（Bash 直读）+ webnovel-writer@master 仓库实检 + 旧会话已验证机制清单。实施前等待确认。*
