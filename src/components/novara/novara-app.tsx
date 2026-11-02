"use client";

import { useCallback } from "react";
import { useHashRoute } from "@/hooks/use-hash-route";
import { enterGuestSession } from "@/lib/novara/session";
import { Navbar } from "./navbar";
import { Footer } from "./footer";
import { HomePage } from "./marketing/home";
import { ProductPage } from "./marketing/product";
import { PlansPage } from "./marketing/plans";
import { AboutPage } from "./marketing/about";
import { LegalPage } from "./marketing/legal";
import { WriterApp } from "./writer/writer-app";

export function NovaraApp() {
  const { route, navigate } = useHashRoute();

  const enterWriter = useCallback(() => {
    enterGuestSession();
    navigate("writer");
  }, [navigate]);

  if (route === "writer") {
    return <WriterApp onExit={() => navigate("home")} />;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar route={route} onEnterWriter={enterWriter} />
      <main className="flex-1">
        {route === "home" && <HomePage onEnterWriter={enterWriter} />}
        {route === "product" && <ProductPage onEnterWriter={enterWriter} />}
        {route === "plans" && <PlansPage onEnterWriter={enterWriter} />}
        {route === "about" && <AboutPage onEnterWriter={enterWriter} />}
        {route === "terms" && <LegalPage kind="terms" />}
        {route === "privacy" && <LegalPage kind="privacy" />}
      </main>
      <Footer onEnterWriter={enterWriter} />
    </div>
  );
}
