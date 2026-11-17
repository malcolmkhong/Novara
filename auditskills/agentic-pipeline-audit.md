# Novara Agentic System Pipeline — 全面审计与实测报告

- 审计日期：2026-11-18（Asia/Kuala_Lumpur）
- 审计方式：三路并行代码深查（流水线/工具与类型/UI 数据链路）+ 项目自带检查实跑 + **真实无头 Agent 运行实测** + 供应商端点直连诊断
- 审计范围：用户指定的 9 个维度（Pipeline / Execution Loop / Tools / Skills / Schema & Types / Scheduling / Scalability / Novel Writing / Chat UI）
- 证据文件：`tmp/audit-live-evidence.json`（真实运行证据）、`tmp/audit-live-write.ts`（测试脚本）、`tmp/audit-minimax-probe*.ts`（供应商诊断）
- 标注约定：【实测】= 本次实际执行验证；【代码】= 代码审查结论（file:line）；【阻塞】= 受外部条件限制无法验证

> **修复进展（2026-11-18 同日）**：H2/H3（审批超时僵尸态 + paused 死锁）**已修复并验证**，见 §13。
> **事实更正（用户澄清）**：C1 中".env 空密钥"是**有意为之**——测试阶段使用 Vertex AI Gemini 的 ADC 免密钥方式，.env 中的密钥是为下一阶段准备的备用项，不是配置事故。MiniMax 额度耗尽与线路模型退役仍属实，但"本机无可用供应商"的结论应限定为"本次测试所用的 MiniMax 路径不可用"；Gemini ADC 路径未在本次实测中验证。H6（Cloud Run 缩容）用户已知悉并接受测试阶段现状，上线初期将锁定免费方案。

---

## 0. 执行摘要

| 维度 | 结论 | 评级 |
|---|---|---|
| 1. Pipeline 完整性 | 目标→规划→派发→执行→验证→修复→报告→交付全链路存在且代码强制 | ✅ 完整 |
| 2. Execution Loop 闭环 | 单执行器内闭环真实（验证→修复→显式失败→审计对账）；跨崩溃闭环依赖手动 resume；两处可永久停滞状态 | ⚠️ 基本闭环，有缺口 |
| 3. Tools Integration | 18 工具声明↔实现一一对应、zod 校验、角色门禁前置；但 DB 异常处理不对称、1 个工具计数不可重建 | ⚠️ 良好，有缺陷 |
| 4. Skills Architecture | 11 技能 fail-fast 加载、按角色注入；但 8000 字符上限静默丢弃后续技能、settle 文案三处两口径、appliesTo 无消费点 | ⚠️ 良好，有缺陷 |
| 5. Schema & Types | tsc 全绿、41 模型所有权全覆盖；但 DTO 缺字段、备份缺 7 类数据、JSON 无校验解析、anthropic 线路有 400 风险 | ⚠️ 有漂移 |
| 6. Task Scheduling | 规则明确（Atlas 委派顺序=执行顺序，串行，planMaxTasks=44）；无依赖图/优先级/并行（parallelGroup 死字段） | ✅ 明确但简单 |
| 7. Scalability | 租约+epoch 围栏实测全绿；固定 5 角色不可动态创建；同小说单 active run；全局 AI 并发=2；Cloud Run 缩容到 0 是长运行真实风险 | ⚠️ 受限 |
| 8. Novel Writing 实测 | 失败路径闭环实测通过；**成功写作路径被外部凭据/额度阻塞，本机无法完成**；供应商配置三层根因已定位 | 🔴 阻塞（外部） |
| 9. Chat UI 真实性 | 无假数据冒充；但思考过程展示不存在、工具调用输入/输出在事件层丢失、Todo 工具不存在、审批卡无正文预览 | ⚠️ 三处能力缺口 |

**一句话结论**：系统的"骨架"（门禁、租约、审计、计量）经实测扎实可靠；"闭环"在单执行器生命周期内真实成立；但**本机当前没有任何可用的 AI 供应商**（.env 空值覆盖 + 密钥额度耗尽 + 线路模型退役三层问题叠加），小说创作能力无法在本机实测成功路径——这是环境/配置问题，不是运行时逻辑问题。UI 侧无造假，但思考展示、工具调用详情、Todo 三项能力缺失。

---

## 1. Pipeline 完整性【代码】

完整调用链（全部函数级核实）：

