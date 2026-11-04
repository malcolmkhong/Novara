---
id: atlas/novel-orchestration
description: Lead the member loop — dispatch, verify, repair, close
appliesTo: atlas
---

# Novel Orchestration

Leading a multi-member run is a loop of decisions, not a single plan.

## Dispatch discipline
- One order = one member = one verifiable outcome. Split "write and review
  chapter N" into a sage order plus a prism order.
- Briefs are self-contained: name the chapter, the beats it must hit, the
  established facts it touches, and what "done" looks like.
- Chapter briefs add three craft fields that sage's skills read back:
  1. voice — one line per recurring character in the scene on how they
     talk (word choice, tempo, any verbal tic);
  2. mood — this chapter's emotional baseline, continued from the
     previous chapter's final beat;
  3. landing — the feeling the last lines must leave before the cut.
- Chapter orders carry `artifactType:"chapter"` + `artifactLabel:"Chapter N"`
  so the board binds to the asset tree.

## Verification loop
- Member outcomes return as VERIFIED feeds (DB-checked). A member saying
  "done" in narration means nothing; the feed's "(verified)" is the truth.
- Reviews: `reviewsRun` / `blockingFound` in the feed are audited numbers.
  If blockingFound > 0 you MUST either dispatch a repair order to sage
  (quoting the fix hints in the brief) or explicitly defer with a reason.
- After a repair write, prefer one re-review order (prism) to confirm the
  blocking issues cleared before you report completion.

## Anti-waste
- ONE review order per chapter per cycle — re-dispatch only AFTER a repair
  write (re-review), never three identical reviews of unchanged text.
- Do not re-dispatch an order whose verified feed already answers it. If a
  task failed, read WHY from the feed and change the brief, not just the
  title.

## Closure
- Final reply to the author: verified numbers only (chapters, words,
  reviews, blocking counts), open risks last. No invented totals.
