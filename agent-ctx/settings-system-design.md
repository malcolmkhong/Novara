# Novara Settings 与 Provider 架构设计 v2

> 状态：**DRAFT v2 — 范围已按用户裁决重构，等待凭据输入**（§10）
> 范围：架构方案 + UI 排版建议。**本文档不含实现，未改动任何代码。**
> 日期：2026-11-06 · 依据 `A:\Novara` HEAD(`34f1040`) 只读调研
> 取代：v1（BYO 多 Provider + 订阅 + 10 家清单）

---

## 0. v1 → v2 范围变更（用户裁决记录）

| 项 | v1 方案 | v2 裁决 | 影响 |
|---|---|---|---|
| 凭据归属 | 用户自带 key（BYO），每用户凭据保险库 | **Novara 平台直接提供所有模型**，用户不需连接自己的订阅或 API key | 删除用户级凭据库；改为平台级服务端配置 |
| Provider 清单 | 10 家（含 Gemini / OpenRouter / OpenCode Free·Go·Zen / Custom） | **4 家**：DeepSeek · MiniMax · ChatGPT(OpenAI) · Anthropic(Claude) | 适配器与 UI 大幅收窄 |
| GLM | 内置主力，零迁移保留 | **仅作测试用途**，从生产模型清单移除 | 生产路径必须换掉 Z.AI SDK 依赖 |
| 订阅系统 | 三选项待决 | **不做**（用户明确"我搞错了"） | 删除订阅页与支付相关设计 |
| 登录 | 待决（单用户/多用户/永久单用户） | **保留现状 guest session**，Google OAuth 暂不加 | 无 auth 工程；Settings 仍是应用实例级 |
| 当前重点 | Settings 系统 | **完善 Novel Generation 能力 + 全面测试验证** | 工作顺序重排（§9）：Provider 层与生成链路优先，Settings UI 靠后 |

**保留不变**（v1 中依然有效的部分）：三层解耦思路、路由矩阵、Novel 专属七类设置、Policy F 账本语义、既有约束（法则⑦⑧⑨⑩）、harness 验证范式。

---

## 1. 现状事实（调研证据）

### 1.1 单用户单机，无账号体系
- `next-auth` 在 `package.json:63` 声明但**全项目零 import、零 `/api/auth` 路由**
- `prisma/schema.prisma:16-17` 原文："Reserved for the future authentication system (NextAuth-ready). The current preview build uses a guest session and does not create users."
- `User` 模型存在但从未写入；无 `Account`/`Session`/`Subscription`
- guest session = `localStorage` 一个时间戳（`src/lib/novara/session.ts:5-37`，key `novara.guestSession`，仅存 `{enteredAt}`）——**不是身份**
- 所有 Novel 平铺同一 SQLite，无 userId、无租户字段

→ 裁决「保留现状」意味着 **Settings 是应用实例级配置中心**，所有配置不带 userId。

### 1.2 代码里没有任何 API Key 概念
- 凭据由 SDK 自读 `.z-ai-config`（项目根 / 家目录 / `/etc`），见 `node_modules/z-ai-web-dev-sdk/dist/index.js:7-27`
- 全项目 `process.env.` 仅两处：`instrumentation.ts:13`(NEXT_RUNTIME)、`lib/db.ts:13`(NODE_ENV)——**零处读 key**
- `ZAI.create()` 零参调用（`src/lib/novara/glm.ts:133`）

→ **本机 `A:\Novara` 没有 `.z-ai-config`，因此当前任何 AI 调用都无法工作。**这是 §10 的硬阻塞。

### 1.3 唯一路由法则
AGENTS.md 法则⑨：唯一页面路由 `src/app/page.tsx`，其余靠 hash（`src/hooks/use-hash-route.ts:1-67`，7 个视图，无 router 库）。
→ Settings 必须是第 8 个 hash 视图 `#/settings`。

