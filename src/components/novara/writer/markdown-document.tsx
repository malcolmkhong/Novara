"use client";

// ---------------------------------------------------------------------------
// Novara AI — MarkdownDocument: shared markdown renderer for "document
// window" views (chapter preview, bible cards, outline summaries).
// Pairs with the `.novara-prose` reading styles in globals.css.
// ---------------------------------------------------------------------------

import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

export function MarkdownDocument({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  if (!content?.trim()) return null;
  return (
    <div className={cn("novara-prose", className)}>
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}
