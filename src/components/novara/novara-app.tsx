"use client";

import { useCallback, useEffect, useState } from "react";
import { useHashRoute } from "@/hooks/use-hash-route";
import { Navbar } from "./navbar";
import { Footer } from "./footer";
import { HomePage } from "./marketing/home";
import { ProductPage } from "./marketing/product";
import { PlansPage } from "./marketing/plans";
import { AboutPage } from "./marketing/about";
import { LegalPage } from "./marketing/legal";
import { WriterApp } from "./writer/writer-app";
import { useToast } from "@/hooks/use-toast";
import {
  getFirebaseAuth,
  onAuthFailure,
  signInWithGoogle,
  type User,
} from "@/lib/firebase/client";
import { onAuthStateChanged } from "firebase/auth";

type AuthState = "loading" | "signed-out" | "signed-in";

export function NovaraApp() {
  const { route, navigate } = useHashRoute();
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [signingIn, setSigningIn] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const unsub = onAuthStateChanged(getFirebaseAuth(), (u) => {
      setAuthState(u ? "signed-in" : "signed-out");
    });
    return () => unsub();
  }, []);

  // One visible signal when the server rejects our credentials. Without it a
  // failed request just empties the panel that made it, and the user is left
  // staring at an empty box with no idea why.
  useEffect(
    () =>
      onAuthFailure(() => {
        toast({
          title: "Session expired",
          description: "Sign in again to continue.",
        });
      }),
    [toast],
  );

  const enterWriter = useCallback(async () => {
    if (authState !== "signed-in") {
      setSigningIn(true);
      try {
        await signInWithGoogle();
      } catch {
        setSigningIn(false);
        return;
      }
      setSigningIn(false);
    }
    navigate("writer");
  }, [authState, navigate]);

  // Public branch: marketing pages render for everyone, no auth check.
  if (route !== "writer") {
    return (
      <div className="flex min-h-screen flex-col">
        <Navbar route={route} onEnterWriter={() => void enterWriter()} />
        <main className="flex-1">
          {route === "home" && <HomePage onEnterWriter={() => void enterWriter()} />}
          {route === "product" && <ProductPage onEnterWriter={() => void enterWriter()} />}
          {route === "plans" && <PlansPage onEnterWriter={() => void enterWriter()} />}
          {route === "about" && <AboutPage onEnterWriter={() => void enterWriter()} />}
          {route === "terms" && <LegalPage kind="terms" />}
          {route === "privacy" && <LegalPage kind="privacy" />}
        </main>
        <Footer onEnterWriter={() => void enterWriter()} />
      </div>
    );
  }

  // Protected branch: writer route requires sign-in.
  if (authState === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (authState === "signed-out") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
        <h1 className="font-display text-3xl font-bold">Novara AI</h1>
        <p className="text-muted-foreground">Sign in to start writing.</p>
        <button
          type="button"
          onClick={() => void enterWriter()}
          disabled={signingIn}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
        >
          {signingIn ? "Signing in…" : "Continue with Google"}
        </button>
      </div>
    );
  }

  return <WriterApp onExit={() => navigate("home")} />;
}