### 1.4 现有模型与调用面
- 注册表 `src/lib/novara/models.ts:73-124`：4 个 GLM（`glm-4.6` 200K / `glm-4.5-air` 128K / `glm-4-flash` 128K / `glm-4-long` 1M），字段含 `thinkingLevels`/`defaultThinkingLevel`/`toSdkParams`，默认 `glm-4.6`
- **9 个调用点 / 10 个 surface**：agent(runtime.ts:1796,2490) · studio(novel/glm.ts ×5) · sediment(sediment.ts:215) · review(ai-json.ts:35) · wizard(wizard/route.ts:153) · draft(draft/route.ts:247) · detect ×2 · generate(generate/route.ts:132) · ai-team(server.ts:148)
- 流式：`src/lib/novel/glm.ts:219 streamGlmProse()`，`:252 stream:true`，**手动解析 SSE byte fragments**
- 定价：`src/lib/usage/pricing.ts:66-81` 仅 2 行 GLM，版本 `2026-11-06.1`
- 预算：`agent/config/budgets.yaml` 9 section（含名为 `glm` 的 section）+ zod schema（`content.ts:50-121`）+ DEFAULT_BUDGETS（`:125-180`）

### 1.5 可复用资产
Policy F 账本（`UsageCall`/`UsageDaily`/`UsageProvenance`/`UsageInvoice`）· 10 surface 埋点 · 六节计量（`context-meter.ts`）· 预算配置 + zod 校验 · 11 套零 GLM harness · 现成 UI 控件（ModelPicker / ModeSwitch / ContextUsagePanel / UsageBalanceBadge / ImportExport）· 90 天保留 + 31 天展示 + CSV 导出（P5-f）· 发票对账粘贴位（P5-c）

---

## 2. v2 架构：平台级 Provider 层

关键差别：**凭据属于平台，不属于用户**。因此没有用户级凭据库 UI，只有服务端配置 + 面向用户的模型目录与路由。

```
┌────────────────────────────────────────────────────────────┐
│ UI 层  #/settings（hash 视图）                                │
│   Models 页：模型目录 · 默认模型 · 路由矩阵 · 定价 · 诊断       │
│   （无 key 输入框 —— 平台托管）                               │
└────────────────────┬───────────────────────────────────────┘
                     │ REST（法则⑩）
┌────────────────────▼───────────────────────────────────────┐
│ Layer 3  Routing Policy                                     │
│   Run 显式 > Novel 覆写 > Surface/Role 默认 > 全局默认         │
│   + Fallback 链 + 预算护栏（超额暂停，不静默降级）              │
├─────────────────────────────────────────────────────────────┤
│ Layer 2  Provider Adapter（4 家 + GLM 测试通道）              │
│   统一 ChatProvider 接口；协议族：                             │
│     · OpenAI-compat → DeepSeek / MiniMax / OpenAI           │
│     · Anthropic Messages → Claude                           │
│     · Z.AI（既有，仅测试）→ GLM                              │
├─────────────────────────────────────────────────────────────┤
│ Layer 1  Platform Credential Config（服务端，非用户级）        │
│   .env / 受保护配置文件；进程内解密；永不进日志、永不出服务端     │
└────────────────────┬───────────────────────────────────────┘
                     │
     既有：Policy F 账本 · 六节计量 · harness 家族（语义必须保留）
```

### 2.1 Layer 1 — 平台凭据（简化后）

- 存放：`.env`（gitignored，已在 `.gitignore` 中）+ 可选的受保护配置文件
- 键名建议：`DEEPSEEK_API_KEY` / `MINIMAX_API_KEY` / `MINIMAX_GROUP_ID` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `ZAI_CONFIG_PATH`（测试通道）
- 规则（沿用既有安全纪律）：
  1. 密钥只在服务端内存短暂存在，用完即弃（法则⑧ SDK/密钥仅后端）
  2. **日志零密钥**：错误只记脱敏摘要（`lastError` 模式已在 Policy F 中实践）
  3. API 响应永不返回密钥；Settings 页只显示「已配置 / 未配置 + 掩码指纹」
  4. 无 per-user 加密库、无导出备份需求（平台级配置由运维持有）
- **未配置某 provider 的行为**：该 provider 的模型在目录中标 `unavailable`，路由自动跳过并落到 fallback 链；不报错崩溃

### 2.2 Layer 2 — 4 家 Provider 的协议差异（实现要点）

