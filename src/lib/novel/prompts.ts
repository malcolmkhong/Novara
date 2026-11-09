/**
 * Prompt builders + defensive response parsing for the Novel Creator.
 *
 * Methodology adapted from the webnovel-writer skill system:
 *  - init  : 设定集（世界观/力量体系/金手指/角色/反派）+ 总纲（卷名/章节范围/
 *            核心冲突/卷末高潮），先收集再生成，避免"先生成再返工"。
 *  - plan  : 卷节拍表（危机链≥3次递增、必须有中段反转、卷末钩子落到最后一章
 *            的章末未闭合问题）+ 章纲（目标/时间锚点/必须节点/章末钩子）。
 *  - write : 五段写作任务书——本章硬性约束 → 必须节点 → 活跃伏笔 → 人物卡与
 *            OOC 警戒 → 风格补充；只输出纯正文，无占位符。
 *  - sediment: 记忆沉淀——摘要、新事实、角色状态变化、伏笔（埋设/推进/回收）。
 *  - review: 结构化审查——维度评分 + blocking 问题（与设定/前情矛盾、未完成
 *            本章目标）+ 可执行建议。
 *
 * Wire format: repetitive structures use PIPE-DELIMITED strings
 * ("name|role|desire|flaw|arc") instead of arrays of objects. AI corrupts
 * repeated JSON keys under long outputs ({"name苏晴"} losing `":"`), and the
 * pipe format removes that failure mode while cutting output tokens ~35%.
 * Scalar fields stay as plain JSON strings. AI output is UNTRUSTED: every
 * parser validates shape defensively.
 */
import { extractJson } from "@/lib/ai-heuristics";
import { asString, asStringArray, clampInt, repairJson, type AiMessage } from "@/lib/ai/writing";
import type {
  ChapterOutline,
  ChapterReview,
  MasterVolume,
  NovelBible,
  NovelCharacter,
  NovelVillain,
  SedimentResult,
  VolumeBeat,
} from "./types";

// ---------------------------------------------------------------------------
// Pipe-row helpers
// ---------------------------------------------------------------------------

/** Split a pipe row into trimmed, non-empty segments. */
function splitRow(row: string): string[] {
  return row.split("|").map((part) => part.trim());
}

const RANGE_RE = /(\d+)\s*[-–—~至]\s*(\d+)/;

/**
 * Parse a loose JSON object out of a AI reply: direct parse first (never
 * risk repairing valid JSON), repairJson fallback for known corruption
 * patterns (merged keys, trailing commas, smart quotes).
 */
