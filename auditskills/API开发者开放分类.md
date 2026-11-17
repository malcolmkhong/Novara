# Novara API 开发者开放分类清单

- 记录日期：2026-11-17
- 统计口径：按 `src/app/api/**` 中实际导出的 HTTP 方法逐一计数（非按文件数）。
- 总量：**46 个路由文件，63 个 API 端点**。
- 分类结论：**适合开放 44 个 · 谨慎开放 12 个 · 不建议开放 7 个**。
- 口径修正说明：对话初版按 61 个端点统计有误——分卷（volumes）实为 4 个端点、发票（invoice）实为 2 个端点，本清单以精确计数 63 为准。

> 「适合开放」指功能与契约层面已就绪。实际对外开放前，必须先补齐：
> 机器鉴权（API key 签发/吊销 + scope）、`/api/v1` 版本化、OpenAPI 开发者文档、
> 请求级限流、CORS 策略。当前全部 API 仅接受 Firebase 用户 ID token，
> 外部系统今天尚无法以机器凭据合法调用（唯一公开端点是 `GET /api/health`）。

---

## 第一档：适合给 Developer 用（44 个）

### ① 小说管理（5 个）— 项目的创建与读取

| API | 功能 |
|---|---|
| `GET /api/novels` | 列出当前用户的全部小说 |
| `POST /api/novels` | 创建小说（含创作合同契约） |
| `GET /api/novels/[id]` | 读取小说全量快照（含章节正文、设定、大纲） |
| `PATCH /api/novels/[id]` | 更新小说元信息与合同 |
| `DELETE /api/novels/[id]` | 删除小说 |

### ② 章节写作（4 个）— 正文的增改删与历史

| API | 功能 |
|---|---|
| `POST /api/novels/[id]/chapters` | 新建章节 |
| `PATCH /api/chapters/[id]` | 修改章节正文/标题（覆写已有正文需显式 `overwrite:true`） |
| `DELETE /api/chapters/[id]` | 删除章节（定稿章节会被 409 拒绝） |
| `GET /api/chapters/[id]/versions` | 查看章节历史版本（最多 30 份快照） |

注：单项 `GET /api/chapters/[id]` 目前不存在（README 第 258 行与代码不符），
章节正文需经 `GET /api/novels/[id]` 内嵌返回；对外开放前建议补齐子资源单项 GET。

### ③ Agent 自动化运行（10 个）— 最核心的对外能力，可无头驱动 AI 团队写小说

| API | 功能 |
|---|---|
| `POST /api/agent/runs` | 启动一次 AI 团队任务（目标 3–2000 字，审批/全自动两种模式） |
| `GET /api/agent/runs` | 查询任务列表（按小说过滤，limit 1–50） |
| `GET /api/agent/runs/[id]` | 查询任务详情与最终报告 |
| `GET /api/agent/runs/[id]/events` | SSE 实时事件流（进度、工具调用、产出） |
| `POST /api/agent/runs/[id]/approve` | 审批/驳回 AI 的写入操作（纯 HTTP，无需 UI） |
| `POST /api/agent/runs/[id]/cancel` | 取消运行中的任务 |
| `POST /api/agent/runs/[id]/mode` | 切换审批模式（approval ↔ full_access） |
| `POST /api/agent/runs/[id]/resume` | 崩溃后恢复任务 |
| `GET /api/agent/context-estimate` | 预估上下文开销（发起前评估成本） |
| `GET /api/agent/qc/evals` | 质检评估结果查询 |

### ④ 设定与大纲（13 个）— 世界观/角色/结构的程序化管理

| API | 功能 |
|---|---|
| `POST /api/novels/[id]/characters` | 新建角色卡 |
| `PATCH /api/characters/[id]` | 修改角色卡 |
| `DELETE /api/characters/[id]` | 删除角色卡 |
| `POST /api/novels/[id]/world-entries` | 新建世界观条目 |
| `PATCH /api/world-entries/[id]` | 修改世界观条目 |
| `DELETE /api/world-entries/[id]` | 删除世界观条目 |
| `POST /api/novels/[id]/outline-beats` | 新建大纲节拍 |
| `PATCH /api/outline-beats/[id]` | 修改大纲节拍 |
| `DELETE /api/outline-beats/[id]` | 删除大纲节拍 |
| `GET /api/novels/[id]/volumes` | 读取分卷列表 |
| `POST /api/novels/[id]/volumes` | 新建分卷 |
| `PATCH /api/volumes/[id]` | 修改分卷 |
| `DELETE /api/volumes/[id]` | 删除分卷 |

注：这些写接口受 canon 锁保护——定稿（final）资产必须先 reopen 才能修改，
对外语义清晰（409 `asset_finalized`），是优点不是障碍。

### ⑤ 台账（5 个）— 剧情线/时间线/人物弧光/伏笔承诺的结构化记录

