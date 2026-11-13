"use client";

// ---------------------------------------------------------------------------
// The site header.
//
// Three behaviours beyond the basics: it retreats when the reader scrolls
// down and returns the moment they scroll up, it carries a hairline scroll
// progress bar, and the active destination is marked with an indicator that
// slides between items rather than blinking on and off.
// ---------------------------------------------------------------------------

import { AnimatePresence, motion, useScroll, useSpring } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BRAND, NAV_LINKS } from "@/config/novara";
import { BrandMark } from "./brand-logo";
import type { SiteRoute } from "@/hooks/use-hash-route";
import { cn } from "@/lib/utils";
import { EASE_OUT_EXPO } from "./marketing/motion";

interface NavbarProps {
  route: SiteRoute;
  onEnterWriter: () => void;
}

export function Navbar({ route, onEnterWriter }: NavbarProps) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);

  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 30,
    restDelta: 0.001,
  });

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 8);
      // A scroll event also fires when the position has not actually moved
      // (keyboard paging, momentum settling). Reacting to those would flip
      // the header back into view at the end of a jump, so only a genuine
      // change of position updates the direction.
      if (y === lastY.current) return;
      setHidden(y > 140 && y > lastY.current);
      lastY.current = y;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const hrefFor = (r: string) => (r === "home" ? "#/" : `#/${r}`);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full border-b transition-[transform,background-color,border-color] duration-300",
        hidden ? "-translate-y-full" : "translate-y-0",
        scrolled
          ? "border-border/80 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/80"
          : "border-transparent bg-background/60 backdrop-blur supports-[backdrop-filter]:bg-background/50",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <a
          href="#/"
          className="group flex items-center gap-2.5"
          aria-label={`${BRAND.name} home`}
        >
          <span className="flex h-9 w-9 items-center justify-center transition-transform duration-300 group-hover:scale-105">
            <BrandMark className="h-8 w-8" />
          </span>
          <span className="font-display text-xl font-bold tracking-tight">
            {BRAND.name}
          </span>
        </a>

        <nav aria-label="Main navigation" className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => {
            const active = route === link.route;
            return (
              <a
                key={link.route}
                href={hrefFor(link.route)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="navbar-active"
                    className="absolute inset-0 rounded-md bg-accent"
                    transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
                  />
                )}
                <span className="relative">{link.label}</span>
              </a>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <Button size="sm" className="sheen" onClick={onEnterWriter}>
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

      <AnimatePresence>
        {open && (
          <motion.nav
            key="mobile-nav"
            aria-label="Mobile navigation"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
            className="overflow-hidden border-t bg-background md:hidden"
          >
            <div className="mx-auto flex max-w-6xl flex-col px-4 py-2">
              {NAV_LINKS.map((link, index) => (
                <motion.a
                  key={link.route}
                  href={hrefFor(link.route)}
                  aria-current={route === link.route ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.28, delay: index * 0.05, ease: EASE_OUT_EXPO }}
                  className={cn(
                    "rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                    route === link.route
                      ? "text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {link.label}
                </motion.a>
              ))}
            </div>
          </motion.nav>
        )}
      </AnimatePresence>

      {/* Reading progress. */}
      <motion.div
        aria-hidden="true"
        style={{ scaleX: progress }}
        className="h-0.5 origin-left bg-gradient-to-r from-primary via-amber-400 to-amber-500"
      />
    </header>
  );
}