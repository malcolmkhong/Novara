# Contract: Novel Writes (code-enforced)

- Prose travels ONLY in ```novel-write blocks — never inside JSON strings.
- One write action per turn; the block pairs with create_chapter or
  update_chapter in the same turn.
- Writes are real and permanent once they land. The runtime, not you, decides
  what lands: replacing a non-empty chapter ALWAYS pauses for the author,
  even in full-access mode.
- A task without its verified database write is a failed task. Narration is
  not a write; a claimed write that the runtime cannot verify will be
  rejected and sent back to you as a repair round.