| API | 功能 |
|---|---|
| `GET /api/novels/[id]/ledger` | 读取五类台账（storyline / timeline / arc / promise / clue） |
| `POST /api/novels/[id]/ledger` | 新增台账条目 |
| `PATCH /api/ledger/[kind]/[id]` | 修改条目 |
| `DELETE /api/ledger/[kind]/[id]` | 删除条目 |
| `POST /api/ledger/[kind]/[id]/[move]` | 台账条目定稿/重开 |

### ⑥ 记忆与生命周期（3 个）— 只读监控 + 幂等状态迁移

| API | 功能 |
|---|---|
| `GET /api/novels/[id]/memory` | 读取记忆投影（摘要、事实、角色状态、伏笔） |
| `GET /api/novels/[id]/memory/status` | 记忆池健康度计数 |
| `POST /api/novels/[id]/[kind]/[assetId]/[move]` | 7 类资产的定稿/重开（幂等，写审计记录） |

### ⑦ 数据集成（3 个）— 最适合系统对接的进出口

| API | 功能 |
|---|---|
| `GET /api/novels/[id]/export` | 全量 JSON 备份（v2，含记忆层） |
| `GET /api/novels/[id]/export/markdown` | 导出 Markdown 成稿 |
| `POST /api/import` | 导入备份重建小说（id 全部重生成） |

注：导入完整性校验目前仅核对章节数与总字数，手改备份不能被检出；
对外开放前建议加强校验。

### ⑧ 基础设施（1 个）

| API | 功能 |
|---|---|
| `GET /api/health` | 健康检查（唯一公开端点，无需鉴权，不含小说数据） |

---

## 第二档：谨慎开放（12 个）— 涉及计费或直接消耗积分，需配额/scope 控制

| 类别 | API | 功能与顾虑 |
|---|---|---|
| AI 直调（2） | `POST /api/ai/wizard` | 向导式设定生成；每次调用直接消耗积分，须限流 |
| | `POST /api/ai/draft` | 正文草稿生成；同上 |
| 素材包（4） | `GET /api/novels/[id]/packs` | 读取章节素材/准备包 |
| | `POST /api/novels/[id]/packs` | 写入素材包（幂等 upsert，适合对接，但属内部草稿区） |
| | `PATCH /api/packs/[id]` | 修改素材包 |
| | `DELETE /api/packs/[id]` | 删除素材包 |
| 用量账单（6） | `GET /api/usage/credits` | 查询积分余额（财务敏感，建议只读开放） |
| | `GET /api/usage/ledger` | 查询消费流水（只读） |
| | `GET /api/usage/invoice` | 查询发票列表（只读） |
| | `POST /api/usage/invoice` | 开具发票（建议留在自有 UI，不对外） |
| | `GET /api/usage/statement` | 查询对账单（只读） |
| | `GET /api/novels/[id]/usage` | 查询单本小说的用量（只读） |

---

## 第三档：不建议开放（7 个）

| API | 原因 |
|---|---|
| `GET /api` | hello-world 脚手架残留，应删除 |
| `POST /api/chapters/[id]/review` | 违反「唯一评审写入者」规则——评审只应由 Agent 运行时经 `src/lib/novara/review.ts` 写入，外部直调会破坏质检门禁 |
| `POST /api/chapters/[id]/sediment` | 记忆投影必须随 finalize 事务写入，单独暴露会破坏「投影与定稿不可拆分」的完整性规则 |
| `GET /api/novels/[id]/world-groups` | 世界分组是内部组织结构，无独立对外价值，且当前无 UI 调用者 |
| `POST /api/novels/[id]/world-groups` | 同上 |
| `PATCH /api/world-groups/[id]` | 同上 |
| `DELETE /api/world-groups/[id]` | 同上 |

---

## 总结与建议

**44 个端点功能上已具备对外开放条件**。其中最有开发者价值的是三条链路：

1. **Agent 运行闭环（10 个）**：提交目标 → AI 写作 → 审批 → 取回结果；
2. **数据进出口（3 个）**：JSON 备份 / Markdown 成稿 / 导入重建；
3. **小说与章节 CRUD（9 个）**：外部系统管理作品与正文。

外部系统靠这 22 个端点即可实现「提交目标 → AI 写作 → 审批 → 取回成稿」的完整自动化。

### 对外开放前的前置工作（按优先级）

1. 机器鉴权：API key 签发/吊销 + scope 机制（新表 + 中间件分支，复用既有所有权体系）；
2. `/api/v1` 版本化 + OpenAPI 规范 + 面向第三方的调用文档；
3. 补齐子资源单项 GET（章节、角色、世界条目、大纲、分卷）；
4. 请求级限流、CORS、`Idempotency-Key` 协议层幂等、webhook 回调；
5. 修复文档与代码不符处（README 路由数 44→46、虚构的 `GET /api/chapters/[id]`），
   统一 3 处偏离契约的路由（usage/invoice、agent resume、两个 [move]）。

### 已知安全注意点

- 部署为 Cloud Run `--allow-unauthenticated` 公网暴露，鉴权完全依赖应用层中间件；
- `ADMIN_UIDS` 静态白名单的管理员可跨全部租户读写、无限 AI 消费，
  无法按集成方限定 scope 或单独吊销——对外开放前必须解决。
