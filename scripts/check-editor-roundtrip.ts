#!/usr/bin/env bun
/**
 * STEP 78 — the editor round-trip gate.
 *
 * Markdown remains the source of truth. This script imports the SAME
 * parse/serialize pair that the browser editor uses
 * (src/lib/novara/editor-schema.ts), so a passing gate proves the schema the
 * app actually runs, not a look-alike test schema.
 *
 * For every fixture: markdown -> parse -> serialize -> markdown, byte-equal.
 * A single differing character fails the whole gate (exit 1) and prints a
 * character-level diff. The corpus is never normalised to make it pass.
 *
 * Fixture provenance:
 *   chapter-1.md / chapter-2.md are byte-for-byte captures of the owner's two
 *   real chapters taken from the live database (novel
 *   cmwbymy5b0005s601mvz2jxg9; chapter ids cmwbyv5o1002zs601r83npsvo and
 *   cmwcfg7uf0018s601ylzjaeew). They are not hand-written prose.
 *   editor-synthetic.md is the one synthetic document: headings 1-3, both
 *   list types, blockquote, bold, italic, a link, a hard break and an em dash.
 *
 * Usage: bun scripts/check-editor-roundtrip.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { editorSchema, parseMarkdown, serializeMarkdown } from "@/lib/novara/editor-schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = [
  "chapter-1.md",
  "chapter-2.md",
  "editor-synthetic.md",
];

const REQUIRED_NODES = [
  "doc",
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "horizontalRule",
  "hardBreak",
  "text",
];
const REQUIRED_MARKS = ["bold", "italic", "link"];

function charDiff(input: string, output: string): string {
  const limit = Math.min(input.length, output.length);
  let at = 0;
  while (at < limit && input[at] === output[at]) at += 1;
  const from = Math.max(0, at - 40);
  const to = Math.min(Math.max(input.length, output.length), at + 40);
  const cps = (s: string) =>
    Array.from(s)
      .map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`)
      .join(" ");
  const before = (s: string) => s.slice(0, at);
  const line = (s: string) => before(s).split("\n").length;
  const col = (s: string) => {
    const parts = before(s).split("\n");
    return parts[parts.length - 1].length + 1;
  };
  return [
    `  first difference at character ${at} (input line ${line(input)} col ${col(input)}, output line ${line(output)} col ${col(output)})`,
    `  input  [${from}..${Math.min(to, input.length)}]: ${JSON.stringify(input.slice(from, to))}`,
    `  output [${from}..${Math.min(to, output.length)}]: ${JSON.stringify(output.slice(from, to))}`,
    `  input  code points : ${cps(input.slice(at, Math.min(to, at + 12)))}`,
    `  output code points : ${cps(output.slice(at, Math.min(to, at + 12)))}`,
  ].join("\n");
}

let failures = 0;

const nodes = Object.keys(editorSchema.nodes).sort();
const marks = Object.keys(editorSchema.marks).sort();
const missingNodes = REQUIRED_NODES.filter((n) => !nodes.includes(n));
const missingMarks = REQUIRED_MARKS.filter((m) => !marks.includes(m));
const forbidden = ["table", "tableRow", "tableCell", "image", "codeBlock"].filter(
  (n) => nodes.includes(n)
);
console.log(`schema nodes : ${nodes.join(", ")}`);
console.log(`schema marks : ${marks.join(", ")}`);
if (missingNodes.length || missingMarks.length || forbidden.length) {
  console.error(`SCHEMA MISMATCH — missing nodes: [${missingNodes.join(", ")}], missing marks: [${missingMarks.join(", ")}], forbidden nodes: [${forbidden.join(", ")}]`);
  failures += 1;
}

for (const name of FIXTURES) {
  const path = join(HERE, "fixtures", name);
  let input: string;
  try {
    input = readFileSync(path, "utf8");
  } catch (e) {
    console.error(`FAIL ${name}: cannot read fixture — ${e instanceof Error ? e.message : String(e)}`);
    failures += 1;
    continue;
  }
  // The captured fixtures are LF-only. Git's -text attribute keeps them that
  // way; a stray CR would be a real corruption and must be reported, not fixed.
  const output = serializeMarkdown(parseMarkdown(input));
  const equal = Buffer.from(input, "utf8").equals(Buffer.from(output, "utf8"));
  console.log(`${equal ? "PASS" : "FAIL"} ${name}: in=${Buffer.byteLength(input, "utf8")}B out=${Buffer.byteLength(output, "utf8")}B chars=${input.length}/${output.length}`);
  if (!equal) {
    console.error(charDiff(input, output));
    failures += 1;
  }
}

if (failures > 0) {
  console.error(`ROUND-TRIP FAILED — ${failures} fixture(s) differ`);
  process.exit(1);
}
console.log(`ROUND-TRIP OK — ${FIXTURES.length} fixtures, 0 diffs`);