function parseLoose(raw: string): Record<string, unknown> | null {
  const direct = extractJson<Record<string, unknown>>(raw);
  if (direct !== null && typeof direct === "object" && !Array.isArray(direct)) {
    return direct;
  }
  const repaired = extractJson<Record<string, unknown>>(repairJson(raw));
  if (repaired !== null && typeof repaired === "object" && !Array.isArray(repaired)) {
    return repaired;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shared compact renderers (used by plan/write/review context briefs)
// ---------------------------------------------------------------------------

export interface BiblePack {
  title: string;
  genre: string;
  logline: string;
  coreConflict: string | null;
  platform: string | null;
  bible: NovelBible | null;
  characters: NovelCharacter[];
  villain: NovelVillain | null;
}

export function bibleCompact(pack: BiblePack): string {
  const lines: string[] = [];
  lines.push(`书名：${pack.title}`);
  lines.push(`题材：${pack.genre}`);
  lines.push(`一句话故事：${pack.logline}`);
  if (pack.coreConflict) lines.push(`核心冲突：${pack.coreConflict}`);
  if (pack.platform) lines.push(`目标读者/平台：${pack.platform}`);
  if (pack.bible) {
    lines.push(`世界观：${pack.bible.world}`);
    lines.push(`力量/成长体系：${pack.bible.power}`);
    lines.push(`金手指：${pack.bible.goldenFinger}`);
    if (pack.bible.themes.length > 0) {
      lines.push(`主题关键词：${pack.bible.themes.join("、")}`);
    }
  }
  if (pack.characters.length > 0) {
    lines.push("主要角色：");
    for (const c of pack.characters) {
      lines.push(`- ${c.name}（${c.role}）：渴望${c.desire}；缺陷${c.flaw}；成长线${c.arc}`);
    }
  }
  if (pack.villain) {
    lines.push(`反派：${pack.villain.name}——${pack.villain.scheme}（与主角镜像关系：${pack.villain.mirror}）`);
  }
  return lines.join("\n");
}

export interface ForeshadowRef {
  id: string;
  title: string;
  description: string;
  status: string;
  plantedAt: number;
}

export function foreshadowLines(items: ForeshadowRef[]): string {
  if (items.length === 0) return "（暂无活跃伏笔）";
  return items
    .map(
      (f) =>
        `- [${f.id}]《${f.title}》状态:${f.status} 埋于第${f.plantedAt}章——${f.description}`,
    )
    .join("\n");
}

// ---------------------------------------------------------------------------
// init — 设定集 + 总纲
// ---------------------------------------------------------------------------

export interface InitInput {
  genre: string;
  idea: string;
  title?: string;
  targetChapters: number;
  volumeCount: number;
  platform?: string;
}

export function buildInitMessages(input: InitInput): AiMessage[] {
  const system = `你是资深网文主编兼故事架构师，擅长为长篇连载设计"能写几百章不崩"的骨架。设计原则：
1. 设定服务于冲突：世界观、力量体系、金手指都要能持续产生矛盾与爽点，而不是名词堆砌。
2. 金手指必须有清晰的核心功能、触发条件、代价/限制、反制方式与升级路径。
3. 反派与主角构成镜像关系，欲望对撞。
4. 总纲分卷：每卷有明确的卷级核心冲突、卷末高潮、跨卷新钩子；章节范围必须连续覆盖 1 到目标章数，不重叠不缺号。
5. 命名有记忆点、符合题材气质，避免与知名作品重名。
严格输出一个 JSON 对象（无 markdown 代码块、无解释）。重复性的列表一律用竖线分隔的字符串，绝不要用对象数组。结构：
{"title":"书名","logline":"一句话故事，30字内","coreConflict":"贯穿全书的核心冲突，一句话","bible":{"world":"世界边界/社会结构/关键地点，150字内","power":"力量或成长体系：阶段链、限制与代价，120字内","goldenFinger":"核心功能/触发/代价/反制/升级，120字内","themes":["主题词","主题词"]},"characters":["角色名|定位|核心欲望|性格缺陷|成长弧线","..."],"villain":"反派名|核心图谋|与主角的镜像关系","volumes":["卷名|起始章-结束章|卷级核心冲突|卷末高潮|跨卷新钩子","..."]}
要求：characters 恰好 4-5 条；volumes 条数必须等于我指定的卷数，章节数格式如"3-8"；字符串值内禁止出现竖线|。所有文本用中文。`;

  const userParts = [
    `题材：${input.genre}`,
    `灵感/想写的故事：${input.idea}`,
    input.title ? `书名（沿用）：${input.title}` : "书名：由你起一个有记忆点的书名",
    `目标总章数：${input.targetChapters}`,
    `分卷数：${input.volumeCount}`,
    input.platform ? `目标读者/平台：${input.platform}` : "目标读者/平台：通用网文平台",
  ];
  return [
    { role: "assistant", content: system },
    { role: "user", content: userParts.join("\n") },
  ];
}

export interface InitParsed {
  title: string;
  logline: string;
  coreConflict: string | null;
  bible: NovelBible;
  characters: NovelCharacter[];
  villain: NovelVillain | null;
  volumes: MasterVolume[];
}

function parseCharacterRow(row: string): NovelCharacter | null {
  const parts = splitRow(row);
  const name = parts[0];
  if (!name || name.includes("{") || name.includes(":")) return null;
  return {
    name,
    role: parts[1] ?? "配角",
    desire: parts[2] ?? "",
    flaw: parts[3] ?? "",
    arc: parts[4] ?? "",
  };
}

function parseVolumeRow(row: string, fallbackIndex: number): MasterVolume | null {
  const parts = splitRow(row);
  const name = parts[0];
  if (!name) return null;
  const rangeMatch = parts[1] ? RANGE_RE.exec(parts[1]) : null;
  return {
    index: fallbackIndex,
    name,
    startChapter: rangeMatch ? clampInt(rangeMatch[1], 1, 9999, 0) : 0,
    endChapter: rangeMatch ? clampInt(rangeMatch[2], 1, 9999, 0) : 0,
    coreConflict: parts[2] ?? "",
    climax: parts[3] ?? "",
    hook: parts[4] ?? "",
  };
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim().length > 0) {
      out.push(item.trim());
      if (out.length >= max) break;
    }
  }
  return out;
}

