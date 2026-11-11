import { jsonError } from "@/lib/novara/api-helpers";
import { reviewChapter } from "@/lib/novara/review";
import { CreditError } from "@/lib/credits/charge";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

type Params = { params: Promise<{ id: string }> };

// POST /api/chapters/[id]/review — author-facing thin shell over the shared
// review core (lib/novara/review.ts). The same core powers the Prism agent
// tool (Phase 5) — one implementation, two callers.
export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const result = await reviewChapter(id);
    return Response.json({
      chapterId: result.chapterId,
      issues: result.issues,
      reviewedAt: result.reviewedAt,
      mock: false,
    });
  } catch (error) {
    // Step 57 — a credit refusal keeps its status and its payload.
    if (error instanceof CreditError) {
      return Response.json(error.payload, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown AI service error";
    const status = message === "Chapter not found" ? 404 : message === "Chapter has no content to review" ? 422 : 502;
    return jsonError(`AI review failed: ${message}`, status);
  }
}
