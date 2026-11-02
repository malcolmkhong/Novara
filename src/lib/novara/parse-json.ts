// ---------------------------------------------------------------------------
// Novara AI — tolerant JSON extraction from model output (pure, no I/O).
// Split out of ai-json.ts so the QC eval probes can exercise it directly.
// ---------------------------------------------------------------------------

import { jsonrepair } from "jsonrepair";

/** Extracts the first JSON object/array from model output (tolerates fences). */
export function parseLooseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error("No JSON found in AI output");
  const slice = candidate.slice(start).trim();

  try {
    return JSON.parse(slice);
  } catch {
    // Repair pass: fixes unescaped quotes, trailing commas, etc.
    const repaired = jsonrepair(slice);
    return JSON.parse(repaired);
  }
}
