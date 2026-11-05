import ZAI from "z-ai-web-dev-sdk";
import { jsonError, parseBody, validationError, withTimeout } from "@/lib/novara/api-helpers";
import { extractRealUsage, recordGlobalUsage } from "@/lib/usage/ledger";
import { recordUsageCall } from "@/lib/usage/usage-store";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const GLM_TIMEOUT_MS = 60_000;

// Canonical line formats the wizard parser (wizard-parse.ts) understands.
// Provided in both languages so GLM follows the example's language.
const CAST_FORMAT_EN = `One character per line, exactly this format:
Name — role: description
Example: Mara Voss — protagonist: night clerk of the Ledger; keeps the trade book.`;
const CAST_FORMAT_ZH = `每行一个角色，严格按此格式：
姓名 — 角色定位：描述
示例：林晚 — 主角：在水塔顶端卖雨水的少女，收的货币是记忆。`;
const BEAT_FORMAT_EN = `One beat per line, exactly this format:
Title: summary
Example: Night shift, normal rules: Mara balances the ledger after a quiet shift; a trade leaves the till short by one year.`;
const BEAT_FORMAT_ZH = `每行一个节拍，严格按此格式：
标题：摘要
示例：夜班，规则照旧：玛拉清完账本后发现有笔交易让钱柜恰好短了一年。`;
const WORLD_FORMAT_EN = `One entry per line, exactly this format:
Title — category: content
(category is one of: location, faction, item, system, culture)
Example: The Ledger Hall — location: a converted bank where debts are measured in years; the vault door only opens at dusk.`;
const WORLD_FORMAT_ZH = `每行一个条目，严格按此格式：
标题 — 类别：内容
（类别只能取：location、faction、item、system、culture）
示例：账簿厅 — location：由旧银行改建的大厅，债务以年月计量，金库门只在黄昏开启。`;

const wizardSchema = z.object({
  section: z.enum(["logline", "premise", "characters", "world", "beats", "contract"]),
  genre: z.string().trim().max(120).optional(),
  logline: z.string().trim().max(2000).optional(),
  premise: z.string().trim().max(20000).optional(),
  characters: z.string().trim().max(20000).optional(),
  targetWords: z.number().int().min(1000).max(5000000).optional(),
  // P5 — client-generated wizard session id: every section call of one
  // wizard session carries the same id so the ledger can retro-tag the
  // whole session onto the novel it culminates in (UsageProvenance, written
  // by POST /api/novels). Absent on older clients — rows stay global-only.
  sessionId: z.string().trim().min(8).max(100).optional(),
});

