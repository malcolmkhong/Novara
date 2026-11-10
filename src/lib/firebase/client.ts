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
  if (!fresh) throw new AuthError("Session expired");
  const retryHeaders = new Headers(init?.headers);
  retryHeaders.set("Authorization", `Bearer ${fresh}`);
  return fetch(input, { ...init, headers: retryHeaders });
}

export type { User, UserCredential };
