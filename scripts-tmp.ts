import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const F = (d: Date) => d.toISOString();
for (const [label, runId] of [["run1 clean (cmw37fgfn…)", "cmw37fgfn001uox1fkalbyl8q"], ["run2 killed+resumed (cmw37k70w…)", "cmw37k70w0001oxq6sm8xdhf0"]] as const) {
  const usage = await db.agentEvent.findMany({ where: { runId, kind: "usage" }, orderBy: { createdAt: "asc" }, select: { createdAt: true, payload: true } });
  let prompt = 0, completion = 0, preKill = 0, postResume = 0;
  const killAt = new Date("2026-11-05T07:12:41.342Z");
  for (const u of usage) {
    const p = JSON.parse(u.payload ?? "{}") as { usage?: { real?: { promptTokens?: number; completionTokens?: number } | null } };
    const real = p.usage?.real;
    prompt += real?.promptTokens ?? 0; completion += real?.completionTokens ?? 0;
    if (u.createdAt < killAt) preKill += real?.promptTokens ?? 0; else postResume += real?.promptTokens ?? 0;
  }
  console.log(`${label}: ${usage.length} model calls, Σprompt=${prompt}, Σcompletion=${completion}` + (runId.startsWith("cmw37k70w") ? ` | pre-kill Σprompt=${preKill}, post-resume Σprompt=${postResume} (resumed turn 1 re-billed the replayed wire)` : ""));
}
await db.$disconnect();