```
POST /api/agent/runs (route.ts:65-114)
  → zod 校验 goal 3–2000 字 (agent-schemas.ts:29-38)
  → canAfford 积分预检 (:80)
  → createRun (runtime.ts:414-465)：建 AgentRun(status=running) + goal 事件
  → Next.js after() 后台 executeRun (:106-108)
  → claimLease + 10s 心跳 (runtime.ts:1260-1284)
  → runLoop (:1312) → leaderLoop (:1513)
  → loadStorySnapshot (:1528)
  → Task 0 影响评估（仅 pinned 含章节时；assignee=sage 只读 order=0，:1688-1734）
  → Atlas ≤22 回合循环 (:2112)
      每回合 parseAgentTurn 解析 ```team-delegate (tool-protocol.ts:237,260-279)
      → 逐条建 AgentTask（order 递增，:2201-2215）
      → 同步 executeTask (:2224)
      → 结果 "Task N (role) → outcome" 回喂 Atlas (:2245-2247)
  → 收尾报告：claimed vs measured 对账 (:2389-2455)
  → Forge export_markdown / 交付
```

- 任务分析/规划：Atlas 独占，delegateOrderSchema 字段 = title/detail/assignee/artifactType/artifactLabel/skills（tool-protocol.ts:152-165）。
- 结果验证：写后 DB 实测（见 §2）。
- 最终交付：finalReport 持久化 + 导出工具。
- **结论：七段流程全部存在，无断链。**

## 2. Execution Loop 闭环【代码 + 实测】

### 2.1 单执行器内闭环（真实成立）

| 环节 | 机制 | 证据 |
|---|---|---|
| 写后验证 | sage 章节任务要求 DB 有 verified write（chaptersWritten+chaptersUpdated+adoptedWrites>0）；prism certify 任务要求 verified finalize **且记忆投影落库** | runtime.ts:2774-2781, 2805-2831, 2887-2911 |
| 判断与修正 | 验证失败 → 代码硬编码 "VERIFY FAILED…" 修复指令回喂模型，补 2 回合 | runtime.ts:2789-2796 |
| 重试上限 | repairRounds=2，耗尽 → 任务**显式 failed**，issues 进最终报告（响亮失败，不静默） | runtime.ts:2882-2886 |
| 重规划 | 失败结果回喂后 Atlas 可在剩余回合内重新委派——规划非一次性 | runtime.ts:2245-2247 + 2112 |
| 坏输出处理 | 非法工具 JSON 先 jsonrepair 再报错回喂；无 run-report 按 measured 兜底 | tool-protocol.ts:209-224; runtime.ts:2435 |
| 诚实审计 | claimed 计数 vs deriveMeasuredFromEvents 重建计数，不一致 → blocking issue | runtime.ts:870-925; qc.ts:128-144 |

### 2.2 实测：失败路径闭环【实测】

真实无头运行（run `cmwkvthbq0001kwt8btqrsgwh`，minimax:fast，full_access）在供应商返回错误时：
- run 状态 → `failed`（终态，不悬挂）✅
- error 事件落库："Run failed: The AI returned an empty response" ✅
- 租约释放，无残留 active run ✅
- 积分预扣全额退还：余额 60 → 60，7 条 ledger 记录（每日发放+预扣+退还）✅
- 守护失败翻转机制另有 18 项自带检查全绿（verify-p5-e1：死租约翻转、活租约拒绝、终态保护、paused 保护、真实错误信息持久化）✅

### 2.3 闭环缺口【代码】

1. **审批超时死等**：pauseForApproval 30min 超时返回 stopped 但**不翻转状态**（runtime.ts:3750）——run 留 awaiting_approval、执行器退出；此后 approve 仍可提交并置 running（:719-720），**却无执行器接手**，只能等 heal 标 failed 或手动 resume。
2. **paused 半死锁**：reject → paused（:722-723）；paused 属 ACTIVE 阻止新 run（:435-441）；resume 对 paused 返回 409（resume route:59-63）——唯一出路是 cancel。
3. **失败任务不降 run 评级**：仅 leaderBlocked 且 0 任务 done 才 failed（:2407-2408）——completed 可携带 failed 任务，失败只在报告可见。
4. **跨崩溃闭环靠手动**：healStaleRuns 只标 failed 不续跑（:790-825）；恢复须手动 POST resume；无自动看门狗。
5. update_chapter 的 commit→event 崩溃窗口无对账（:1030-1032 注释自认，仅 create 有 reconcile）。

## 3. Tools Integration【代码 + 实测】

### 3.1 健康面

- 18 工具声明（toolActionSchema, tool-protocol.ts:25-142）↔ executeTool switch（runtime.ts:2980-3656）**一一对应**，default 分支 `never` 穷尽检查。无死工具、无未声明实现。
- 全部参数先 zod safeParse（tool-protocol.ts:252-257）；角色越权在任何副作用前被拒（runtime.ts:2973-2978）。
- 结果信封 `{ok, feed, adopted?, finalizedChapterId?}` 统一回灌模型并持久化（runtime.ts:2479-2486, 2752-2762）。
- 积分计量覆盖实测：`check:credits` **37/37 provider-reaching 文件全部有 charge 路径，0 遗漏**【实测】。

### 3.2 缺陷

| # | 缺陷 | 证据 | 严重度 |
|---|---|---|---|
| T1 | **DB 异常处理不对称**：review/settle/export 内部 try/catch 转错误 feed 可重试；但 read 类、update_ledger、create/update_chapter、update_outline_beat、reopen/finalize_asset 的 DB 异常不捕获——成员路径直接杀死任务，领导路径杀死整个 run。一次瞬时 DB 错误不会反馈给模型重试 | runtime.ts:2926-2944, 2170-2183, 1291-1306 | High |
| T2 | **export_markdown 计数不可重建**：只加内存计数、不发事件，deriveMeasuredFromEvents 无对应分支——崩溃恢复后导出计数归零，违反自家"计数器可从事件重建"规则 | runtime.ts:3397-3413, 884-920 | Medium |
| T3 | finalize_asset/reopen_asset 声明 `index` 参数但 character/world_entry/pack/contract 分支忽略它只认 name——模型给 index 静默落空 | runtime.ts:1426-1484 | Low |
| T4 | 注释称 "finish is always allowed" 但 atlas/nova 白名单**不含 finish**——注释与代码矛盾（AGENTS.md §9 同误） | runtime.ts:1343-1344, 1358, 1372 | Low |
| T5 | **tool_call 事件 live 路径从不发射**（仅死代码 mock 用）——工具调用详情在事件层即丢失（详见 §9） | agent-types.ts:182; mock-agent.ts:210-267 | Medium |

### 3.3 供应商适配层实测缺陷【实测】

- **MiniMax 适配器吞掉供应商错误**：端点返回 HTTP 200 + `base_resp.status_code≠0`（invalid api key / model retired / quota exhausted）时，`toContent` 只看 `choices` → 返回空串 → 上层报 "The AI returned an empty response"，**真实错误码被丢弃**。诊断只能靠直连端点。建议：适配器检查 base_resp 并抛出带 status_code 的错误。（http.ts:75-80, 98-106; minimax.ts）
- gemini 把 thinking "off" 静默升为 low（gemini.ts:13-17）——行为合理但未在 UI 披露。

## 4. Skills Architecture【代码】

- 11 技能文件：atlas×3、sage×3、nova×1、prism×1、forge×1、shared×2；注入由 team.yaml role.skills 决定（team.yaml:14-57）。
- 加载器 fail-fast：引用文件必须存在（content.ts:261-268）；未知技能 id 抛错（:359）；delegate 附加未知 id 跳过并记 SkillInvocation injected:false（:356-358）。
- 每个角色卡对工具均有示例+使用规则（散文式，非机器可读目录）——Agent 知道何时用何工具。

缺陷：

| # | 缺陷 | 证据 |
|---|---|---|
| S1 | **8000 字符上限静默截断**：角色卡永不截断，技能按序追加，超限插入 "[skill X omitted]" 后 **break——其后所有技能一并丢弃**。sage 卡约 5.6K+4 技能最易触发 | content.ts:337-370 |
| S2 | **settle_chapter 三处文案两个口径**：atlas/task-decomposition.md:9-13 仍要求 "finalize then settle"；atlas.md:62-63 与 prism.md:43-44 说 "no longer needed"；运行时 CERTIFY PROTOCOL 仍强制 settle（runtime.ts:2575-2578） | 见左 |
| S3 | **appliesTo 无消费点**：仅 zod 校验，delegate 可把 sage/prose-craft 注入 prism，无角色过滤 | content.ts:41 |
| S4 | 认证协议注入按 title+detail 正则，finalize 验证只看 title——detail 含 certify 而 title 不含的任务得到协议却无验证 | runtime.ts:2569 vs 2805-2808 |
| S5 | 无反向检查：注册表中未被任何角色引用的技能不报错 | content.ts |

## 5. Schema & Types【代码 + 实测】

### 5.1 实测通过项

- `npx tsc --noEmit` **PASS**【实测】
- `db:check:ownership`：41 模型每个恰好一条所有权规则，allowlist 匹配，**PASS**【实测】
- `check-doc-tree`：36 节点 id 唯一、19 渲染器全覆盖、无未解释空文件夹，**PASS**【实测】

### 5.2 漂移与缺陷

| # | 问题 | 证据 |
|---|---|---|
| Y1 | schema 头注释仍称 "SQLite + Prisma"、"guest session 无用户"，与 Postgres+Firebase 现状不符；AGENTS.md 写 40 模型实为 41 | schema.prisma:3-4,17-18,550,655,932 |
| Y2 | 所有 authored 实体的 `finalizedAt` 在 types.ts DTO 中缺失；`ChapterPackDTO.status` 声明可选但两处路由都不返回——客户端永远看不到 pack 正典态 | types.ts:180; packs/route.ts:10-28; novels/[id]/route.ts:249-259 |
| Y3 | 遗留 "revised" 状态：types.ts 称按 draft 读，但详情路由 `c.status as ChapterDTO["status"]` 直接透传未归一化 | novels/[id]/route.ts:187 |
| Y4 | JSON 字符串列无校验解析：parseJsonSafe 仅 JSON.parse+as T，用于 finalReport/pinnedJson/事件 payload；SSE 侧同样裸断言 | runtime.ts:226-233; agent-client.ts:194 |
| Y5 | memory.ts 本地 stats 接口缺 loopFacts 但实现返回它；DoctorFinding/DoctorCheck 重复定义 | memory.ts:429-444,500-502 |
| Y6 | **备份缺 7 类数据**：ChapterPack、StoryPromise/StoryClue、WorldGroup/groupId、conceptSnapshot、非章节实体 canon status、StoryFact.lastSeenChapter、ChapterReview/AssetVersion/AssetTransition——导出再导入会丢伏笔台账与正典锁 | backup-schema.ts:93-128; export/route.ts:20-161 |
| Y7 | **anthropic 线路 400 风险**：WireMessage 只有 user/assistant，系统卡当首条 assistant；anthropic 适配器提取 role==="system" 永远为空；finalizeWire 不合并相邻 user 消息，违反 Anthropic 角色交替约束 | wire.ts:39-42,104-118; anthropic.ts:26-29 |
| Y8 | read_chapter 截断 24000 字符**无截断标记**；快照 cast/world 各限 12 条、outline 40 条，超出对规划者不可见；任务 brief 信封截 1800 但落库截 8000 | runtime.ts:2996,2552,3456; snapshot.ts:57-67 |
| Y9 | 审批恢复按 title+content 匹配章节，同名同文不同章可能误配 | runtime.ts:3706-3708 |

## 6. Task Scheduling & Dispatching【代码】

规则明确且简单：

- **何时创建**：Atlas 每回合解析 team-delegate 块即建 AgentTask（runtime.ts:2201-2215）；Task 0 影响评估在 pinned 含章节时于一切编辑前创建（:1688-1734）。
- **何时分配/执行**：创建即分配（assignee 来自委派），**同步串行执行**（:2224，注释 "Sequential by design"）。
- **谁决定顺序**：完全由 Atlas 委派顺序决定；代码按到达顺序执行。**无依赖图、无优先队列**；`parallelGroup` 字段恒 null（:2205，死字段）。
- **上限**：planMaxTasks=44 每 run 委派总额，超出拒绝并回喂（:2195-2197）；未知 assignee 静默降级 sage（:2511-2513）。
- 同回合内 failed/blocked 任务不阻断后续委派（仅 gate-stop break，:2239-2244）。

**评价**：规则有明确定义（可预测、可审计），但表达力有限——不支持依赖/优先级/并行，44 任务上限对 47 章小说意味着必须分多个 run。

## 7. Scalability【代码 + 实测】

### 7.1 实测通过项

- `verify-stage-a` **18 项全绿**【实测】：租约抢占/心跳/续期、新鲜租约拒绝二次抢占、陈旧租约可抢+epoch 递增、**被抢者写入被围栏拒绝（LeaseLostError）**、转录 seq 唯一索引拒重、级联删除干净。
- `verify-p5-e1` **18 项全绿**【实测】：守护失败翻转 heals 死租约行、活租约行零触碰、终态保护、paused 保护、真实错误持久化、零积分消耗证明。

### 7.2 扩展能力评估

| 能力 | 现状 |
|---|---|
| 多 Agent 并行 | ❌ 任务严格串行；parallelGroup 死字段。同用户跨小说可并行 run，但全局 AI 信号量 maxConcurrent=2（chat.ts:65-94） |
| 动态 Sub-Agent | ❌ 固定 5 角色，delegateOrderSchema enum 限 4 成员（tool-protocol.ts:156），不能运行时创建角色 |
| 同小说并发 | ❌ 单 active run 约束（runtime.ts:435-441）——正确性优先的设计 |
| 长运行 | ⚠️ maxDuration=90 只限 HTTP 响应，after() 后台不受限；但 **Cloud Run timeout=300s + min-instances=0**：实例回收即执行器死亡，靠"崩溃→手动 resume→幂等收养"链存活，无自动续跑 |
| 上下文管理 | ⚠️ context-meter 估算+实账对账已启用；成员切片已启用；**压缩机制已实现但 shipped enabled=false**（budgets.yaml:84），仅 leader 接线；22 回合全量重放无硬 token 熔断 |
| 资源管理 | ✅ 积分预扣/结算/全局熔断实测正常（失败运行余额无损）；用量留存 90 天+日桶永久 |

### 7.3 自带检查中的失败项（如实记录）【实测】

`verify-p5-f`（用量留存）2 处 FAIL + 1 处崩溃：
1. day100 桶 estimatedUsd=null：脚本硬编码旧价格表（glm-4.6 $0.6/$2.2），而价格表已迁移到 registry 投影（旧 id 无价 → UNPRICED null 是**当前正确行为**）——**脚本过期，非产品缺陷**（verify-p5-f.ts:108-132）。
2. HB 边界断言 windowRows=150：数据库真实历史行混入窗口计数——**测试隔离缺陷**（脚本未隔离既有数据）。
3. 末段 fetch localhost:3000/api/usage/statement ECONNREFUSED：**需要 dev server 运行**，本次未启动——环境前置缺失，非代码缺陷。

## 8. Novel Writing Capability — 真实运行实测【实测 + 阻塞】

### 8.1 测试设计

创建测试小说《AUDIT-闭环测试-灯塔守望》（novel `cmwkvs1hs0000kwisma6x5y5t`），**内置一致性陷阱**：
- 人物卡：林晚疤在**左手腕**（故意强调"不是右手"）+ 别名"晚姐" + 黄铜怀表
- 世界观：雾角灯塔建于 1962、灯 12 秒一周、日志第 47 页缺失；白鸥号 1996 失踪
- 大纲 3 节拍 + 故事线"白鸥号失踪真相"
- 目标：写第 1 章约 2500 字 → 评审 → 定稿 → 记忆投影落库（full_access，minimax:fast）

### 8.2 实测结果

**失败路径闭环：验证通过**（见 §2.2）——run failed、error 事件、租约释放、积分无损。

**成功写作路径：被外部条件阻塞，本机无法完成。** 三层根因逐层实测定位：

| 层 | 根因 | 证据 |
|---|---|---|
| 1 | **.env 空值覆盖机器凭据**：.env 中 DEEPSEEK/MINIMAX/OPENAI/ANTHROPIC/ZAI 五个 API key 全为空字符串；bun 加载 .env 后覆盖了机器环境的有效 MINIMAX_API_KEY。而白名单 NEXT_PUBLIC_AI_PROVIDERS_ENABLED=gemini，gemini 又无 ADC 凭据 → **默认配置下没有任何可用供应商** | .env 变量值长度检查（只测空/非空）；进程 env 对比 |
| 2 | **注册表线路模型已退役**：绕过 .env 用机器密钥直连，国内端点报 invalid api key（2049，密钥属国际站）；国际站密钥有效但 MiniMax-Text-01/M1/M2/abab6.5s 全部 "no longer available"（2069）。注册表种子线路名全部过期 | 直连探针实测；/v1/models 返回当前可用列表（M3.1-Flash/M3/M2.7 等） |
| 3 | **Token Plan 额度耗尽**：用当前可用模型 MiniMax-M2.7-highspeed 调用，返回 2067 "The Token Plan usage limit has been reached" | 直连探针实测 |

**附带发现的产品缺陷**：供应商返回 200+base_resp 错误时适配器吞掉真实错误码，上层只见 "empty response"（§3.3）——本次诊断被迫直连端点才定位根因，生产环境用户同样无法自助排障。

### 8.3 结论与恢复路径

- 运行时逻辑（规划→写作→评审→定稿→投影）的代码路径经三路审查完整存在，失败处理实测可靠；但**剧情规划质量、人物一致性保持、伏笔回收、正文质量**这些"成功路径"指标**本次无法实测**，不做无证据的断言。
- 恢复实测的前置条件（任一）：① 为 MiniMax Token Plan 充值/升级并把注册表线路名更新为当前可用模型（可用 env 覆盖 MINIMAX_FAST_WIRE_MODEL，无需改代码）+ 修正 .env 空值；② 配置任一其他供应商的有效密钥并加入白名单。
- 测试小说与失败 run 保留在库中作为证据（uid `audit-live-20261118`，未触碰任何既有数据）。

## 9. AI Agent Chat UI & Interaction Components【代码】

### 9.1 逐项核查

| 组件 | 现状 | 证据 |
|---|---|---|
| **Todos / Task List** | **Agent 可调用的 todo 工具不存在**。"Todos" 只是 AgentTask 看板的 UI 标题（task-board.tsx:79）。Atlas 只能经 team-delegate 建任务，成员连 delegate 都被拒。角色卡与 11 技能均未提及 todo。**无用户可见待办的创建/更新/完成/删除能力——需要决策是否实现** | tool-protocol.ts:25-142 无此类 action; runtime.ts:2685-2687 |
| **Thinking Process** | **思考过程展示不存在**。线路层不捕获推理内容（WireMessage 只有 role/content；ChatResult 只返回 text+usage；全库无 reasoning_content）。thinking 仅作请求参数下发，响应侧思考令牌被丢弃。"进度"只有 narration 截断 280 字 + 静态 "Working…" 转圈。折叠交互存在但不持久化（ProcessBlock useState(false)；Chat\|Board 不在 zustand partialize 白名单） | wire.ts:39-42; chat.ts:47-50; conversation-pane.tsx:308,1006-1011; use-writer-store.ts:210-214 |
| **Tool Calls 展示** | **只有摘要一行字**。live 运行时从不发 tool_call 事件；只读工具不写任何事件；写工具发 write 事件但 UI 只渲染 event.summary，不读 payload、无工具名结构、无 INPUT/OUTPUT。完整工具 feed 只存 AgentMessage，而**无任何 API 路由暴露 agentMessage**。事件快照上限 300 条，长 run 早期历史对 UI 静默不可见 | runtime.ts:2982-2984,202-220,342; conversation-pane.tsx:346-348 |
| **Sub-Agent Activity** | **真实但粗粒度**。Chat\|Board 切换 TaskBoard+ActivityStream，数据来自 SSE 全量快照 detail.tasks，实时。每行 key/title/detail/assignee 徽章/artifactLabel；in_progress 旋转图标可辨当前执行成员；atlas 徽章被隐藏（规划阶段无任务行）。无进度百分比，只有六态粗状态；TASK_STATUS_META 的 label/badgeClass 定义了却未渲染（状态无文字标签） | task-board.tsx:31-48,102,117,128-158 |
| **Execution Status** | Run 六态 `running\|awaiting_approval\|paused\|completed\|failed\|cancelled`，UI 标签一一对应无崩溃路径。**但 Planning/Thinking/Executing 全部塌缩为 "Running"+Working…**，无 queued/planning/executing 细分。Task 六态 `pending\|in_progress\|needs_approval\|blocked\|failed\|done` 图标颜色全覆盖 | schema.prisma:561-562,616-617; writer.ts:58-74; agent-types.ts:22-28,147-153 |
| **审批卡** | 显示 title/targetLabel/wordCount/summary，Approve/Reject 真实调用 POST approve。**无工具名、无参数、无正文预览/diff**——payload.content 含完整草稿但 ApprovalRequest 契约不含它。**hook 吞错**：approve/reject/cancel/setMode 失败只 console.error，面板的失败 toast 永远不会触发 | conversation-pane.tsx:455-468; agent-types.ts:229-239; use-agent-run.ts:93-131 |
| **Composer** | 图钉真实（buildPinOptions 来自 NovelDetail，随 POST 发送服务端解析）；模型选择器真实（注册表+创建时校验）；权限模式真实（POST /mode）；斜杠命令是目标文本模板（非假功能但无独立运行时路径）；**语音按钮是 disabled 占位**；额度/上下文面板三层数据全真实（SSE usage 事件+context-estimate+usage/ledger） | prompt-box.tsx:85-118,600-611; agent-client.ts:109,252-262; context-usage-panel.tsx:174,194 |

### 9.2 假数据/死代码清单

- Mock 横幅不可达（AGENT_BACKEND="live" 硬编码）；mockGateway 与 mock-agent.ts 整体死代码；MOCK_BUDGETS 仅被死 mock 引用。
- STARTER_PROMPTS 三条硬编码——有意设计，只填充输入框不提交，非假功能。
- 陈旧注释：agent-types.ts:5-8 仍称 "Phase 3 前跑 mock"。
- **其余对话组件全部消费 API/SSE 真实数据，无伪造数组**；FinalReportCard 数字来自 verified 侧。

### 9.3 Agent 对组件的知情

提示词明确告知四处：narration 供 live activity stream（output-contract.md:3-4）、reopen 理由展示给作者（sage.md:57,109）、工单 artifactType/artifactLabel 供看板绑定资产树（novel-orchestration.md:22-23）、run-report 供审计报告卡。**模型不知道思考展示与工具调用渲染（它们不存在），也不发结构化进度**——UI 其余部分是事件的被动读取器。

---

## 10. 缺陷汇总（按严重度）

### Critical（阻断核心能力）

| # | 缺陷 | 位置 |
|---|---|---|
| C1 | 本机无可用 AI 供应商：.env 空值覆盖 + 白名单 gemini 无凭据 + 线路模型退役 + Token Plan 额度耗尽（四层叠加，外部/配置问题） | .env; registry.ts SEEDS; 实测探针 |
| C2 | 供应商错误被适配器吞掉（200+base_resp → "empty response"），生产不可自助排障 | http.ts:75-80; minimax.ts |

### High

| # | 缺陷 | 位置 |
|---|---|---|
| H1 | 工具 DB 异常不对称：多数写工具/读工具的瞬时 DB 错误直接杀死任务或整个 run，不反馈模型重试 | runtime.ts:2926-2944,2170-2183 |
| H2 | 审批超时后状态不翻转：approve 迟到提交置 running 但无执行器接手 → 停滞 | runtime.ts:3750,719-720 |
| H3 | paused 半死锁：阻止新 run + resume 409，唯一出路 cancel | runtime.ts:722-723,435-441; resume route:59-63 |
| H4 | 备份缺伏笔/线索台账、packs、conceptSnapshot、canon 锁等 7 类数据——导出导入丢正典 | backup-schema.ts:93-128 |
| H5 | anthropic 线路系统消息丢失+相邻 user 不合并 → 400 风险 | wire.ts:39-42,104-118; anthropic.ts:26-29 |
| H6 | Cloud Run min-instances=0 + 无自动续跑：长运行（整本小说）随实例回收中断，靠手动 resume | cloudbuild.run.yaml; runtime.ts:790-825 |

### Medium

| # | 缺陷 | 位置 |
|---|---|---|
| M1 | export_markdown 计数不可从事件重建（违反自家审计规则） | runtime.ts:3397-3413 |
| M2 | tool_call 事件 live 不发射 + agentMessage 无 API 暴露 → 工具调用详情 UI 不可见 | runtime.ts; conversation-pane.tsx:346-348 |
| M3 | 思考过程展示缺失（推理内容在线路层即丢弃） | wire.ts:39-42; chat.ts:47-50 |
| M4 | 技能 8000 字符上限 break 静默丢弃后续全部技能 | content.ts:337-370 |
| M5 | settle_chapter 文案三处两口径 + CERTIFY PROTOCOL 仍强制 settle | task-decomposition.md:9-13; runtime.ts:2575-2578 |
| M6 | completed 可携带 failed 任务，run 评级不反映部分失败 | runtime.ts:2407-2408 |
| M7 | JSON 列无校验解析（finalReport/payload/SSE 裸断言） | runtime.ts:226-233; agent-client.ts:194 |
| M8 | 审批 hook 吞错，失败 toast 永不触发 | use-agent-run.ts:93-131 |
| M9 | 压缩机制 shipped disabled，长 run 无硬 token 熔断 | budgets.yaml:84 |
| M10 | Todo 工具与用户待办能力不存在（需产品决策） | tool-protocol.ts |

### Low

T3 index 参数忽略、T4 finish 注释矛盾、S3 appliesTo 无消费、S4 certify 正则不对称、Y1 头注释过期、Y2 finalizedAt/pack.status 缺失、Y3 revised 未归一化、Y5 loopFacts 接口过期、Y8 截断无标记、Y9 审批匹配可能误配、状态文字标签未渲染、语音按钮占位、verify-p5-f 脚本过期（2 处断言+需 dev server）。

---

## 11. 实测证据清单

| 检查 | 结果 |
|---|---|
| npx tsc --noEmit | ✅ PASS |
| bun run check:credits | ✅ PASS（37/37 wired，0 unwired） |
| bun run db:check:ownership | ✅ PASS（41 模型各一条规则） |
| bun scripts/check-doc-tree.ts | ✅ PASS（36 节点/19 渲染器） |
| bun scripts/verify-stage-a.ts | ✅ 18/18（租约/围栏/转录） |
| bun scripts/verify-p5-e1.ts | ✅ 18/18（守护失败翻转，零积分消耗） |
| bun scripts/verify-p5-f.ts | ⚠️ 2 FAIL（脚本过期+隔离缺陷）+ 末段需 dev server（ECONNREFUSED） |
| 真实无头运行（minimax:fast, full_access） | ✅ 失败路径闭环：failed 终态+error 事件+租约释放+积分无损（60→60） |
| 供应商直连探针 ×5 | 定位四层根因（§8.2）；当前可用模型列表已获取 |
| 成功写作路径 | 🔴 阻塞：外部凭据/额度，未验证（不做无证据断言） |

**测试遗留物**（保留作证据，未触碰既有数据）：测试小说《AUDIT-闭环测试-灯塔守望》+ 1 个 failed run + 积分流水，uid `audit-live-20261118`；脚本与证据在 `tmp/audit-*`。

## 12. 修复优先级建议

1. **C1/C2（先决）**：修正 .env 空值；更新注册表线路名为供应商当前模型（env 覆盖即可）；适配器检查 base_resp 抛出真实错误；充值或换供应商后**重跑本报告 §8 的写作实测**（脚本已就绪：`bun tmp/audit-live-write.ts`）。
2. **H1**：executeTool 统一 try/catch 转错误 feed（对齐 review/settle/export 的既有模式）。
3. **H2/H3**：审批超时翻转状态为可恢复终态；paused 允许 resume 或明确 cancel 引导。
4. **H4**：备份 schema 补 7 类数据（additive）。
5. **M2/M3**：live 发射 tool_call 事件（含输入输出摘要）+ 暴露 agentMessage 只读路由 + 捕获推理内容——这三项是 Chat UI 从"被动摘要"升级为"真实执行可视化"的关键。
6. **M4/M5**：技能截断改为按优先级保留+显式告警；统一 settle 文案。
7. 其余 Medium/Low 按迭代排入；verify-p5-f 脚本更新价格表引用并隔离夹具数据。

---

## 13. 修复记录：H2/H3 审批死锁（2026-11-18，已修复并验证）

按测试先行流程执行：先写验证脚本看它失败（红灯 6 项 FAIL，如实复现僵尸态），再改代码使其通过（绿灯 19/19）。

### 13.1 改动清单

| 文件 | 改动 |
|---|---|
| `src/lib/agent/runtime.ts` | ① `pauseForApproval` 超时退出不再静默：任务→blocked、运行→paused、发出可见的超时说明事件（H2 根治——迟到的 approve 因状态已非 awaiting_approval 而被既有守卫拒绝，不会再翻成无执行器的假 running）；② 新增导出函数 `resumePausedRun`：校验 paused 状态 + 无活租约 + 无悬空审批门后认领租约、翻回 running、发恢复事件（H3）；③ `pauseForApproval` 改为导出以便验证脚本驱动真实生产路径 |
| `src/app/api/agent/runs/[id]/resume/route.ts` | paused 分支从一律 409 改为调用 `resumePausedRun`，成功后台续跑（202）；头部注释同步更新 |
| `src/lib/novara/agent-client.ts` | 网关接口与 live/mock 两个适配器新增 `resume` 方法 |
| `src/lib/novara/mock-agent.ts` | mock 运行时补 `resume`（保持接口契约完整） |
| `src/hooks/use-agent-run.ts` | 新增 `resume` 动作：恢复后重新订阅 SSE 实时流 |
| `src/components/novara/writer/conversation-pane.tsx` | 暂停运行提示区新增 **Resume run** 按钮（与 Discard 并列），失败有可见 toast |
| `scripts/verify-gate-recovery.ts` | 新增验证脚本（19 项检查，零模型调用，夹具自建自清理，budgets.yaml 字节级还原） |
| `package.json` | 新增命令 `bun run verify:gate` |
| `tsconfig.json` / `eslint.config.mjs` | 把 `tmp/`（审计临时脚本目录）排除出类型与规范检查范围 |

### 13.2 验证结果【实测】

- `bun run verify:gate`：**19/19 PASS**。覆盖：超时翻转 paused+blocked+可见事件、超时后零提交、迟到 approve 被拒且不翻状态、超时 paused 可恢复、作者拒绝→paused 零写入、拒绝后可恢复且翻回 running、活租约下恢复被拒（防双执行器）、零积分消耗、夹具清理还原。
- 红灯证据：修复前同一脚本 6 项 FAIL（run 停留 awaiting_approval、任务停留 needs_approval、无超时事件、迟到 approve 成功提交并把 run 翻成假 running）——缺陷真实复现后才动手。
- 回归：`verify-stage-a` 18/18 PASS、`verify-p5-e1` 18/18 PASS（租约围栏与守护翻转未被破坏）；`npx tsc --noEmit` PASS；`bun run lint` PASS；`check:credits` 37/37；`db:check:ownership` 41 模型全规则；`check-doc-tree` PASS。

### 13.3 行为变化（用户可见）

- 审批等满 30 分钟：运行不再"假死在等待审批"，而是明确显示 **Paused** + 一条"审批超时，未写入任何内容"的消息；作者可点 **Resume run** 重新开门，或 Discard。
- 作者拒绝写入后：运行显示 Paused，新增 **Resume run** 按钮可从检查点继续（此前只能取消）。
- 安全不变量保持：活租约存在时恢复被拒（不会双执行器）；悬空审批门未解决时恢复被拒；迟到批准绝不在无执行器时提交。

### 13.4 未改动项（如实记录）

- H1（工具 DB 异常不对称）、H4（备份缺数据）、H5（anthropic 线路）、H6（Cloud Run 缩容，用户接受测试阶段现状）及其余 Medium/Low 项**本次未动**，仍按 §12 优先级待办。
- C2（适配器吞供应商错误）未修——它属于供应商适配层，与本次审批修复无关，避免混改。

---

*报告完。审计阶段未修改生产代码；§13 修复为用户明确授权后的改动，全部经测试先行流程验证。所有数据库新增均为披露的测试夹具。*