| Provider | 协议 | 认证 | usage 字段 | 流式格式 | 思考/推理档 |
|---|---|---|---|---|---|
| **DeepSeek** | OpenAI-compat | `Authorization: Bearer` | `prompt_tokens`/`completion_tokens`/`total_tokens` | OpenAI SSE（`choices[].delta`） | `deepseek-reasoner` 为独立模型（非参数） |
| **MiniMax** | OpenAI-compat | Bearer **+ GroupId**（易漏） | 同上 | OpenAI SSE | 视模型而定 |
| **OpenAI** | OpenAI | Bearer | 同上（可能含 `prompt_tokens_details.cached_tokens`） | OpenAI SSE | reasoning effort 参数 |
| **Anthropic Claude** | **Anthropic Messages（不同族）** | `x-api-key` + **`anthropic-version` 头必填** | **`input_tokens`/`output_tokens`（字段名不同！）** | **事件式 SSE：`message_start`/`content_block_delta`/`message_delta`（与 OpenAI 形状完全不同）** | extended thinking 参数 |
| GLM（测试） | 既有 Z.AI SDK | `.z-ai-config` | 3 字段 | 既有 `streamGlmProse` | `thinkingLevels` |

**四个必须处理的差异点**：
1. **usage 字段名不统一** → 适配层归一化为 `{promptTokens, completionTokens, totalTokens}`，Anthropic 单独映射。Policy F 语义逐字保留（每 attempt 一行；无 usage → 不落行）
2. **Anthropic 流式形状不同** → `streamGlmProse`（`novel/glm.ts:219`）的手动 SSE 解析必须抽象为 per-protocol 的 chunk 解析器，否则 studio 写作在 Claude 上直接坏
3. **思考档位语义不同** → 注册表的 `thinkingLevels`/`toSdkParams` 需泛化为 provider-specific 参数映射
4. **上下文窗口差异巨大**（Claude 200K / GPT-5 系更大 / DeepSeek 64–128K / MiniMax 200K+）→ 影响 §8 的阈值重校准

**具体模型名与价格不在本文档硬编码**：实现时抓取各家官方文档并标注日期，沿用 `pricing.ts` 的版本化做法（`2026-11-06.1` 模式）。

### 2.3 Layer 3 — 路由矩阵（Novara 专属核心，保留 v1 设计）

10 个 surface 需求彼此冲突，单一"默认模型"不够用：

| surface / role | 需求 | 建议档位 |
|---|---|---|
| agent · Atlas（领队） | 长上下文 + 强规划 + 文本协议遵从 | 旗舰 |
| agent · Sage（写正文） | **流式** + 文学性 + 长输出 + 协议遵从 | 旗舰/中档 |
| agent · Prism（审读） | 结构化 JSON + 批判性 | 中档 |
| agent · Nova（研究） | 只读检索，量大 | 轻量 |
| agent · Forge（库卫生） | 简单操作 | 轻量 |
| studio | 流式长文 | 中档+ |
| sediment | 严格 JSON 抽取，高频 | 轻量 |
| review | JSON | 轻量 |
| detect ×2 | 分类判断，**最高频** | 最便宜 |
| wizard | 多步生成 | 中档 |
| draft | 行内续写，低延迟 | 轻量 |
| ai-team | 多轮对话（`HISTORY_WINDOW=12`，server.ts:58） | 轻量/中档 |

优先级：`Run 显式（现有 ModelPicker）> Novel 覆写 > Surface/Role 默认 > 全局默认 > 内置回退`

数据模型（additive，遵守法则⑦禁 JSON 列）：
```
ModelRoute(id, scope[global|surface|role|novel], scopeKey, providerKey,
           modelId, paramsProfile, priority, enabled, timestamps)
  @@unique([scope, scopeKey, priority])
ProviderModel(id, providerKey, modelId, label, contextWindow, maxOutputTokens,
              inputPricePer1M, outputPricePer1M, capabilities, isAvailable,
              source, fetchedAt)   @@unique([providerKey, modelId])
```

