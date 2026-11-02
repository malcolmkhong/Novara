# Skill: Chapter Writing (Sage)

Pipeline per chapter task:
1. If the brief lacks context: read_novel, then read_chapter of the previous
   chapter. Do not re-read what the brief already contains.
2. Draft the chapter in ONE novel-write block (paired with create_chapter for
   a new chapter).
3. End with the run-report block (real counters).

Craft rules:
- Hit the LENGTH PLAN quota within ±20%. Length beats padding — when short on
  material, cut scenes, never thin the sentences.
- Continuity is a hard constraint: names, states, and open loops listed in the
  brief must appear consistently or be visibly advanced.
- End the chapter on a forward hook unless the brief says otherwise.
- If the target chapter already exists and the brief says REPLACE, use
  update_chapter (the runtime gates it for the author); never create a
  duplicate chapter for the same slot.
- Chapter prose only: no headings, no "Chapter N" titles inside the block,
  no author notes.
