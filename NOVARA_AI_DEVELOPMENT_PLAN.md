# NOVARA AI — Development Plan (AI Novel Writer)

> Status: PLAN v1.5（Phase 5 Multi-Agent 已实装并 E2E 实测 · Atlas leader 循环 + team-delegate + 五角色工具面 + 审查闭环 + SkillInvocation 遥测） · Date: 2026-11
> 核心原则: 先简化架构，再逐步扩展 · MVP 优先 · 每个技术选择附理由 · 过程透明（§4.1）
> v1.0→v1.1: 现状基线刷新（官网/Writer/API 已建成并 E2E 实测）+ 新增 §4.1 Agent-Driven Task Board（D1/D2）+ §11 Phase 重校准（含官网承诺映射）
> v1.1→v1.2: Writer 壳重组为三栏 Agent Workbench（对话第一界面；内联审批卡；左树实时徽章；工件层警示条）——§4.1 UI 规格已按实施更新
> v1.2→v1.3: **Phase 3 核心落地**——AgentRun/AgentTask/AgentEvent 三表 + agent/ 内容层（budgets.yaml 收编魔法数）+ 工具循环（novel-tool/novel-write 行协议）+ 四防线 + SSE 推流 + 双执行模式；mock 网关已切换为 live API（agent-client 单点换线）。E2E 实测：审批链路/拒绝→paused/Full Access 连续执行/虚报被核验标红 全部真实发生
> v1.3→v1.4: **Phase 4 收尾——memory 工具化**——memory_query（打分查询故事记忆，零命中反幻觉引导）+ doctor_scan（一致性体检）进入 Sage 工具循环（tool-protocol/runtime/sage.md 同步）；E2E 实测：dev.log MAX(index) 指纹证明模型真实调用 memory_query ×3，Task 1 依据记忆审读 → Task 2 写 Chapter 3 落库，写入核验修复轮照常触发
> v1.4→v1.5: **Phase 5 Multi-Agent 落地**——Atlas 升级为 leader 工具循环（```team-delegate 工单协议，CODE 派单执行、verified 结果回灌）；五角色（atlas/sage/nova/prism/forge）角色卡+专属 skill+MEMBER_TOOLS 代码级工具面白名单；AgentTask.assignee/AgentEvent.actor/SkillInvocation 三表；审查闭环（review_chapter 工具 + blockingFound 审计 + 无修复则终报标注）；E2E 实测：写章 run（5 单：sage×2+prism×3，审查-修复闭环审计就位）+ nova/forge run（研究+导出，exportsRun 虚报被标红）

---

## 0. Verified Facts / Recommendations / To-Confirm

### ✅ Verified Facts（磁盘实测，v1.1 复核）
- 项目根 `/home/z/my-project`：Next.js 16 App Router + TS strict + Tailwind 4 + shadcn/ui + Prisma/SQLite + bun，dev server 健康（port 3000），lint 全绿
- **官网已建成并通过 Agent Browser E2E 实测**（v1.0 时为计划项）：五页面（Home 11 Sections / Product / Plans / About / AI Writer）+ Terms/Privacy 法务页；hash 路由；Login 直通 Writer（无认证，guest session）；移动端响应式与 Footer 贴底验证通过
- **AI Writer 已建成**：novel dashboard / workspace（Chapters·Characters·World·Outline·AI Team 五标签）/ chapter editor / 版本化 JSON 导入导出（`format: novara-novel-backup, version: 1` + integrity 计数校验块，E2E 实测可用）
- **API 已建成**：novels / chapters / characters / world-entries / outline-beats CRUD + import + ai/draft（实验）
- **Agent Runtime 已实装（Phase 3 · 2026-11 E2E 实测）**：`POST /api/agent/runs` + `GET …/[id]` + `…/approve|cancel|mode` + SSE `…/events`；Atlas 规划（chatJson）→ Sage 顺序执行（bounded 工具循环 ≤3 轮）→ 写入核验（修复轮）→ 审批门（写入暂停待批准，批准由代码提交）→ 终报核验（claimed vs verified 对照）。实测证据：废土书全链路（规划 1 任务→起草 539 词→审批→入档→completed，模型虚报 666 词被标注）；abc 书诚实 BLOCKED（第1章为空时拒绝幻觉）；Full Access 直写 375 词无闸口，虚报 chaptersWritten=3/words=1194 被双条核验注记戳穿；Reject→paused 零写入
- 当前 schema 13 models：`User`（预留）· `Novel` · `Chapter` · `Character` · `WorldEntry` · `OutlineBeat` + 沉淀四表 `ChapterDigest/StoryFact/CharacterState/Foreshadow` + Agent 三表 `AgentRun/AgentTask/AgentEvent`
- ~~已知缺陷：`POST /api/ai/draft` 运行时 401~~ → **已修复（2026-11 实测）**：GLM 凭据注入恢复正常，POST /api/ai/draft 返回 200 + 真实 prose（append/fill 双模式 E2E 实测通过）
- v1.0 引用的旧引擎参考件（server.ts 1396 行 / novel-tools.ts / prompts.ts）**现已不在磁盘**；其机制设计已收录本计划 §4/§7/§8，作为重建蓝本
- DB 数据完好（真实样例书可读写）；平台自带 `/skills/` 目录为 Z.ai 资产，不计入本项目、不依赖、不修改
- 开源仓库 `lingfengQAQ/webnovel-writer` 已实际克隆检查（v6，Claude Code 插件，GPL-3.0）：8 skills + 4 agents + Python 记忆引擎 + 只读 dashboard，详见 §9

### 📌 Recommendations（技术建议，附理由见正文）
- 结构化检索优先，向量库缓行（FTS5 + 启发式排序足够覆盖单书语料）
- 采用 webnovel-writer 的"审查 issue 清单 + blocking 门"替代单一总分
- 文件化 System Instructions/Skills（`agent/` 目录）+ YAML 注册表 + 代码强制层

### 🔒 Confirmed Decisions（用户已拍板 · v1.1）
- **D1 — Agent 自主 Todo**：任务清单由 Agent（Leader）自行拆解与安排；用户不建单、不编辑清单，实时旁观执行进度（透明化；界面格式对齐开发环境 Todo 面板，见 §4.1）
- **D2 — 双执行模式**：`Approval`（默认，关键闸口暂停待批准）与 `Full Access`（一次授权连续执行；删除/覆盖等不可逆操作仍强制停下）；开关置于输入区，即时生效（§4.1）
- **D3 — 融合位置**：Agent Task Board 归入 Phase 3（Agent Runtime & Task Board），为 MVP 完成线核心交付（§11）
- **D4 — 边界沿袭**：认证延后（Login 直通，User model 已预留）；订阅仅配置与展示，Payment Gateway 不开发、不虚构任何付款/订阅状态（官网已如实标注 pending development）

### ❓ To-Confirm（待确认事项）
- ✅ z-ai-web-dev-sdk embedding 接口：**无**（2026-11 核验 dist/index.d.ts 零匹配）→ Phase 4 v1 走确定性打分召回，向量路线 no-go 留档（仅需替换打分函数）
- ✅ SQLite FTS5：**v1 不采用**（2026-11 决策留档）——当前规模（每书数千条内）JS 侧打分足够且中文友好（bigram）；FTS5 需 raw 虚表会引入 db push 漂移风险，规模触发时再评估
- Approval 闸口首批粒度（建议：章节入档 final / 批量改写 / 删除性操作 三类起步，按用户反馈增减）

---

## 1. Project Overview

- **定位**: Novara AI = 网页版长篇小说创作工作台 + 多智能体写作团队
- **一句话**: 让 AI 写到几百章，仍记得设定、接得住伏笔、守得住大纲 —— 一致性系统，非一次性生成器
- **形态**: Next.js 全栈单仓（本沙箱），SQLite 单文件存储，GLM 单一 LLM 供应商
- **设计底线**: 模型只能"建议"，代码负责"强制"；完成断言一律 DB 实测；写评分离；过程透明（Agent 自主任务清单实时可见，§4.1）

## 2. Core Functions（10 类拆解）

图例: 优先级 P0>MVP必需 / P1 / P2 / P3 · 依赖写在其后

### 2.1 Core Functions
> v1.1 注：原 Team* 依赖命名随 schema 重写废弃，统一更名为 Agent*（AgentRun/AgentTask/AgentEvent/AgentConversation），见 §6。

- 会话管理（聊天/任务双形态）— P0 — 依赖: DB(AgentConversation/AgentMessage)
- Agent 对话与工具循环（bounded loop）— P0 — 依赖: GLM, 工具协议
- 任务队列与后台执行 — P0 — 依赖: AgentRun/AgentTask/AgentEvent
- **Agent 任务看板（Agent 自主 Todo，用户实时旁观）— P0 — 依赖: AgentRun/AgentTask/AgentEvent + SSE（§4.1 · D1）**
- **执行权限模式（Approval 默认 / Full Access）— P0 — 依赖: run 状态机 + 闸口裁决 API（§4.1 · D2）**
- 写入核验与反虚报审计 — P0 — 依赖: DB 直查（任务状态翻转与真实写入绑定，见 §4.1）
- 进度实时推送（SSE）— P1 — 依赖: EventBus（Todo 状态流为其第一类负载）
- 遥测（turn log / tool receipts）— P0 — 依赖: AgentTurnLog

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
  ├─ 官网五页（已建成）· 书架/工作台/章节编辑器/审查面板/聊天浮窗
  ├─ Agent Todos 看板（计数徽章/Task ID/并行组/状态图标）+ 内联审批卡 + Approval·Full Access 模式开关，承载于三栏 Workbench 壳（§4.1 v1.2）
  └─ I/O: REST API + SSE 订阅 → 只信 API，不直连 DB

Backend (Route Handlers /api/*)
  ├─ /api/novels|chapters|characters|world-entries|outline-beats   CRUD（已建成）
  ├─ /api/import  备份导入（已建成）· /api/ai/draft 实验起草（已建成，401 修复中）
  ├─ /api/agent/runs              run 启动/详情/批准/取消（Phase 3）
  ├─ /api/agent/runs/[id]/events  SSE：task 状态 + 活动事件（断线重连全量对账，降级轮询）
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

### 4.1 Agent-Driven Task Board（v1.1 新增 · 已确认决策 D1/D2）

参考原型：开发环境 Todo 面板（卡片/计数徽章/Task ID/并行组/状态图标）+ DeepSeek Novel Workbench（过程可见/工具调用记录/需要你确认/Full access 开关）。

**行为设计（D1 — Agent 安排，用户旁观）**
- 用户下达目标（如 写第 8 章 / 建立世界观基础）→ Leader 先拆解并产出任务清单，再逐步执行
- 清单由 Agent 自主拆解与调整；用户不建单、不编辑——界面只读呈现进度 + 审批
- 每个任务绑定产物（章节/OutlineBeat/WorldEntry 等）；完成即物化入 DB，不留口头汇报

**任务状态机**（翻转由代码执行，且必须与真实写入绑定——写入核验通过才置 done；模型自述不直接改状态）
```
pending → in_progress → needs_approval → done
                     ↘ blocked / failed（含修复轮；blocked 可回 in_progress）
