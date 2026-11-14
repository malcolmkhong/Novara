"use client";

// ---------------------------------------------------------------------------
// Shared marketing kit.
//
// The marketing pages used to spell the same three things out by hand in every
// file: the page-width container, the centered section heading block and the
// rounded icon tile. Each copy drifted a little (a missing `mt-2`, a different
// icon tint), which is exactly the kind of drift a shared kit removes.
//
// This module only holds layout primitives. It deliberately does not hold
// page content — that stays in the page files.
// ---------------------------------------------------------------------------

import type { ReactNode } from "react";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Reveal } from "./motion";
import { TEXT_LABEL } from "@/components/novara/styles";

/** The page-width content container used by every marketing section. */
export const CONTAINER = "mx-auto max-w-6xl px-4 sm:px-6";

/** The page-width content container used by every marketing section. */
export function Container({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return <div className={cn(CONTAINER, className)}>{children}</div>;
}

/**
 * The centered heading block that opens a marketing section.
 *
 * `headingSpacing` controls the gap above the heading: "default" keeps the
 * small offset used by most sections, "flush" drops it for sections that open
 * with the heading alone.
 */
export function SectionIntro({
  eyebrow,
  title,
  description,
  headingId,
  headingSpacing = "default",
  reveal = true,
  descriptionClassName,
  className,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  headingId?: string;
  headingSpacing?: "default" | "flush";
  reveal?: boolean;
  descriptionClassName?: string;
  className?: string;
  children?: ReactNode;
}) {
  const body = (
    <>
      {eyebrow && (
        <p className={cn(TEXT_LABEL, "uppercase tracking-wide text-primary")}>
          {eyebrow}
        </p>
      )}
      <h2
        id={headingId}
        className={cn(
          headingSpacing === "default" && "mt-2",
          "font-display text-3xl font-bold tracking-tight sm:text-4xl",
        )}
      >
        {title}
      </h2>
      {description && (
        <p className={cn("mt-4 text-muted-foreground", descriptionClassName)}>
          {description}
        </p>
      )}
      {children}
    </>
  );

  return (
    <div className={cn("mx-auto max-w-2xl text-center", className)}>
      {reveal ? <Reveal>{body}</Reveal> : body}
    </div>
  );
}

/** The rounded icon tile that fronts a feature card. */
export const ICON_SQUARE =
  "flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary";

/** The warm-tinted icon tile used by the product page feature cards. */
export const ICON_SQUARE_ACCENT =
  "flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-900";

/** The primary call to action, shared by the hero and the closing strip. */
export function StartCreatingButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="lg" className="sheen group" onClick={onClick}>
      Start Creating
      <ArrowRight
        className="size-4 transition-transform duration-300 group-hover:translate-x-1"
        aria-hidden="true"
      />
    </Button>
  );
}

/** The check mark that fronts a feature list entry. */
export const CHECK_ICON = "mt-0.5 size-4 shrink-0 text-primary";

/**
 * A list of short feature lines, each marked with a check.
 *
 * The plans, pricing and product pages all render the same check-marked
 * bullet, differing only in the gap of the row and the tint of the text.
 */
export function FeatureList({
  items,
  className,
  itemClassName,
  textClassName,
}: {
  items: readonly string[];
  className?: string;
  itemClassName?: string;
  textClassName?: string;
}) {
  return (
    <ul className={className}>
      {items.map((item) => (
        <li key={item} className={cn("flex items-start gap-2", itemClassName)}>
          <Check className={CHECK_ICON} aria-hidden="true" />
          <span className={textClassName}>{item}</span>
        </li>
      ))}
    </ul>
  );
}