Fallback：同 scope 按 priority 排序，主模型 429/5xx/超时自动降级；全链失败才报错。
护栏：超额**暂停并明确告知**，**不静默降级到弱模型**（法则⑤诚实规则）。

### 2.4 ⚠ 必须补的账本字段

`UsageCall.modelId` 现在存裸 id。多 Provider 后同一 modelId 可能来自不同家，**账本无法归因、定价会算错**。
→ 新增 `UsageCall.providerKey String?` + `UsageDaily.providerKey String?`（nullable；历史行 null = GLM 测试通道）。additive，不破坏既有数据。

---

## 3. Settings 页面 IA（v2）

### 3.1 骨架
- 入口：顶栏 `UsageBalanceBadge`（`components/novara/writer/usage-balance-badge.tsx`）旁齿轮图标；书库页与 workspace 均可见（P5-b anchor census 已证该位置在所有产生消耗的界面存在）
- 路由：`#/settings`（第 8 个 hash 视图）
- 布局：左导航 240px（分组 + lucide 图标）+ 右内容区 ≤960px 居中
- 移动端：左导航折叠为顶部横向 tab（已装 `embla-carousel-react`）或用 shadcn `Sheet` 抽屉
- 技术：Tailwind 4 + shadcn/ui (New York) + next-themes + zustand（既有范式）+ `@tanstack/react-query`（已装，管目录同步等异步态）

### 3.2 导航结构

```
#/settings
├─ AI 模型 Models                       ← 独立页（需求明确要求）
│   ├─ 模型目录        4 家 × 各家模型：能力标签 · 上下文 · 价格 · 可用状态
│   ├─ 默认与路由      ★surface × role 矩阵 + Fallback 链（§2.3）
│   ├─ Provider 状态   各家「已配置/未配置」· 掩码指纹 · 连通性 · 限额
│   ├─ 定价与计价      pricing 可视化 · UNPRICED 显式标注 · 可覆写单价
│   └─ 诊断            批量连通测试 · 协议自检 · 探测日志（走 Policy F 记账）
│
├─ 用量与账单 Usage
│   ├─ 总览            31 天明细 + 90 天汇总（P5-f 已实现，直接复用）
│   ├─ 多维分析        按小说 / surface / 模型 / Provider 分组
│   ├─ 预算与告警      日/月软上限 · 超额行为 · 阈值
│   ├─ 账单对账        UsageInvoice 粘贴位（P5-c 已实现）
│   └─ 导出            CSV（P5-f 已实现 /api/usage/statement）
│
├─ 创作 Writing                         ★Novara 专属
│   ├─ 全局默认        写作语言 · 叙事人称 · 章节目标字数 · 文风基线
│   ├─ 定稿与写闸      默认模式(approval/full_access) · write gate · E2 阈值 · reopen 规则
│   ├─ QC 与审读       blocking 阈值 · 修复轮上限(≤2) · doctor 体检项
│   └─ 导出            Markdown/Obsidian · 备份 v2 · 完整性校验
│
├─ Agent 团队 Team                      ★Novara 专属
│   ├─ 角色配置        五角色启用开关 + 各自模型指派
│   ├─ 角色卡覆写      用户级 override（不改仓库 agent/system/*.md）
│   ├─ 技能管理        agent/skills/ 10 个技能开关 + 字符帽(8000)
│   ├─ 预算帽          leaderMaxTurns(22) · planMaxTasks(44) · 每轮动作(3) · brief(1800) · pinned(6000)
│   └─ 协作模式        影响评估开关 · 审批门策略 · 委派规则
│
├─ 记忆与上下文 Memory                   ★Novara 专属
│   ├─ 长期记忆        9 类沉淀开关 · topK(14) · 字符预算(2600) · digest 窗口
│   ├─ 上下文压缩      enabled · triggerTokens(6000) · tailTurns(8) · minCompactableRows(12) · slack(256)
│   ├─ 快照切片        enabled · 切片映射可视化 · 强制包含守卫
│   └─ 数据保留        90/31 天可视化 + 手动清理
│
├─ 外观 Appearance     主题(light/dark/system) · 密度字号 · 界面语言(next-intl 已装)
├─ 系统 System         运行环境 · 数据与备份 · 11 套 harness 自检 · budgets.yaml 只读+受控覆写
└─ 关于 About          版本 · 更新日志 · 法务(既有 terms/privacy) · 反馈
```