```

**UI 规格（Writer 工作区 · v1.2 已实施：三栏 Agent Workbench 壳）**

> v1.2 变更（已确认后实施）：原 7 标签工作区（Chapters/Characters/World/Outline/AI Team/Review/Memory 平级标签，Agent 面板嫁接在 "AI Team" 标签内）已重组为三栏 Agent Workbench —— 对话是第一界面，内容面降为工件视图。地基层（types/agent-types/mock-agent/agent-client/hooks/api）原封未动，仅换壳。

| 栏 | 内容 | 对应数据 |
|---|---|---|
| 左 · AssetTree（300px） | 小说头卡（进度/Details/Export/Delete）+ 资产树（章节列表/Outline/Characters/World/Review/Memory）+ **实时 agent 徽章** | Novel/Chapter/OutlineBeat/Character/WorldEntry + AgentTask.artifactType/artifactLabel 绑定 |
| 中 · ConversationPane（弹性） | Chat/Board 切换；Chat = 对话流（agent 气泡/连续工具调用与写入折叠为过程组/错误红卡/系统行）+ **内联审批卡**；Board = Todos 看板 + 活动流；底部输入区 = goal 编辑器 + 模式开关（运行中变控制条：状态/目标/模式/取消） | AgentEvent(kind=message/tool_call/write/task_update/error/approval) + AgentRun.mode |
| 右 · ArtifactPane（400px，<xl 折叠为 Sheet） | Draft/Outline/Bible/Review/Memory 工件 tabs + **工件层警示条**（error 事件按资产类型挂到对应 tab；in_progress 写入任务显示 amber 提示） | Chapter.content 等 + AgentEvent.payload.artifact |

- Todos 看板（Board 视图 + 保留可内嵌）：标题 Todos + 计数徽章；行 = 状态图标 + Task ID（并行组形如 Task 3-a / 3-b）+ 一行范围描述 + 平行组左色轨
- 状态图标：pending 空心 · in_progress 旋转 · needs_approval 橙（含手掌图标） · done 绿 · failed/blocked 红
- 左树徽章绑定规则：task.artifactType=chapter → 解析 artifactLabel 章号绑定对应章节行（章不在树中→回落到 Chapters 组头）；outline_beat/world_entry/character → 对应组头；无 artifact → 小说头卡。in_progress=旋转，needs_approval=橙手掌
- 审批：**内联卡长在对话流里**（amber 卡：写入目标/字数/摘要/拒绝说明 + Reject/Approve），闸口出现时自动切到 Chat 视图；不再使用弹窗作为主通道（弹窗组件已移除）
- 模式开关（D2）：Approval（默认）/ Full Access，位于输入区（运行中在控制条，awaiting_approval 时禁用切换）；Full Access 连续执行，但不可逆操作（删除、覆盖非空章节）无论何种模式一律暂停确认
- 响应式契约：≥1280 三栏；1024–1280 双栏 + 右栏 Sheet（对话头部预览按钮）；<1024 单栏 + 底部三键（Conversation/Assets/Artifacts），点树资产自动弹工件 Sheet
- 纯手写路径保留：右栏 Draft 编辑器不依赖任何 run，随时可写（对齐“agent 主驱动但不锁死人写”的边界）

**通道与对接**
- SSE `/api/agent/runs/[id]/events`：推送 task 状态变化与 AgentEvent；断线重连以 run 详情全量对账；降级 2s 轮询
- 工具循环新增协议消息 `agent_task_update`（代码解析执行，与写入核验同层）
- delegate 派单自动登记为并行任务（parallelGroup），成员完成回报经 leader DB 复核后才置 done
- run 结束产出 finalReport（含数字审计对照：报告值 vs DB 实测值）

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

### 现状（v1.1 复核：6 models 已建成）
- `User`（NextAuth 预留，未使用）· `Novel`（聚合根）· `Chapter`（index 唯一约束 + wordCount 服务端重算）· `Character` · `WorldEntry` · `OutlineBeat`
- v1.0 所述 Team*/Foreshadow 旧命名已随 Atlas 清理废弃；以下新增清单即本计划完整演进路径（沉淀类列随 Phase 2 引入时细化）

### 新增（按阶段）
- **P3（已落地 · 2026-11）**:
  - `AgentRun` — novelId / goal / mode: approval|full_access / status: running|awaiting_approval|paused|completed|failed|cancelled / finalReport(JSON) / error
  - `AgentTask` — runId / key（Task N）/ parallelGroup(现固定 null) / title / detail / status: pending|in_progress|needs_approval|blocked|failed|done / artifactType/artifactId/artifactLabel / order
  - `AgentEvent` — runId / taskId? / kind: task_update|tool_call|write|message|error|approval / summary / payload(JSON，**审批挂起的写入也存于此**)/ createdAt
  - ⬜ `AgentConversation` / `AgentMessage` — 顺延 Phase 5（见 Phase 3 诚实标注）
- P4: `MemoryItem`（novelId/category/status: active|resolved/confidence/content/sourceChapter/firstSeen/lastSeen）· `ChapterChunk`（novelId/chapterId/seq/text + FTS5 虚表 raw migration）· `StateChange`（实体/章/旧值/新值，供"最近变化"召回）
- P5: `SkillInvocation`（taskId/skillId/verdict，追溯用）

## 7. Tools & Skills

### 7.1 工具清单（协议: ```novel-tool JSON 块 + ```novel-write 正文块，代码解析执行）
- **已实装（Phase 3+4+5）** — Atlas（leader 循环）: read_novel / read_outline / read_foreshadows / memory_query / doctor_scan + **team-delegate（工单协议，CODE 创建任务并派给成员，≤planMaxTasks 单/run）**；Sage（writer）: 全部读 + create_chapter / update_chapter / update_outline_beat / finish；Nova（researcher）: 只读（project-query）；Prism（analyst）: 读 + doctor_scan + **review_chapter**（与 Review tab 同一核心，critical 强制 blocking 服务端裁决）；Forge（engineer）: 读 + **export_markdown**（真实构建整书，feed 报数字）；防覆盖闸=write-gate.ts 代码强制（runtime 永不自确认）；**MEMBER_TOOLS 白名单在 executeTool 入口硬门禁**
- **v1.3 偏差记录**：create_foreshadow / update_foreshadow **不开放给 agent**——§5.3 单一真相源优先：沉淀管线是 Foreshadow/StoryFact/CharacterState/ChapterDigest 的唯一写入方，agent 只读台账；此为对旧引擎工具面的有意收窄
- Phase 5 新增: ~~team-delegate（Leader）+ mission-lock 信封 + skills 注入~~（已落地 v1.5）；reference_search 顺延（依赖 references 表）
- **skills 注入（v1.5 已实装）**：成员 system prompt = 角色卡 + 默认 skills + delegate 可选 skills 字段（registry 白名单校验，未知 id 记 injected:false + 事件注记）；**SkillInvocation 表逐任务遥测实测**（16 行：sage 3 件/prism 2 件/nova 2 件/forge 2 件全部 injected=true）
- 规则: 每轮 ≤3 动作（budgets.yaml）；所有写入真实且永久；id 只能来自快照/读取结果

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

> **官网公开路线图 ↔ 本计划映射**：Site P1 Core foundation = Phase 1 · Site P2 Novel creation system = Phase 2 · Site P3 Agent runtime = Phase 3 · Site P4 RAG & story memory = Phase 4 · Site Full AI team = Phase 5 · Site Quality & optimization = Phase 6。官网进度标注与本计划状态同步更新，不虚构。

### Phase 1 — Core Foundation（MVP 地基）— 已建成 ✅
- ✅ Novara schema 定稿 + db:push（10 models 含沉淀四表；旧 Atlas 脚手架已清理，User 保留为认证预留）
- ✅ 书籍/章节/角色/世界观/大纲 CRUD API + AI Writer UI（dashboard/workspace/editor）+ 版本化导入导出 + 官网五页（E2E 实测通过）
- ✅ `agent/` 目录骨架 + content.ts 加载器（zod fail-fast + 缓存）+ **budgets.yaml 收编魔法数**（2026-11：QUOTA 300/4000、GLM 超时、回合/动作预算、上下文裁剪、SSE 间隔等全部入库；ai-json/draft 共享同一真相源）
- ✅ SSE 实现落地（Phase 3 交付：`/api/agent/runs/[id]/events` 全量快照推流 + 变更签名去重 + 心跳；断线重连天然对账）
- **验收**: 已达成（内容层文件缺失会 fail-fast；SSE 断线重连全量对账由全量快照机制保证）

### Phase 2 — Novel Creation System — 部分建成
- ✅ 章节编辑器 + AI 起草（实验性 /api/ai/draft，内容经用户编辑回环才落库）
- ✅ **draft 401 已修复**（2026-11 实测 200 + prose，双模式 E2E）
- ✅ **字数配额注入（targetWords → AI 可见）**：LENGTH PLAN（目标/已写/剩余）+ 章节配额 = 剩余字数按剩余 beats 均摊（无 beats 时按已成稿平均章长，信号不足回退默认 500-800 词；配额限幅 300–4000；append 模式扣减本章已有字数）；实测 append 2652/3929 词、fill 回退 401 词，行为符合设计
- ✅ 创建向导 **GLM 生成 + 结构化落库**（2026-11 实测）：`POST /api/ai/wizard` 按 section 生成 logline/premise/characters/beats（中英双语规范行格式，上下文连贯传递）；`wizard-parse.ts` 容错解析（编号/破折号变体/裸行全兜底）；`POST /api/novels` 支持嵌套 characters/worldEntries/outlineBeats 原子落库（wizard 传 targetWords，联动 draft 字数配额）；Agent Browser E2E：四步全 AI 生成 → 创建 → Characters(6)/Outline(12) 结构化入库 ✓。**剩余：大纲→章节工作流打通（随 Phase 3 run 系统实装）**
- ✅ **沉淀管线 + 审查门 + 防覆盖闸（2026-11 实测）**：
  - **Schema**：新增 ChapterDigest / StoryFact / CharacterState / Foreshadow 四表（共 10 models）；StoryFact 与 MemoryItem contract 同构（category 五类/sourceChapter/firstSeen/lastSeen）——Phase 4 在其上建 FTS/召回，不另起炉灶；沉淀管线是这些表的**唯一写入方**（单一真相源）
  - **审查门**：`POST /api/chapters/[id]/review` — GLM issue 清单（severity/category/location/evidence/fixHint），**critical 强制 blocking（服务端裁决，模型无权决定）**；带上一章 digest 做连续性审查；chatJson 自动重试 + jsonrepair 修复 GLM 畸形 JSON
  - **沉淀管线**：`POST /api/chapters/[id]/sediment` — 一章一次事务写入 digest（upsert）/charStates（按章替换）/facts（按 category+content 去重，命中则 touch lastSeen）/伏笔状态机（open→advanced→paid，只前进不后退，ADVANCE/PAID 只认服务端台账 id）；**输出协议为行格式而非 JSON**（章节对话引号会击穿 JSON 转义，实测两次 502 后改行协议一次通过）
  - **防覆盖闸**：PATCH chapter 有内容替换需显式 `overwrite:true` 否则 **409 requiresOverwrite**（实测 409/200 双向）；编辑器弹确认对话框（旧词数 vs 新词数）；Phase 3 agent 写入直接复用此闸
  - **Review 标签页实装**：选章→Run AI review→issue 清单（blocking 红线）→ blocking=0 才出现 Settle 按钮→沉淀结果卡（计数徽章+digest+伏笔台账带状态徽章）；Agent Browser E2E：审查（4 issues）→闸门放行→沉淀（4 facts/1 state/1 plant/**2 advanced/1 paid** 状态机全链路演示）✓
- ✅ **markdown 整书导出（2026-11 实测）**：`GET /api/novels/[id]/export/markdown`（meta+cast+world+outline+全部章节单文件 .md，Content-Disposition 附件）；Export 对话框新增 Markdown 按钮（JSON 备份用于重导入，MD 用于阅读）——**Phase 2 验收链路「建书→规划→写1章→审查→沉淀→导出」全环闭合**
- **验收**: 建书→规划→写1章（AI 起草落库）→审查→沉淀→导出 全流程走通

### Phase 3 — Agent Runtime & Task Board（MVP 完成线 · D1/D2 核心交付）— 核心已实装 ✅（2026-11 E2E 实测）
- ✅ **Schema + API**：AgentRun/AgentTask/AgentEvent 三表落库；`POST /api/agent/runs`（after() 后台执行）、`GET …/[id]`、`…/approve`（approve/reject）、`…/cancel`、`…/mode`、`…/events` SSE（变更签名去重 + 心跳 + 终态自动关流）
- ✅ **内容层**：agent/config/budgets.yaml + team.yaml + skills.yaml；agent/system/atlas.md + sage.md；agent/skills/*（decomposition/ground-truth/chapter-writing/novel-write-contract/output-contract）；content.ts 加载器（zod + cache + fail-fast，budgets 降级到默认值）
- ✅ **工具循环（bounded）**：novel-tool JSON 块 + novel-write 正文块 + run-report 块 + BLOCKED 拒绝行；每轮 ≤3 动作、每任务 ≤3 轮；jsonrepair 抢救畸形 JSON；围栏容错（空格/换行语言标记/未闭合围栏，4 例单测通过）；写评分离（读免费/写永久）
- ✅ **四防线**：①写入核验（章节任务零落库→修复轮 ≤2→failed，实测触发）；②目标章核验（正文必经服务端 wordCount 重算）；③E2 审查门（沉淀入口已在 Phase 2 落地；agent 产物的审查门随修订回路在 Phase 6 定稿）；④数字审计（run-report claimed vs DB verified，**实测两次虚报被标红**：666vs539 词、3章1194词 vs 1章375词）
- ✅ **防覆盖闸复用**：write-gate.ts 单实现双调用方（HTTP PATCH + runtime）；runtime 永不自确认 overwrite，非空章替换无论何种模式一律进审批门（不可逆操作白名单）
- ✅ **Agent Task Board（D1）**：任务由 Atlas 自主拆解（chatJson + zod），Todos 看板实时反映（SSE 推流）；任务 done 只在真实写入验证后由代码翻转
- ✅ **双执行模式（D2）**：Approval 默认（章节内容写入全部进闸）；Full Access 直写但不可逆操作仍停；审批期模式开关禁用；拒绝→paused 零写入（实测）；运行中切模式即时生效（下一闸口起）
- ✅ **诚实 BLOCKED**：上下文不足时模型拒绝幻觉（abc 书实测：第1章为空→BLOCKED→任务 blocked）
- ✅ **韧性**：healStaleRuns（15 分钟无事件→failed）；执行器轮询 run.status 等待审批（无状态跨热重载）；取消→abort + 任务 blocked
- ⬜ **Phase 5 顺延**：delegate 多智能体派单（parallelGroup 现固定 null，顺序执行）；nova/prism/forge 角色卡；skills 注入协议
- ⬜ **明确顺延（诚实标注）**：AgentConversation/AgentMessage 会话持久化（run 事件流已覆盖任务历史；无 run 的纯聊天持久化随 Phase 5 会话 UI 一起做）；clarify-before-act 的 ASK 回问协议（当前任务不可行→BLOCKED→blocked，无交互回问）；大纲→章节工作流（随 run 系统现已部分打通：Atlas 可规划写章任务）
- **验收（MVP Gate）**: ✅ 派单写章→Todos 实时可见→后台完成→DB 有货→报告数字=DB 实测（虚报被标红×2）→Approval 未批准不入库（拒绝→paused 实测）→Full Access 连续完成且闸口跳过留痕（approval events=0）

### Phase 4 — RAG & Memory System — v1 已实装 ✅（2026-11 E2E 实测）
- ✅ **检索引擎（lib/novara/memory.ts）**：确定性打分召回 `categoryWeight × 关键词重合 × 新近度衰减`（latin 词元 + CJK bigram，无需分词器/向量）；预算收编 budgets.yaml memory 段（topK/contextBudgetChars/digestWindow/recencyHalfLife/staleLoopChapters）
- ✅ **StoryFact.lastSeenChapter**：沉淀管线唯一写入方——事实被后续章 touch 时记录章号，新近度按叙事距离计算而非时间戳（ch12 重提的 ch1 伏笔保持"热"）
- ✅ **生成端注入闭环（曾缺口：故事圣经只写不读）**：/api/ai/draft 注入 STORY MEMORY + STORY SO FAR 块（实测 considered=25 selected=14 chars=1634，dev.log 留痕）；snapshot.ts 同源供血 agent runtime（memoryBlock 含 digests，替代单条 lastDigest 去重 token）
- ✅ **Memory 视图 API**：GET /api/novels/[id]/memory（items 全量 contract 形 + digests + stats + doctor）；FACT 行产出的 open_loop 类事实（无台账 status）单独计 loopFacts，对账不隐藏
- ✅ **doctor 体检（确定性，零 AI 成本）**：bible-integrity（幽灵章引用）· foreshadow-ledger（≥N 章未推进 warn）· memory-coverage（未沉淀章 warn / 空记忆 fail）· cast-recognition（state 名不在 cast warn）——实测抓出真实数据质量信号（cast-recognition warn）
- ✅ **Memory 面板接真数据**：计数徽章/分类 chips/搜索/循环状态徽章（open·advanced·paid）/Story so far/doctor 卡/空状态指引；mock 移除；Agent Browser E2E：有数据书 25 items 全交互（搜索 25→11、筛选 6/6）✓ 空书 empty state ✓ 移动端 sheet ✓
- ✅ **memory 工具化（v1.4 收尾，2026-11 E2E 实测）**：`memory_query`（queryMemory 自由打分查询：CJK bigram + latin 词元，锚定最新章=叙事现在时；零命中 feed 反幻觉引导「Do NOT invent canon」）+ `doctor_scan`（复用 buildMemoryView 四项检查）进入 Sage 工具循环；sage.md 加 MEMORY DISCIPLINE 段（先查后写、事实即正典、零命中不得虚构记忆）。实测证据：写章 run（The Lifespan Exchange）dev.log 出现 queryMemory 特有 MAX(index) 指纹 ×3（模型真实调用）；Task 1 审读记忆→Task 2 写 Chapter 3 落库；写入核验修复轮照常工作
- ⬜ 顺延：reference_search（依赖 references 表，Phase 5）· StateChange「最近变化」通道 · 冲突检测 · ChapterChunk FTS5（规模到几千条前不需要）
- **验收（v1）**: ✅ 沉淀书面板全真数据可检索可过滤；✅ draft 提示词自动携带该章相关记忆+前情 digest；✅ doctor 报真实完整性；✅ agent 工具循环内可查记忆+体检（E2E 指纹验证）；向量 go/no-go 已留档

### Phase 5 — Multi-Agent System — 核心已实装 ✅（2026-11 E2E 实测）
- ✅ **Atlas leader 循环**：chatJson 一次性规划 → bounded 工具循环（leaderMaxTurns=6，读工具 + team-delegate 工单 + finish）；工单 JSON 数组逐项 zod 校验，错误项 feed 回灌（实测 Atlas 首轮格式错误后自纠重派）
- ✅ **五角色全员就位**：atlas/sage/nova/prism/forge 角色卡 + team.yaml/skills.yaml 注册（content 层 fail-fast）；nova=只读研究、prism=审查+体检、forge=导出+体检、sage=唯一写入者
- ✅ **派单执行**：CODE 创建 AgentTask（assignee 列）→ 成员执行器（角色化 system prompt + 工具面白名单 + 写核验仅 sage 章节任务）→ verified 结果回灌 leader
- ✅ **审查闭环**：review_chapter 工具（与 Review tab 同一 reviewChapter 核心）→ issues/blocking 计数入 Measured 审计 → 终报核验「blocking>0 且无修复写入」自动标注；prism 专属 reviewing skill 纪律（数字真实、不软化 blocking）
- ✅ **数字审计扩展**：Measured 增 reviewsRun/blockingFound/exportsRun 三键，claimed vs verified 全键对账（实测 prism/forge 虚报被标红）
- ✅ **遥测**：AgentEvent.actor（事件流角色归属，实测正确）+ SkillInvocation（skill 注入逐任务留痕）
- ✅ **E2E 实测（The Lifespan Exchange）**：写章 run = Atlas 派 5 单（sage×2+prism×3）→ Chapter 4 落库 212 词 → 3 次审查 0 blocking → 虚报 3 处标红；nova+forge run = 伏笔研究 done + 导出构建 done + exportsRun 虚报标红；429 限流 run = 任务诚实 failed 零虚构
- ✅ **UI**：对话流角色化气泡（头像+名字标签，Agent Browser 截图实证）+ 活动流 actor 前缀 + Task Board assignee 徽章 + Final report 文案更新（Mock→DB 验证）
- ⬜ 顺延（诚实标注）：parallelGroup 并行执行（仍顺序，任务板已有并行组 UI）· AgentConversation/AgentMessage 纯聊天持久化 · clarify-before-act ASK 回问协议（BLOCKED→blocked 已覆盖不可行路径）· 题材参考库 references（reference_search 工具随之）· **blocking→定点修完整触发**（本轮审查 0 blocking 未实测修复单路径；代码路径+skill 纪律+终报核验已就位）
- **验收**: ✅ 一句话→Atlas 拆单→Sage 写→Prism 审→leader 汇报全程无人工干预（修复单路径就位待真 blocking 触发）

### Phase 6 — Quality Control & Optimization
- E2 门定稿（blocking=0 才 final）+ 修订回路 ≤2 轮 + 行为 evals（fixtures 思路）
- 性能（并发任务限流/GLM 429 韧性复核）+ A/B 草稿 + 导出打磨
- **验收**: 连续 10 章自动写作, 0 虚报穿透, 0 覆盖事故, 审查 blocking 全部闭环

## 12. Dependencies（新增包最小集）

- 新增: `zod`(已在) · `gray-matter` · `yaml`
- 复用: @prisma/client · z-ai-web-dev-sdk · 全套 radix/shadcn
- 明确不加: 向量库客户端 / socket.io / 队列 / ORM 之外的 DB 驱动

## 13. Priority Matrix

- **P0（MVP=Phase1-3）**: 会话/任务队列/工具循环/写入核验/**Agent Task Board（Agent 自主 Todo + SSE 旁观，D1）**/**Approval·Full Access 双模式（D2）**/书籍与章节 CRUD/创建向导/沉淀/审查门/防覆盖/预算配置
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
| Full Access 批量误操作 | 不可逆操作白名单（删除/覆盖非空章）无论模式一律暂停; run 级 mission-lock 限定目标范围; 导入导出备份兜底 |

---

*本计划 v1.1 基于 2026-11 磁盘实测（Bash 直读）+ 官网/AI Writer 的 Agent Browser E2E 实测 + webnovel-writer 仓库实检 + 用户已确认决策（D1-D4）。官网与 AI Writer 为当前可运行版本；Phase 2 剩余项起为待实施。*