// POST /api/ai/wizard — GLM generation for the "New with the AI team" wizard.
// One section per call; previously generated sections are passed in as
// context so cast and outline stay coherent with the premise. Returns the
// canonical text the wizard renders into its editable textareas — nothing
// is persisted until the user presses Create (human-in-the-loop, same
// principle as /api/ai/draft).
export async function POST(req: Request) {
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = wizardSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  const { section, genre, logline, premise, characters, targetWords, sessionId } =
    schema.data;

  const languageSample = `${genre ?? ""}\n${logline ?? ""}\n${premise ?? ""}`;
  const isChinese = /[\u4e00-\u9fff]/.test(languageSample);

  const scale =
    targetWords && targetWords > 0
      ? isChinese
        ? `全书目标约 ${targetWords} 字。`
        : `The novel targets roughly ${targetWords} words in total.`
      : "";

  const system = isChinese
    ? "你是 Novara AI 的创作团队（Atlas 策划 / Sage 执笔）。只输出要求的成品内容本身——不要标题、不要解释、不要 Markdown 记号（不要 #、*、反引号）。严格遵守要求的行格式。"
    : "You are the Novara AI story team (Atlas the planner, Sage the writer). Output ONLY the requested content itself — no headings, no commentary, no markdown markers (no #, *, backticks). Follow the requested line format exactly.";

  const parts: string[] = [];
  if (genre) parts.push(`GENRE: ${genre}`);
  if (logline) parts.push(`LOGLINE: ${logline}`);
  if (premise) parts.push(`PREMISE:\n${premise}`);
  if (characters) parts.push(`CAST SO FAR:\n${characters}`);
  if (scale) parts.push(scale);

  let ask = "";
  switch (section) {
    case "logline":
      ask = isChinese
        ? `任务：为这个题材写一句 selling logline（一个长句，不超过 80 字）${
            genre ? "" : "，题材自拟，要有一个清晰的超自然/高概念设定"
          }。只输出这一句。`
        : `Task: write one selling logline for this genre (a single sentence, max 40 words)${
            genre ? "" : ", inventing a clear high-concept premise"
          }. Output only that sentence.`;
      if (!genre) parts.push(isChinese ? "题材：自拟" : "GENRE: your choice");
      break;
    case "premise":
      ask = isChinese
        ? "任务：把 logline 扩写成工作前提（premise）：情境、压力、代价，120–250 字，1–2 段。只输出前提本身。"
        : "Task: expand the logline into a working premise — the situation, the pressure, the cost. 100–200 words, 1–2 paragraphs. Output only the premise.";
      break;
    case "characters":
      ask = isChinese
        ? `任务：为这个故事写 4–6 个主要角色，覆盖主角/对手/关键配角，全部用中文。\n${CAST_FORMAT_ZH}`
        : `Task: write 4–6 main characters for this story, covering protagonist / antagonist / key supporting.\n${CAST_FORMAT_EN}`;
      break;
    case "world":
      ask = isChinese
        ? `任务：为这个故事设定 5–8 个世界书条目，覆盖地点/组织/物品/规则/文化，全部用中文，条目之间要有内在因果关联。\n${WORLD_FORMAT_ZH}`
        : `Task: write 5–8 world bible entries for this story, covering places / factions / items / systems / culture, with coherent internal cause-and-effect between entries.\n${WORLD_FORMAT_EN}`;
      break;
    case "contract":
      ask = isChinese
        ? "任务：为这本书起草作品契约，恰好 5 行、每行以「标签：」开头，依次是\n类型承诺：\n读者与定位：\n文风承诺：\n节奏承诺：\n硬性禁忌：\n每行 20–60 字，具体可执行，不要空话。只输出这 5 行。"
        : "Task: draft the story contract for this book — exactly 5 lines, each starting with a label, in this order:\nGenre promise:\nAudience:\nStyle commitment:\nPacing commitment:\nHard taboos:\nEach line 10–30 words, concrete and actionable. Output only those 5 lines.";
      break;
    case "beats":
      ask = isChinese
        ? `任务：写出覆盖全书弧线的 8–14 个情节节拍（起承转合 + 结局，节拍要能对应到章节），全部用中文。\n${BEAT_FORMAT_ZH}`
        : `Task: write 8–14 outline beats covering the whole arc (setup, escalation, turn, resolution — beats should map naturally to chapters).\n${BEAT_FORMAT_EN}`;
      break;
  }
  parts.push(ask);

  const user = parts.join("\n\n");

  try {
    const zai = await ZAI.create();
    const completion = await withTimeout(
      zai.chat.completions.create({
        messages: [
          { role: "assistant", content: system },
          { role: "user", content: user },
        ],
        thinking: { type: "disabled" },
      }),
      GLM_TIMEOUT_MS,
      "AI wizard"
    );

    const content = completion.choices[0]?.message?.content?.trim() ?? "";
    // P4 — feed the app-wide usage ledger (measured calls only).
    const usage = extractRealUsage(completion);
    recordGlobalUsage("wizard", usage);
    // P5 — persist the per-call row; correlationId retro-tags this session
    // onto the novel it culminates in (provenance link written at creation).
    recordUsageCall({
      surface: "wizard",
      usage,
      ...(sessionId ? { correlationId: sessionId } : {}),
    });
    if (!content)
      return jsonError("The AI returned an empty draft. Try again.", 502);

    return Response.json({ content });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown AI service error";
    return jsonError(`AI generation failed: ${message}`, 502);
  }
}
