// Focused probe: FD shape ONLY (empty content WITH usage) — dump every row.
import { mock } from "bun:test";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const CORR = "p5b-probe-fd";

let behavior: () => Promise<unknown> = async () => {
  throw new Error("no scenario");
};
mock.module("z-ai-web-dev-sdk", () => ({
  default: {
    create: async () => ({
      chat: { completions: { create: (_o: unknown) => behavior() } },
    }),
  },
}));

const { chatCompletion } = await import("../src/lib/ai/chat");

async function dump(label: string) {
  const rows = await db.usageCall.findMany({ where: { correlationId: CORR }, orderBy: { createdAt: "asc" } });
  console.log(`PROBE ${label}: ${rows.length} rows`);
  for (const r of rows) {
    console.log(`  - ${r.status}/${r.errorKind}/${r.totalTokens} created=${r.createdAt.toISOString()}`);
  }
  return rows;
}

async function main() {
  await db.usageCall.deleteMany({ where: { correlationId: CORR } });
  behavior = async () => ({
    choices: [{ message: { content: "" } }],
    usage: { prompt_tokens: 77, completion_tokens: 0, total_tokens: 77 },
  });
  let threw = "";
  try {
    await chatCompletion({
      messages: [{ role: "user", content: "probe" }],
      tag: "p5b probe FD",
      surface: "p5b-probe",
      ledger: { correlationId: CORR },
    });
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error);
  }
  console.log(`PROBE threw="${threw}"`);
  for (const ms of [100, 500, 1000, 2000, 4000]) {
    await new Promise((r) => setTimeout(r, ms));
    const rows = await dump(`t+~${ms}ms cumulative`);
    if (rows.length > 1) {
      console.log("PROBE ANOMALY: more than one row for a single-attempt call");
      break;
    }
  }
  await db.usageCall.deleteMany({ where: { correlationId: CORR } });
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("PROBE crashed:", e);
  await db.$disconnect();
  process.exit(1);
});
