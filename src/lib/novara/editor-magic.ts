/**
 * STEP 78 - the four "Magic" transforms.
 *
 * Pure, deterministic and offline: no AI, no credits, no network. Every
 * transform takes ONLY the selected text and returns the replacement text.
 * The toolbar inserts the result in ONE ProseMirror transaction, so each
 * action is a single undo step and never rewrites the whole document.
 */
export type MagicAction = "quotes" | "spacing" | "paragraphs" | "dialogue";

/** Straight quotes -> paired curly quotes; -- -> em dash; ... -> ellipsis. */
function fixQuotesAndDashes(text: string): string {
  let opening = true;
  return text
    .replace(/\.\.\./g, "\u2026")
    .replace(/--/g, "\u2014")
    .replace(/"/g, () => {
      const quote = opening ? "\u201C" : "\u201D";
      opening = !opening;
      return quote;
    });
}

/** Collapse runs of spaces/tabs and remove a space before punctuation. */
function cleanSpacing(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.;:!?,。，；：！？、)）\]】])/g, "$1");
}

/** A wall of text becomes one paragraph per sentence. */
function splitIntoParagraphs(text: string): string {
  const marked = text
    .replace(/([。！？!?；;])\s*/g, "$1\u0000")
    .replace(/\.\s+(?=\S)/g, ".\u0000");
  return marked
    .split("\u0000")
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Selection -> a quoted line followed by an em dash for the attribution. */
function wrapAsDialogue(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((line) => line.replace(/\n/g, " ").trim())
    .filter(Boolean)
    .map((line) => `\u201C${line}\u201D \u2014 `)
    .join("\n\n");
}

export function applyMagic(action: MagicAction, selection: string): string {
  switch (action) {
    case "quotes":
      return fixQuotesAndDashes(selection);
    case "spacing":
      return cleanSpacing(selection);
    case "paragraphs":
      return splitIntoParagraphs(selection);
    case "dialogue":
      return wrapAsDialogue(selection);
  }
}
