"use client";

import { useState } from "react";
import { Menu, PenLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BRAND, NAV_LINKS } from "@/config/novara";
import type { SiteRoute } from "@/hooks/use-hash-route";
import { cn } from "@/lib/utils";

interface NavbarProps {
  route: SiteRoute;
  onEnterWriter: () => void;
}

export function Navbar({ route, onEnterWriter }: NavbarProps) {
  const [open, setOpen] = useState(false);

  const hrefFor = (r: string) => (r === "home" ? "#/" : `#/${r}`);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <a
          href="#/"
          className="flex items-center gap-2.5"
          aria-label={`${BRAND.name} home`}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <PenLine className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
          <span className="font-display text-xl font-bold tracking-tight">
            {BRAND.name}
          </span>
        </a>

        <nav aria-label="Main navigation" className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.route}
              href={hrefFor(link.route)}
              aria-current={route === link.route ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                route === link.route
                  ? "text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={onEnterWriter}>
            Login
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {open && (
        <nav
          aria-label="Mobile navigation"
          className="border-t bg-background md:hidden"
        >
          <div className="mx-auto flex max-w-6xl flex-col px-4 py-2">
            {NAV_LINKS.map((link) => (
              <a
                key={link.route}
                href={hrefFor(link.route)}
                aria-current={route === link.route ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={cn(
                  "rounded-md px-3 py-2.5 text-sm font-medium",
                  route === link.route
                    ? "text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                {link.label}
              </a>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
