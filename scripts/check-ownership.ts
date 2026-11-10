// ---------------------------------------------------------------------------
// Ownership coverage audit (STEP 48).
//
// Prints the ownership rule that src/lib/db.ts applies to EVERY model, and
// asserts the two lists that must agree:
//
//   UNFILTERED_MODELS — the explicit allowlist of models that are queried
//                       without an owner filter (User, TeamAgent).
//   UNRULELED_MODELS  — every model that matches NO ownership rule.
//
// They must be equal. If a new model is added to prisma/schema.prisma without
// an owner column or a relation path, it lands in UNRULELED_MODELS but NOT in
// UNFILTERED_MODELS — so the assertion fails and the model is refused at
// runtime (rule 5, fail closed) instead of silently leaking.
//
// Run:  bun scripts/check-ownership.ts
// ---------------------------------------------------------------------------

import { Prisma } from "@prisma/client";

const INDIRECT_PATHS: Record<string, string> = {
  AgentTask: "run.novelId",
  AgentEvent: "run.novelId",
  AgentMessage: "run.novelId",
  ContextSummary: "run.novelId",
  SkillInvocation: "task.run.novelId",
  TeamMessage: "conversation.novelId",
  TeamTaskLog: "task.novelId",
};

/** The allowlist in src/lib/db.ts — keep in sync with UNFILTERED_MODELS there. */
const UNFILTERED_MODELS = ["User", "TeamAgent"];

const models = Prisma.dmmf?.datamodel?.models ?? [];
if (models.length === 0) {
  console.error("Prisma.dmmf is empty — run `bun run db:generate` first.");
  process.exit(1);
}

const hasScalar = (name: string, field: string) =>
  models.find((m) => m.name === name)?.fields.some(
    (f) => f.name === field && f.kind === "scalar",
  ) ?? false;

const userIdModels = models.filter((m) => hasScalar(m.name, "userId")).map((m) => m.name);
const novelIdModels = models.filter((m) => hasScalar(m.name, "novelId")).map((m) => m.name);

const unruled = models
  .map((m) => m.name)
  .filter(
    (name) =>
      !userIdModels.includes(name) &&
      !novelIdModels.includes(name) &&
      !(name in INDIRECT_PATHS),
  );

const rows = models.map((m) => {
  const name = m.name;
  let rule: string;
  if (userIdModels.includes(name)) rule = "1 userId      -> { userId: uid }";
  else if (novelIdModels.includes(name)) rule = "2 novelId     -> { novelId: { in: owned } }";
  else if (name in INDIRECT_PATHS) rule = `3 indirect    -> ${INDIRECT_PATHS[name]}`;
  else if (UNFILTERED_MODELS.includes(name)) rule = "4 allowlist  -> UNFILTERED (reported)";
  else rule = "5 UNKNOWN    -> REFUSED (fail closed)";
  return { model: name, rule };
});

console.log(`models: ${models.length}`);
console.log(`rule 1 (userId):    ${userIdModels.length}  ${JSON.stringify(userIdModels)}`);
console.log(`rule 2 (novelId):   ${novelIdModels.length}`);
console.log(`rule 3 (indirect):  ${Object.keys(INDIRECT_PATHS).length}`);
console.log("");
for (const r of rows) console.log(`  ${r.model.padEnd(22)} ${r.rule}`);
console.log("");
console.log(`UNFILTERED_MODELS (declared): ${JSON.stringify(UNFILTERED_MODELS)}`);
console.log(`UNRULELED_MODELS  (computed): ${JSON.stringify(unruled)}`);

const missing = unruled.filter((n) => !UNFILTERED_MODELS.includes(n));
const extra = UNFILTERED_MODELS.filter((n) => !unruled.includes(n));

if (missing.length > 0) {
  console.error(`\nFAIL: model(s) with NO ownership rule: ${JSON.stringify(missing)}`);
  console.error("These are refused at runtime (fail closed). Give them a userId/novelId");
  console.error("column or an INDIRECT_PATHS entry, or list them in UNFILTERED_MODELS.");
  process.exit(1);
}
if (extra.length > 0) {
  console.error(`\nFAIL: UNFILTERED_MODELS lists a model that HAS a rule: ${JSON.stringify(extra)}`);
  process.exit(1);
}
console.log("\nOK: every model has exactly one ownership rule; the allowlist matches.");
