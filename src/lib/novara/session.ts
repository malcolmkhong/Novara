// Guest session — a lightweight stand-in for the future authentication
// system. It only records that the visitor entered the AI Writer; it does
// NOT represent an account, a subscription or any permission state.

const GUEST_KEY = "novara.guestSession";

export interface GuestSession {
  enteredAt: string;
}

export function enterGuestSession(): void {
  try {
    localStorage.setItem(
      GUEST_KEY,
      JSON.stringify({ enteredAt: new Date().toISOString() })
    );
  } catch {
    // storage unavailable — guest session is best-effort only
  }
}

export function getGuestSession(): GuestSession | null {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    return raw ? (JSON.parse(raw) as GuestSession) : null;
  } catch {
    return null;
  }
}

export function exitGuestSession(): void {
  try {
    localStorage.removeItem(GUEST_KEY);
  } catch {
    // ignore
  }
}