export function parseInitResponse(raw: string): InitParsed | null {
  const r = parseLoose(raw);
  if (r === null) return null;

  const title = asString(r.title);
  const logline = asString(r.logline);
  if (!title || !logline) return null;

  const bibleRaw = (r.bible ?? {}) as Record<string, unknown>;
  const bible: NovelBible = {
    world: asString(bibleRaw.world) ?? "（世界观待补充）",
    power: asString(bibleRaw.power) ?? "（力量体系待补充）",
    goldenFinger: asString(bibleRaw.goldenFinger) ?? "（金手指待补充）",
    themes: asStringArray(bibleRaw.themes, 6),
  };

  // characters: pipe rows; tolerate legacy object arrays defensively.
  const characters: NovelCharacter[] = [];
  if (Array.isArray(r.characters)) {
    for (const item of r.characters) {
      if (typeof item === "string") {
        const c = parseCharacterRow(item);
        if (c) characters.push(c);
      } else if (typeof item === "object" && item !== null) {
        const o = item as Record<string, unknown>;
        const name = asString(o.name);
        if (name) {
          characters.push({
            name,
            role: asString(o.role) ?? "配角",
            desire: asString(o.desire) ?? "",
            flaw: asString(o.flaw) ?? "",
            arc: asString(o.arc) ?? "",
          });
        }
      }
      if (characters.length >= 6) break;
    }
  }

  // villain: pipe row "name|scheme|mirror" or legacy object.
  let villain: NovelVillain | null = null;
  if (typeof r.villain === "string") {
    const parts = splitRow(r.villain);
    if (parts[0]) {
      villain = { name: parts[0], scheme: parts[1] ?? "", mirror: parts[2] ?? "" };
    }
  } else if (typeof r.villain === "object" && r.villain !== null) {
    const v = r.villain as Record<string, unknown>;
    const name = asString(v.name);
    if (name) villain = { name, scheme: asString(v.scheme) ?? "", mirror: asString(v.mirror) ?? "" };
  }

  // volumes: pipe rows; tolerate legacy object arrays.
  const volumes: MasterVolume[] = [];
  if (Array.isArray(r.volumes)) {
    for (const item of r.volumes) {
      if (typeof item === "string") {
        const v = parseVolumeRow(item, volumes.length + 1);
        if (v) volumes.push(v);
      } else if (typeof item === "object" && item !== null) {
        const o = item as Record<string, unknown>;
        const name = asString(o.name);
        if (!name) continue;
        volumes.push({
          index: clampInt(o.index, 1, 99, volumes.length + 1),
          name,
          startChapter: clampInt(o.startChapter, 1, 9999, 0),
          endChapter: clampInt(o.endChapter, 1, 9999, 0),
          coreConflict: asString(o.coreConflict) ?? "",
          climax: asString(o.climax) ?? "",
          hook: asString(o.hook) ?? "",
        });
      }
    }
  }
  if (volumes.length === 0) return null;

  return { title, logline, coreConflict: asString(r.coreConflict), bible, characters, villain, volumes };
}

// ---------------------------------------------------------------------------
// plan — 卷节拍表 + 章纲
// ---------------------------------------------------------------------------

export interface PlanVolumeInfo {
  index: number;
  name: string;
  startChapter: number;
  endChapter: number;
  coreConflict: string | null;
  climax: string | null;
  hook: string | null;
}

export interface PlanContext {
  pack: BiblePack;
  volume: PlanVolumeInfo;
  /** Facts sedimented from previous chapters (may be empty for volume 1). */
  recentFacts: string[];
  openForeshadows: ForeshadowRef[];
}