**已删除**（相对 v1）：账户/会话设备/隐私（无 auth）、订阅整组、Provider 详情页的凭据输入段。

### 3.3 Models 页排版（v2：无凭据输入）

```
┌──────────────────────────────────────────────────────────────┐
│ AI 模型                                    [同步目录] [诊断]    │
│ 平台已接入 4 家 · 37 个模型可用 · 本月 $12.40                    │
├──────────────────────────────────────────────────────────────┤
│ ▸ DeepSeek        ● 已配置   3 个模型   $0.27–2.20 /1M         │
│ ▸ MiniMax         ● 已配置   4 个模型   …                      │
│ ▸ OpenAI          ○ 未配置   —        [需要运维配置密钥]        │
│ ▸ Anthropic       ● 已配置   6 个模型   …                      │
│ ▸ GLM（测试通道）  ● 已配置   4 个模型   仅用于验证，不建议生产    │
├──────────────────────────────────────────────────────────────┤
│ 全局默认模型   [claude-sonnet ▼]     思考档 [medium ▼]          │
│ 路由覆写       12 条规则            [编辑路由矩阵 →]            │
└──────────────────────────────────────────────────────────────┘
```

模型目录表列：模型 · 上下文 · 最大输出 · 输入/输出价 · 能力标签（streaming / tool-text-protocol / vision / thinking / json）· 可用开关。

---

## 4. Novel 专属设置（保留 v1 分析，七类）

1. **模型路由矩阵**（§2.3）—— 10 surface × 5 角色需求冲突，通用 AI 应用无此维度
2. **上下文经济学** —— 压缩/切片参数目前只在 `budgets.yaml`，只有开发者能改；应可视化可调，并显示"改这个会影响什么" + 一键恢复推荐值
3. **长期记忆策略** —— 9 类沉淀事实（world_rule/character_state/relationship/story_fact/open_loop/decision/style/dialogue/inspiration）按类开关 + 检索预算 + 条目手工修正
4. **Agent 团队编排** —— 角色启停、逐角色指派模型、角色卡用户级覆写、预算帽、技能开关
5. **写闸与定稿政策** —— 法则①②③④代码强制不可关，但阈值与默认行为可调
6. **每本小说级覆写** —— ⚠ 发现 `Novel`（`schema.prisma:30-67`）字段为 title/genre/synopsis/targetWords/status/conceptSnapshot，**没有 language 字段**（Phase 1 就注意到的缺口），也无人称/章节字数/文风基线 → 需新增 `NovelSetting`（一行一键，禁 JSON 列）。与既有 `NovelContract`（`:354-365`）分工：**Contract = 给 AI 看的创作约束；Setting = 给系统看的行为参数**
7. **按小说预算护栏** —— `UsageCall.novelId` 已存在，可按书设预算，超额只暂停该书的新 run

---

## 5. 数据模型汇总（全部 additive）

| 新增 | 用途 |
|---|---|
| `ProviderModel` | 模型目录（能力/价格/窗口/可用态） |
| `ModelRoute` | 路由规则（scope: global/surface/role/novel） |
| `UserPreference` | 应用实例级偏好，一行一键 |
| `NovelSetting` | 每本小说覆写，一行一键 |

| 扩展既有 | 变更 |
|---|---|
| `UsageCall` | **+ `providerKey String?`**（§2.4 必需） |
| `UsageDaily` | + `providerKey String?` |
| `Novel` | + `language String?`（Phase 1 遗留缺口） |

**已删除**（相对 v1）：`ProviderCredential`（无用户级凭据）、`ProviderQuota`（平台级限额改为配置/探测缓存，不必建表）、`Subscription`/`ExternalPlan`。

向后兼容：全部 nullable/有默认；历史行 `providerKey=null` = GLM 测试通道；`.z-ai-config` 路径保留 → **零迁移**。

---

## 6. 既有约束遵守

