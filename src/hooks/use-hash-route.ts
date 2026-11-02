// ---------------------------------------------------------------------------
// Novara AI — hash router.
// The sandbox preview only exposes the "/" route, so the whole site
// (Home / Product / Plans / About / Terms / Privacy / Writer) lives on one
// page and switches views via location.hash. In a real deployment this can
// be swapped for App Router routes without touching page components.
// ---------------------------------------------------------------------------

"use client";

import { useCallback, useEffect, useState } from "react";

export type SiteRoute =
  | "home"
  | "product"
  | "plans"
  | "about"
  | "terms"
  | "privacy"
  | "writer";

const KNOWN_ROUTES: SiteRoute[] = [
  "home",
  "product",
  "plans",
  "about",
  "terms",
  "privacy",
  "writer",
];

export function parseHash(hash: string): SiteRoute {
  const cleaned = hash.replace(/^#\/?/, "").replace(/\/+$/, "");
  if (!cleaned) return "home";
  return (KNOWN_ROUTES as string[]).includes(cleaned)
    ? (cleaned as SiteRoute)
    : "home";
}

export function routeToHash(route: SiteRoute): string {
  return route === "home" ? "#/" : `#/${route}`;
}

export function useHashRoute() {
  const [route, setRoute] = useState<SiteRoute>("home");

  useEffect(() => {
    const apply = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo({ top: 0 });
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  const navigate = useCallback((next: SiteRoute) => {
    const target = routeToHash(next);
    if (window.location.hash === target) {
      window.scrollTo({ top: 0 });
      return;
    }
    window.location.hash = target;
  }, []);

  return { route, navigate };
}