export function buildPlanMessages(ctx: PlanContext): AiMessage[] {
  const system = `你是网文结构编辑，负责把一卷从"卷级目标"细化为可执行的节拍表与章纲。硬规则：
1. 危机链至少 3 次递进（每档压力明显高于上一档）。
2. 必须安排中段反转；确无反转可在描述中写明理由。
3. 卷末高潮呼应卷级冲突，卷末新钩子必须能落成最后一章的章末未闭合问题。
4. 章纲逐章给出：本章目标、时间锚点（连续推进不回跳；闪回需标注）、2-4 个必须覆盖节点、章末钩子。
5. 章纲必须覆盖该卷全部章节号：从起始章到结束章连续、不缺号、不超号。
严格输出一个 JSON 对象（无 markdown 代码块、无解释）。列表一律用竖线分隔的字符串，绝不要用对象数组。结构：
{"beats":["阶段|节拍名|两句话描述","..."],"chapters":["章号|章节名|本章目标40字内|时间锚点10字内|节点A；节点B；节点C|章末钩子20字内","..."]}
beats 的阶段从这些里选：开局钩子/递进危机一/递进危机二/递进危机三/中段反转/卷末高潮/跨卷新钩子；beats 提供 6-8 条；chapters 数量与该卷章节数完全一致；节点之间用中文分号；分隔。字符串值内禁止出现竖线|。所有文本用中文。`;

  const user = [
    "【设定与总纲】",
    bibleCompact(ctx.pack),
    "",
    "【本卷信息】",
    `卷${ctx.volume.index}《${ctx.volume.name}》第${ctx.volume.startChapter}-${ctx.volume.endChapter}章`,
    ctx.volume.coreConflict ? `卷级核心冲突：${ctx.volume.coreConflict}` : "",
    ctx.volume.climax ? `卷末高潮：${ctx.volume.climax}` : "",
    ctx.volume.hook ? `跨卷新钩子：${ctx.volume.hook}` : "",
    "",
    "【前情事实（已沉淀）】",
    ctx.recentFacts.length > 0 ? ctx.recentFacts.map((f) => `- ${f}`).join("\n") : "（第一卷或暂无）",
    "",
    "【活跃伏笔】（可在章纲中安排推进，勿在本卷全部回收除非合理）",
    foreshadowLines(ctx.openForeshadows),
  ]
    .filter((line) => line !== "")
    .join("\n");

  return [
    { role: "assistant", content: system },
    { role: "user", content: user },
  ];
}

export interface PlanParsed {
  beats: VolumeBeat[];
  chapters: ChapterOutline[];
}

function parseBeatRow(row: string): VolumeBeat | null {
  const parts = splitRow(row);
  const title = parts[1] ?? parts[0];
  if (!title) return null;
  return { phase: parts[0] ?? "节拍", title, description: parts[2] ?? "" };
}

function parseChapterRow(row: string): ChapterOutline | null {
  const parts = splitRow(row);
  const number = parseInt(parts[0] ?? "", 10);
  if (!Number.isFinite(number)) return null;
  return {
    number,
    title: parts[1] ?? `第${number}章`,
    goal: parts[2] ?? "",
    timeAnchor: parts[3] ?? "紧接上文",
    mustCover: parts[4] ? parts[4].split(/[；;]/).map((s) => s.trim()).filter(Boolean).slice(0, 4) : [],
    endHook: parts[5] ?? "",
  };
}

