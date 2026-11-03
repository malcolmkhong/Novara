// ---------------------------------------------------------------------------
// Novara AI — wizard text parsers.
// The "New with the AI team" wizard keeps cast/outline as editable text;
// on Create these canonical line formats are parsed back into structured
// rows for the novels API. Parsing is deliberately tolerant: a line that
// does not match the canonical shape still survives (as a bare name or
// title) so no user-edited content is silently dropped.
// ---------------------------------------------------------------------------

export interface ParsedCharacter {
  name: string;
  role: string;
  description: string;
}

export interface ParsedBeat {
  title: string;
  summary: string;
}

const NAME_MAX = 120;
const ROLE_MAX = 200;
const DESC_MAX = 2000;
const TITLE_MAX = 200;
const SUMMARY_MAX = 2000;

const clamp = (s: string, max: number): string => {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/** "Name (role): description" — extracts a parenthesised role if present. */
function extractParenRole(namePart: string): {
  name: string;
  role: string;
} {
  const match = namePart.match(/^(.*?)\s*\(([^()]{1,60})\)\s*:?\s*$/);
  if (!match) return { name: namePart, role: "" };
  return { name: match[1].trim(), role: match[2].trim() };
}

/**
 * Parses cast text. Canonical line: `Name — role: description`.
 * Also tolerated: `Name (role): description`, `Name: description`,
 * `Name - role: description` (plain hyphen), bare `Name`.
 */
export function parseCastLines(text: string): ParsedCharacter[] {
  const out: ParsedCharacter[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/^[-*•]\s*/, "");
    if (!line) continue;

    let name = "";
    let rest = "";

    // Split on em/en dash first (canonical), then a plain " - " hyphen.
    const dashMatch = line.match(/^(.+?)\s*[—–]\s*(.+)$/);
    const hyphenMatch = line.match(/^(.+?)\s-\s(.+)$/);
    if (dashMatch) {
      name = dashMatch[1].trim();
      rest = dashMatch[2].trim();
    } else if (hyphenMatch) {
      name = hyphenMatch[1].trim();
      rest = hyphenMatch[2].trim();
    } else {
      name = line;
    }

    let role = "";
    let description = "";

    if (rest) {
      // rest may be "role: description" or just "description".
      const colon = rest.match(/^([^:：]{1,60})[：:]\s*(.+)$/);
      if (colon) {
        role = colon[1].trim();
        description = colon[2].trim();
      } else {
        description = rest;
      }
    } else {
      // No dash — maybe "Name (role): description" or "Name: description".
      const paren = extractParenRole(line);
      name = paren.name;
      role = paren.role;
      if (!role) {
        const colon = line.match(/^([^:：]{1,60})[：:]\s*(.+)$/);
        if (colon) {
          name = colon[1].trim();
          description = colon[2].trim();
        }
      }
    }

    if (!name) continue;
    out.push({
      name: clamp(name, NAME_MAX),
      role: clamp(role, ROLE_MAX),
      description: clamp(description, DESC_MAX),
    });
  }
  return out;
}

/**
 * Parses outline beats. Canonical line: `Title: summary`.
 * Also tolerated: leading numbering ("1." "1、" "1)"), "- " bullets,
 * `Title — summary` / `Title - summary`, bare `Title`.
 */
export function parseBeatLines(text: string): ParsedBeat[] {
  const out: ParsedBeat[] = [];
  for (const raw of text.split("\n")) {
    let line = raw.trim().replace(/^[-*•]\s*/, "");
    if (!line) continue;
    // Strip leading numbering: "1." "12、" "3)".
    line = line.replace(/^\d+\s*[.、)）]\s*/, "").trim();
    if (!line) continue;

    let title = line;
    let summary = "";

    const colon = line.match(/^([^:：]{1,200}?)[：:]\s*(.+)$/);
    const dash = line.match(/^(.+?)\s*[—–]\s*(.+)$/);
    if (colon) {
      title = colon[1].trim();
      summary = colon[2].trim();
    } else if (dash) {
      title = dash[1].trim();
      summary = dash[2].trim();
    }

    if (!title) continue;
    out.push({
      title: clamp(title, TITLE_MAX),
      summary: clamp(summary, SUMMARY_MAX),
    });
  }
  return out;
}