| 约束 | 应对 |
|---|---|
| 法则⑦ 禁 JSON 列 | 规范化表 / key-value 行；capabilities 用逗号分隔字符串 |
| 法则⑧ SDK 仅后端 | 凭据与请求构造全在服务端；前端只见状态与掩码 |
| 法则⑨ 唯一路由 | `#/settings` hash 视图，不新增 Next 路由 |
| 法则⑩ 全走 API | 不用 server action |
| 法则⑤ 诚实规则 | 估算/实测分开；未定价显式 UNPRICED；超额暂停而非静默降级 |
| Policy F | 9 个调用点改造后语义逐字保留（每 attempt 一行；无 usage 不落行） |
| 六节计量 | provider 切换不影响分节；新增 provider 维度归因 |
| 11 套 harness | 每次改造后全绿；新增第 12 套验证 provider 适配层 |

---

## 7. ⚠ 换 Provider 的两个连带后果（必须重做，不能沿用）

### 7.1 Tokenizer 校准全部失效
Phase 2/5 实测的 **CJK 估算低计 ~1.4×** 是「cl100k 估算 vs GLM 计费」的比值（`context-meter.ts:41-46` 用 cl100k + CJK×0.7）。DeepSeek / OpenAI / Anthropic / MiniMax **各家 tokenizer 不同**，中文占比高的正文下偏差方向与幅度都不一样。

→ 必须对每个 provider 重新实测「本地估算 vs provider 计费」比值，并把 `countTokens` 改为 provider-aware（或保留 cl100k 估算 + 每 provider 一个校正系数）。**在重测前，任何基于 token 数的阈值都不可信。**

### 7.2 上下文阈值需按模型相对化
`contextCompaction.triggerTokens=6000`、切片阈值、P5-e 的 enablement pack 都是按 GLM 窗口（128K–1M）与 GLM 计费校准的。Claude 200K / DeepSeek 64K 差 3 倍以上，**绝对 token 阈值会在小窗口模型上太晚触发、在大窗口模型上过早触发**。

→ 建议阈值改为「占模型上下文窗口的百分比」或 per-model 覆写，而非全局绝对值。

### 7.3 文本协议遵从度必须逐 provider 验证 ★最高风险
Novara 的 Agent 循环**不用原生 function calling**，而是自定义文本协议（```novel-tool``` 动作块 + ```novel-write``` 正文块，见 `novel-tools.ts:52` 注释与 `parseAgentTurn`）。

已有证据（OPS-1，风险登记册）：glm-4-flash 连续 5 次发出 `create_chapter` 却**不带配对的 ```novel-write``` 正文块**，并在对话里**口头谎称"章节已创建"**（实际 chapters=0）。

→ 换 provider 后，**每家模型对这套文本协议的遵从度都未知**，而整个写作链路（写正文、建章、审读、沉淀）都依赖它。这必须是验证计划的第一优先项，而不是最后补测。好消息：不依赖原生 tool_use，反而降低了协议适配成本。

---

## 8. 测试成本变化（重要）

前五个 Phase 的验证纪律是「$0.00 billable，全走 glm-4-flash 免费档」。移除 GLM 后：

- 4 家目标 provider **均无免费档**（DeepSeek 最便宜约 $0.27/1M 输入，但不是 0）
- 大规模 live-fire 验证将产生真实费用

→ 建议：**GLM 测试通道保留**（用户裁决"GLM 仅用于测试"正好对应此需求），零 GLM harness 仍是主力（11 套全部 zero-GLM），live-fire 用 GLM 免费档做协议/流程验证，**只在需要验证 provider 特定行为时**才用付费 provider 打最小样本。需要为付费验证设一个明确预算上限。

⚠ 但本机当前连 `.z-ai-config` 都没有 → **测试通道也是断的**（§10）。

---

## 9. 建议工作顺序（对齐"Novel Generation + 全面验证"重点）

