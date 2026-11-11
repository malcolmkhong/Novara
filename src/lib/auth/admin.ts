// ---------------------------------------------------------------------------
// Novara AI — admin allowlist (ONE place).
//
// The middleware asks this module whether the verified Firebase `sub` is an
// admin; the credit ledger asks it whether a user is exempt from credit
// deduction. The list itself lives in exactly one place (ADMIN_UIDS) and is
// never duplicated — a second copy would drift and quietly widen access.
//
// The rule is unchanged from the inline version this replaced: a
// comma-separated list of Firebase UIDs, whitespace-trimmed, empty entries
// dropped, exact string match.
// ---------------------------------------------------------------------------

/** The configured admin uids (comma-separated in ADMIN_UIDS). */
export function adminUids(): string[] {
  return (process.env.ADMIN_UIDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Is this uid an admin? */
export function isAdminUid(uid: string): boolean {
  if (!uid) return false;
  return adminUids().includes(uid);
}