export function parsePlanResponse(raw: string): PlanParsed | null {
  const r = parseLoose(raw);
  if (r === null) return null;

  const beatRows = stringList(r.beats, 10);
  const beats: VolumeBeat[] = [];
  if (Array.isArray(r.beats)) {
    // Legacy tolerance: object beats.
    for (const item of r.beats) {
      if (typeof item === "string") {
        const b = parseBeatRow(item);
        if (b) beats.push(b);
      } else if (typeof item === "object" && item !== null) {
        const o = item as Record<string, unknown>;
        const title = asString(o.title);
        if (title) {
          beats.push({
            phase: asString(o.phase) ?? "节拍",
            title,
            description: asString(o.description) ?? "",
          });
        }
      }
      if (beats.length >= 10) break;
    }
  }
  if (beats.length === 0 && beatRows.length === 0) return null;

  const chapters: ChapterOutline[] = [];
  if (Array.isArray(r.chapters)) {
    for (const item of r.chapters) {
      if (typeof item === "string") {
        const c = parseChapterRow(item);
        if (c) chapters.push(c);
      } else if (typeof item === "object" && item !== null) {
        const o = item as Record<string, unknown>;
        const number = clampInt(o.number, 1, 9999, 0);
        if (number === 0) continue;
        chapters.push({
          number,
          title: asString(o.title) ?? `第${number}章`,
          goal: asString(o.goal) ?? "",
          timeAnchor: asString(o.timeAnchor) ?? "紧接上文",
          mustCover: asStringArray(o.mustCover, 4),
          endHook: asString(o.endHook) ?? "",
        });
      }
    }
  }

  return { beats, chapters };
}

// ---------------------------------------------------------------------------
// write — 五段写作任务书（流式纯正文）
// ---------------------------------------------------------------------------

export interface WriteBrief {
  pack: BiblePack;
  chapter: {
    number: number;
    title: string;
    goal: string | null;
    timeAnchor: string | null;
    mustCover: string[];
    endHook: string | null;
  };
  volumeName: string;
  /** Summaries of the 1-2 preceding chapters. */
  prevSummaries: { number: number; summary: string }[];
  recentFacts: string[];
  openForeshadows: ForeshadowRef[];
  charStates: { name: string; change: string }[];
}