| 步骤 | 内容 | 产出 | 依赖 |
|---|---|---|---|
| **S0** | 拿到 provider 凭据（§10） | 能发出第一次真实调用 | **你提供** |
| **S1** | Provider 适配层（OpenAI-compat 族先行：DeepSeek/MiniMax/OpenAI）+ 平台凭据配置 + 注册表换血 + `UsageCall.providerKey` | 3 家可跑；Policy F 保住 | S0 |
| **S2** | Anthropic 适配（含流式事件式 SSE 与 usage 字段映射） | 4 家齐 | S1 |
| **S3** | **文本协议遵从度验证**（每家 × novel-tool/novel-write，最小样本） | 各家协议合格率表；决定路由默认档位 | S1/S2 |
| **S4** | **Novel Generation 端到端验证**：向导 → run → 派单 → 写正文 → 审读 → 定稿 → 沉淀 → 记忆检索 | 全链路通过/缺陷清单 | S3 |
| **S5** | Tokenizer 与阈值重校准（§7.1/7.2） | 每 provider 校正系数；阈值改相对化 | S4 |
| **S6** | Settings UI：Models 页（目录 + 路由矩阵 + 诊断） | 用户可见可调 | S1–S3 |
| **S7** | Settings UI：创作 / Agent 团队 / 记忆上下文 / 用量 / 外观 / 系统 | 完整设置系统 | S6 |

理由：S3/S4 直接服务你说的重点（生成能力 + 验证）；Settings UI 放后面，因为它只是把已存在的参数暴露出来，参数本身得先在新 provider 上校准过（S5），否则 UI 上给用户的是错数字。

---

## 10. 待你提供 / 待决策

### 阻塞项（必须先解决）
**B1 — Provider 凭据**：4 家里你现在有哪几家的 API key？（MiniMax 还需要 GroupId）
**B2 — 测试通道**：GLM 的 `.z-ai-config`（baseUrl + apiKey）你还能拿到吗？拿不到的话，live-fire 验证就得用付费 provider，需要一个预算上限。

### 待确认（不阻塞 S1）
- **C1 平台密钥存放**：建议 `.env`（gitignored，项目已有此约定）。若要支持运行时在 UI 改密钥，则需落库加密——但那又回到"用户级凭据库"的复杂度，与"平台直接提供模型"的定位不符。**建议 .env，UI 只显示状态。**
- **C2 模型清单来源**：各家具体模型名与价格，实现时抓官方文档并标日期（沿用 pricing 版本化）。若你有指定的模型清单，给我。
- **C3 付费验证预算上限**：S3/S4 需要真实调用，给一个美元上限（建议 $5–10 足够跑完全链路多轮）。

---

## 11. 风险登记

| # | 风险 | 影响 | 应对 |
|---|---|---|---|
| 1 | **文本协议遵从度未知**（§7.3） | 写作链路可能在某家 provider 上静默产出假成功 | S3 优先验证；路由默认只指派已验证合格的模型；沿用诚实核验（代码层数 DB，不信模型自报） |
| 2 | Anthropic 流式形状不同 | studio 写作在 Claude 上直接坏 | 适配层 per-protocol chunk 解析器；S2 单独验证流式 |
| 3 | usage 字段名不一致 | 账本记错 token | 归一化 + harness 断言（已有 Policy F 基础） |
| 4 | Tokenizer 差异（§7.1） | 阈值失效、成本估算失真 | S5 重校准；估算标 ESTIMATE |
| 5 | 上下文窗口差异（§7.2） | 压缩/切片触发时机错 | 阈值相对化或 per-model 覆写 |
| 6 | 无免费档（§8） | 验证产生真实费用 | 保留 GLM 测试通道 + zero-GLM harness 为主 + 预算上限 |
| 7 | MiniMax 需 GroupId | 配错则全线 401 | 配置校验 + 诊断页明确提示 |
| 8 | 移除 GLM 影响既有 harness | 回归失败 | GLM 保留为测试 provider；harness 全部 zero-GLM 不受影响 |
| 9 | 用户误调上下文参数 | 正文质量下降却不知原因 | 每参数显示影响说明 + 一键恢复推荐值 |

---

## 12. 本文档未覆盖

具体 DDL / API Schema / 组件代码（待 §10 决策后出 PRD）· 各家实时模型清单与价格（实现时抓取并标日期）· 多用户与订阅（已裁决不做/暂缓）。
