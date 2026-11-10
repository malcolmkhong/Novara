#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// Phase 1 verification — authFetch must attach the Firebase ID token.
//
// This is the ONE shared helper both fixed call sites now use
// (src/lib/firebase/client.ts). It is exercised with a stubbed Firebase auth
// so the assertions are about OUR wrapper, not about the network:
//
//   1. a normal request carries `Authorization: Bearer <idToken>`
//   2. the caller's init (cache, method, body…) is preserved verbatim
//   3. a 401 triggers exactly ONE refresh + retry with the fresh token
//   4. no signed-in user -> AuthError, and NO request is sent
//
// Written as .mjs on purpose: tsconfig only includes **/*.ts, so this file is
// not part of the `tsc --noEmit` surface (the project has no test runner
// installed, so this is the test harness).
//
// Run:  bun scripts/verify-auth-fetch.mjs
// ---------------------------------------------------------------------------

import { mock } from "bun:test";

let currentUser = { getIdToken: async (force) => (force ? "fresh-token" : "test-id-token") };

mock.module("firebase/app", () => ({
  initializeApp: () => ({ name: "[DEFAULT]" }),
  getApps: () => [{ name: "[DEFAULT]" }],
  getApp: () => ({ name: "[DEFAULT]" }),
}));

mock.module("firebase/auth", () => ({
  // A getter, not a snapshot: the module caches the auth object, so
  // `currentUser` must be read live for the signed-out case below.
  getAuth: () => ({ get currentUser() { return currentUser; } }),
  GoogleAuthProvider: class {},
  signInWithPopup: async () => ({}),
  signOut: async () => {},
}));

const { authFetch, AuthError } = await import("../src/lib/firebase/client.ts");

// ---- capture every outgoing request --------------------------------------
const calls = [];
let nextStatus = 200;
globalThis.fetch = async (input, init) => {
  calls.push({ url: String(input), init });
  return new Response("{}", { status: nextStatus });
};

let failures = 0;
function check(label, cond, detail) {
  if (cond) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// --- 1 & 2: the token is attached and init is preserved -------------------
calls.length = 0;
const init = { cache: "no-store", method: "POST", body: "x" };
const res = await authFetch("/api/agent/runs?novelId=abc", init);

check("one request was sent", calls.length === 1, `got ${calls.length}`);
const sent = calls[0];
const headers = new Headers(sent.init.headers);
check(
  "Authorization: Bearer <idToken> is attached",
  headers.get("Authorization") === "Bearer test-id-token",
  `got ${JSON.stringify(headers.get("Authorization"))}`,
);
check("url is unchanged", sent.url === "/api/agent/runs?novelId=abc", sent.url);
check("cache is preserved", sent.init.cache === "no-store", String(sent.init.cache));
check("method is preserved", sent.init.method === "POST", String(sent.init.method));
check("body is preserved", sent.init.body === "x", String(sent.init.body));
check("response is returned to the caller", res.status === 200, String(res.status));

// --- 3: a 401 triggers exactly one refresh + retry ------------------------
calls.length = 0;
nextStatus = 401;
await authFetch("/api/usage/invoice");
check("401 triggered a retry", calls.length === 2, `got ${calls.length} calls`);
if (calls.length === 2) {
  const first = new Headers(calls[0].init.headers).get("Authorization");
  const second = new Headers(calls[1].init.headers).get("Authorization");
  check("first attempt uses the cached token", first === "Bearer test-id-token", String(first));
  check("retry uses the refreshed token", second === "Bearer fresh-token", String(second));
}
nextStatus = 200;

// --- 4: no signed-in user -> AuthError, nothing sent ----------------------
calls.length = 0;
currentUser = null;
let threw = null;
try {
  await authFetch("/api/team/turns");
} catch (err) {
  threw = err;
}
check("throws AuthError when signed out", threw instanceof AuthError, String(threw));
check("no request is sent when signed out", calls.length === 0, `got ${calls.length}`);

console.log("");
if (failures === 0) {
  console.log("ALL CHECKS PASSED");
  process.exit(0);
}
console.log(`${failures} CHECK(S) FAILED`);
process.exit(1);
