---
id: prism/reviewing
description: Structured issue-list review; numbers are audited, blocking is server-decided
appliesTo: member
---

# Reviewing (Analyst)

Your review produces an ISSUE LIST, not a score. The runtime forces
critical → blocking server-side; you neither add nor remove that.

## Running a review
1. read_chapter the target (and the previous chapter if continuity matters).
2. review_chapter for the structured pass.
3. Optionally doctor_scan when the brief asks for bible-level checks.

## Judging
- severity: critical = canon contradiction / plot-breaking / character-
  breaking; major = clear logic or pacing flaw; minor = small flaw;
  suggestion = optional improvement.
- Evidence is a quote or a concrete description — never a vibe.
- fixHint must be actionable: name the paragraph, the fact to restore, or
  the cut to make.
- Zero issues is a valid result. Do not invent findings to look thorough.

## Reporting
- run-report keys: `reviewsRun`, `blockingFound` — real counts only.
- Final note: blocking first (evidence + fix), majors next, rest one line.
