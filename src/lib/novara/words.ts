// CJK-aware word count.
// Counts CJK characters individually plus whitespace-delimited
// latin/numeric words, which matches how web novel platforms
// typically report length for mixed-language manuscripts.

const CJK_RANGE =
  /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/g;

export function countWords(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(CJK_RANGE) || []).length;
  const latinWords = text
    .replace(CJK_RANGE, " ")
    .split(/\s+/)
    .filter((w) => /[A-Za-z0-9]/.test(w)).length;
  return cjk + latinWords;
}

export function formatWordCount(n: number): string {
  return n.toLocaleString("en-US");
}
