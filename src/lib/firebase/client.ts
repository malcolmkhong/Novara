// ---------------------------------------------------------------------------
// Novara AI — Firebase client SDK (browser only).
//
// Public config only — these are identifiers, not secrets. Every value comes
// from NEXT_PUBLIC_FIREBASE_* env vars so the same code works in every
// environment without edits.
// ---------------------------------------------------------------------------

import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  type Auth,
  type User,
  type UserCredential,
} from "firebase/auth";

/** Public config, read from NEXT_PUBLIC_* (inlined at build time by Next). */
function readFirebaseConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || undefined,
  };
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

/** Lazy singleton — safe against double-init in dev (HMR / StrictMode). */
export function getFirebaseApp(): FirebaseApp {
  if (app) return app;
  const existing = getApps();
  app = existing.length > 0 ? getApp() : initializeApp(readFirebaseConfig());
  return app;
}

export function getFirebaseAuth(): Auth {
  if (auth) return auth;
  auth = getAuth(getFirebaseApp());
  return auth;
}

export async function signInWithGoogle(): Promise<UserCredential> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return signInWithPopup(getFirebaseAuth(), provider);
}

export async function signOutUser(): Promise<void> {
  await firebaseSignOut(getFirebaseAuth());
}

export async function getIdToken(forceRefresh = false): Promise<string> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error("Not signed in");
  return user.getIdToken(forceRefresh);
}

export async function getIdTokenOrNull(): Promise<string | null> {
  const user = getFirebaseAuth().currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch {
    return null;
  }
}

export class AuthError extends Error {
  constructor(message = "Not signed in") {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * A credit refusal (HTTP 402): the caller cannot pay for this call.
 *
 * The server sends { error: "insufficient_credits", need, balance, resetAt }
 * — before this class the UI only saw the raw code string in a toast. Now
 * the refusal is identifiable: a UI can show how much is needed, what is
 * left and when it resets.
 *
 * NOT the same class as the server-side CreditError in @/lib/credits/charge:
 * that one never crosses the wire, this one is built from the response body.
 */
export class CreditError extends Error {
  /** Credits the call needs. */
  readonly need: number;
  /** Credits the account has. */
  readonly balance: number;
  /** ISO timestamp of the next lazy daily reset. */
  readonly resetAt: string;

  constructor(
    message: string,
    need: number,
    balance: number,
    resetAt: string,
  ) {
    super(message);
    this.name = "CreditError";
    this.need = need;
    this.balance = balance;
    this.resetAt = resetAt;
  }
}

/**
 * The global kill switch is on (HTTP 429): every non-admin AI spend is
 * paused until the world's daily spend falls back under the cap.
 */
export class GloballyPausedError extends Error {
  constructor(message = "globally_paused") {
    super(message);
    this.name = "GloballyPausedError";
  }
}

/**
 * Turn a credit-flavoured response into a typed error, or null when the
 * response is not a credit refusal.
 *
 * 402 → CreditError (need / balance / resetAt)
 * 429 + "globally_paused" → GloballyPausedError
 */
export function parseCreditError(status: number, body: unknown): Error | null {
  const payload = (body ?? {}) as {
    error?: unknown;
    need?: unknown;
    balance?: unknown;
    resetAt?: unknown;
  };
  if (status === 429 && payload.error === "globally_paused") {
    return new GloballyPausedError();
  }
  if (status !== 402) return null;
  return new CreditError(
    typeof payload.error === "string" ? payload.error : "insufficient_credits",
    typeof payload.need === "number" ? payload.need : 0,
    typeof payload.balance === "number" ? payload.balance : 0,
    typeof payload.resetAt === "string" ? payload.resetAt : "",
  );
}

/**
 * Centralised fetch wrapper. Attaches `Authorization: Bearer <idToken>` and
 * refreshes the token once on a 401 before retrying. Throws `AuthError` when
 * there is no signed-in user.
 */
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = await getIdTokenOrNull();
  if (!token) throw new AuthError();

  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);

  let res = await fetch(input, { ...init, headers });
  if (res.status !== 401) return res;

  // Refresh once and retry.
  let fresh: string | null = null;
  try {
    fresh = await getIdToken(true);
  } catch {
    fresh = null;
  }
  if (!fresh) {
    notifyAuthFailure();
    throw new AuthError("Session expired");
  }
  const retryHeaders = new Headers(init?.headers);
  retryHeaders.set("Authorization", `Bearer ${fresh}`);
  const retried = await fetch(input, { ...init, headers: retryHeaders });
  // The server still says 401 after a fresh token: this is not a transient
  // expiry, so say so out loud instead of letting the panel go quietly empty.
  if (retried.status === 401) notifyAuthFailure();
  return retried;
}

// ---------------------------------------------------------------------------
// Auth-failure notification
// ---------------------------------------------------------------------------

type AuthFailureListener = () => void;
const authFailureListeners = new Set<AuthFailureListener>();

/**
 * Subscribe to "the server rejected our credentials".
 *
 * `authFetch` RETURNS a 401 response when the token could not be refreshed
 * (it does not throw), so any caller that swallows failures — most of the
 * best-effort panels do — sees nothing at all: the panel just empties. That
 * is precisely how the two client-side auth bugs stayed invisible for so
 * long. This is the ONE place that turns that silence into a visible signal,
 * for every call site, present and future.
 */
export function onAuthFailure(listener: AuthFailureListener): () => void {
  authFailureListeners.add(listener);
  return () => {
    authFailureListeners.delete(listener);
  };
}

function notifyAuthFailure(): void {
  for (const listener of authFailureListeners) {
    try {
      listener();
    } catch {
      // a broken listener must never break the request it was watching
    }
  }
}

export type { User, UserCredential };