export function buildWriteMessages(brief: WriteBrief): AiMessage[] {
  const system = `你是签约网文作者的代笔。按下面给出的【写作任务书】写本章正文。硬规则：
1. 只输出正文本身：不用章节标题、不用序号、不用 markdown、不用任何括号说明或占位符。
2. 开头三句内把读者拉进具体情境（场景/动作/对话），禁止以天气、历史、设定综述开头。
3. 以场景与动作推进，show don't tell：情绪通过动作、细节、对话呈现，不做总结性旁白。
4. 对话承担信息与冲突，每个角色的口吻可辨识。
5. 必须覆盖任务书列出的节点，并以【章末钩子】收尾——留下未闭合的问题或危机。
6. 字数 1800-2400 字；时间锚点必须遵守；不得与【前情】【角色当前状态】矛盾。
7. 伏笔只按任务书标注处理：标注"推进"的至少给一个推进画面；不要主动回收未标注的伏笔。
8. 中文思维写作；避免 AI 腔：少用排比三连、少用"仿佛/似乎"堆砌、不写空洞抒情。`;

  const ch = brief.chapter;
  const user = [
    `【本卷与章节】${brief.volumeName} · 第${ch.number}章《${ch.title}》`,
    "",
    "一、本章硬性约束",
    `本章目标：${ch.goal ?? "推进主线"}`,
    `时间锚点：${ch.timeAnchor ?? "紧接上一章"}`,
    `章末钩子：${ch.endHook ?? "留出未闭合的危机或悬念"}`,
    ch.mustCover.length > 0
      ? `必须覆盖节点：\n${ch.mustCover.map((n) => `- ${n}`).join("\n")}`
      : "必须覆盖节点：（无硬性节点，围绕本章目标展开）",
    "",
    "二、设定基线",
    bibleCompact(brief.pack),
    "",
    "三、前情（禁止大段复述，只做自然衔接）",
    brief.prevSummaries.length > 0
      ? brief.prevSummaries.map((p) => `第${p.number}章摘要：${p.summary}`).join("\n")
      : "（本章为全书第一章）",
    brief.recentFacts.length > 0
      ? `近期已确立事实：\n${brief.recentFacts.map((f) => `- ${f}`).join("\n")}`
      : "",
    "",
    "四、活跃伏笔（仅推进标注者）",
    foreshadowLines(brief.openForeshadows),
    "",
    "五、角色当前状态（OOC 警戒：言行必须符合欲望与缺陷）",
    brief.charStates.length > 0
      ? brief.charStates.map((c) => `- ${c.name}：${c.change}`).join("\n")
      : "（暂无状态记录，按角色卡执行）",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return [
    { role: "assistant", content: system },
    { role: "user", content: user },
  ];
}

// ---------------------------------------------------------------------------
// sediment — 记忆沉淀
// ---------------------------------------------------------------------------

export function buildSedimentMessages(
  chapterNumber: number,
  content: string,
  openForeshadows: ForeshadowRef[],
): AiMessage[] {
  const system = `你是网文项目的事实记录员（memory keeper）。读完本章正文，提取写后续章时必须记住的信息。要求：
1. summary：80-120字摘要，写清关键转折与结果，不剧透未来。
2. facts：新确立的事实（获得物品/能力变化/身世揭示/重要承诺/世界规则新信息），每条25字内，最多6条；没有就给空数组。
3. charStates：主要角色状态变化，每条格式"角色名|变化"，25字内，最多4条；没有就给空数组。
4. foreshadows：本章的伏笔动作，每条格式"动作|伏笔标题|一句话说明"，最多3条；没有就给空数组。动作取值：plant=新埋伏笔（标题为新伏笔起名）、advance=推进已有伏笔（标题从下方活跃伏笔列表中选）、pay=回收已有伏笔（同前）。
严格输出 JSON 对象（无 markdown 代码块、无解释），列表用字符串数组（内部可用竖线|），不要用对象数组。结构：
{"summary":"...","facts":["..."],"charStates":["角色名|变化"],"foreshadows":["plant|伏笔标题|说明"]}`;

  const capped = content.length > 6000 ? `${content.slice(0, 6000)}…（后文截断）` : content;
  const user = [
    `第${chapterNumber}章正文如下：`,
    "",
    capped,
    "",
    "当前活跃伏笔（advance/pay 的伏笔标题必须从下列标题中选）：",
    foreshadowLines(openForeshadows),
  ].join("\n");

  return [
    { role: "assistant", content: system },
    { role: "user", content: user },
  ];
}

const FORESHADOW_ACTIONS = ["plant", "advance", "pay"] as const;

function parseForeshadowRow(row: string): SedimentResult["foreshadows"][number] | null {
  const parts = splitRow(row);
  const action = parts[0]?.toLowerCase();
  const ref = parts[1];
  if (!action || !ref) return null;
  if (!(FORESHADOW_ACTIONS as readonly string[]).includes(action)) return null;
  return { action: action as "plant" | "advance" | "pay", ref, note: parts[2] ?? "" };
}

export function parseSedimentResponse(raw: string): SedimentResult | null {
  const r = parseLoose(raw);
  if (r === null) return null;

  const summary = asString(r.summary);
  if (!summary) return null;

  const foreshadows: SedimentResult["foreshadows"] = [];
  if (Array.isArray(r.foreshadows)) {
    for (const item of r.foreshadows) {
      if (typeof item === "string") {
        const f = parseForeshadowRow(item);
        if (f) foreshadows.push(f);
      } else if (typeof item === "object" && item !== null) {
        const o = item as Record<string, unknown>;
        const action = asString(o.action)?.toLowerCase();
        const ref = asString(o.ref);
        if (action && ref && (FORESHADOW_ACTIONS as readonly string[]).includes(action)) {
          foreshadows.push({
            action: action as "plant" | "advance" | "pay",
            ref,
            note: asString(o.note) ?? "",
          });
        }
      }
      if (foreshadows.length >= 3) break;
    }
  }

  const charStates: SedimentResult["charStates"] = [];
  if (Array.isArray(r.charStates)) {
    for (const item of r.charStates) {
      if (typeof item === "string") {
        const parts = splitRow(item);
        if (parts[0] && parts[1]) charStates.push({ name: parts[0], change: parts[1] });
      } else if (typeof item === "object" && item !== null) {
        const o = item as Record<string, unknown>;
        const name = asString(o.name);
        const change = asString(o.change);
        if (name && change) charStates.push({ name, change });
      }
      if (charStates.length >= 4) break;
    }
  }

  return { summary, facts: asStringArray(r.facts, 6), charStates, foreshadows };
}

// ---------------------------------------------------------------------------
// review — 结构化审查
// ---------------------------------------------------------------------------

export interface ReviewBrief {
  pack: BiblePack;
  chapter: {
    number: number;
    title: string;
    goal: string | null;
    mustCover: string[];
    endHook: string | null;
  };
  prevSummary: string | null;
  openForeshadows: ForeshadowRef[];
  content: string;
}

export function buildReviewMessages(brief: ReviewBrief): AiMessage[] {
  const system = `你是严格的网文审稿人。对给出的章节正文做结构化审查。审查维度（6条，按顺序）：钩子强度（开头3句）、节奏（场景推进与信息密度）、人物一致性（是否符合欲望/缺陷/当前状态）、对话自然度、伏笔处理（该推进的是否推进、是否误回收）、文笔（show don't tell、是否有AI腔）。
判为 blocking 的标准：与设定/前情明显矛盾；未完成本章目标；遗漏全部必须节点；正文含占位符或半截。轻微问题一律放 suggestions。
严格输出 JSON 对象（无 markdown 代码块、无解释），列表用字符串数组（内部用竖线|），不要用对象数组。结构：
{"overallScore":0到100整数,"dimensions":["维度名|分数0-100|30字内评语","..."],"blocking":["问题描述|定点修复建议","..."],"suggestions":["改进建议，最多4条"],"consistencyFlags":["与设定或前情可能矛盾的点，最多3条，无则空数组"]}`;

  const capped =
    brief.content.length > 6000 ? `${brief.content.slice(0, 6000)}…（后文截断）` : brief.content;
  const user = [
    `审查对象：第${brief.chapter.number}章《${brief.chapter.title}》`,
    "",
    "【本章目标与节点】",
    `本章目标：${brief.chapter.goal ?? "推进主线"}`,
    brief.chapter.mustCover.length > 0
      ? `必须节点：${brief.chapter.mustCover.join("；")}`
      : "必须节点：无",
    `章末钩子要求：${brief.chapter.endHook ?? "留出未闭合问题"}`,
    "",
    "【设定基线】",
    bibleCompact(brief.pack),
    "",
    "【上一章摘要】",
    brief.prevSummary ?? "（第一章）",
    "",
    "【活跃伏笔】",
    foreshadowLines(brief.openForeshadows),
    "",
    "【正文】",
    capped,
  ].join("\n");

  return [
    { role: "assistant", content: system },
    { role: "user", content: user },
  ];
}

export function parseReviewResponse(raw: string): ChapterReview | null {
  const r = parseLoose(raw);
  if (r === null) return null;

  const overallScore = clampInt(r.overallScore, 0, 100, -1);
  if (overallScore < 0) return null;

  const dimensions: ChapterReview["dimensions"] = [];
  if (Array.isArray(r.dimensions)) {
    for (const item of r.dimensions) {
      if (typeof item === "string") {
        const parts = splitRow(item);
        const name = parts[0];
        if (!name) continue;
        dimensions.push({
          name,
          score: clampInt(parseInt(parts[1] ?? "", 10), 0, 100, 50),
          comment: parts[2] ?? "",
        });
      } else if (typeof item === "object" && item !== null) {
        const o = item as Record<string, unknown>;
        const name = asString(o.name);
        if (!name) continue;
        dimensions.push({
          name,
          score: clampInt(o.score, 0, 100, 50),
          comment: asString(o.comment) ?? "",
        });
      }
      if (dimensions.length >= 8) break;
    }
  }

  const blocking: ChapterReview["blocking"] = [];
  if (Array.isArray(r.blocking)) {
    for (const item of r.blocking) {
      if (typeof item === "string") {
        const parts = splitRow(item);
        if (parts[0]) blocking.push({ issue: parts[0], fix: parts[1] ?? "" });
      } else if (typeof item === "object" && item !== null) {
        const o = item as Record<string, unknown>;
        const issue = asString(o.issue);
        if (issue) blocking.push({ issue, fix: asString(o.fix) ?? "" });
      }
      if (blocking.length >= 5) break;
    }
  }

  return {
    overallScore,
    dimensions,
    blocking,
    suggestions: asStringArray(r.suggestions, 4),
    consistencyFlags: asStringArray(r.consistencyFlags, 3),
  };
}
