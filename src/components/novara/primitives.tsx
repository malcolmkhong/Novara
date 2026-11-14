// ---------------------------------------------------------------------------
// Novara — cross-area UI primitives.
//
// The marketing pages and the writer workbench are separate areas, but they
// kept spelling the same small affordances out by hand: the loading spinner
// appeared 24 times across 13 files with four different sizes and two
// different shapes (a lucide glyph and a CSS ring). Every copy was a chance
// to drift, and the drift was visible: the same spinner rendered at four
// sizes with two different motion treatments.
//
// This module holds ONLY the primitives that more than one area needs. The
// area-specific kits stay where they are (`marketing/kit.tsx` for the
// marketing layout, `writer/ui-bits.tsx` for the workbench widgets). A
// primitive belongs here once it is used from two directories.
//
// Purely presentational: no state, no effects, no data fetching. A primitive
// here must be safe to drop into any tree without changing behaviour.
// ---------------------------------------------------------------------------

"use client";

import type { ComponentProps, ReactElement, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The loading spinner — one lucide glyph, one size vocabulary.
 *
 * The size scale is deliberately named rather than free-form: `sm` is the
 * inline "busy" indicator next to a control, `md` the one inside a compact
 * row, `lg` the one that replaces a small block's content, and `xl` the one
 * that replaces the composer's send button.
 *
 * A spinner is decorative by default and hidden from assistive tech, because
 * it always sits next to text or an `aria-busy` container that already
 * announces the state; a screen reader reading "loading" twice is noise.
 * Pass `label` when the spinner IS the only indicator — it then becomes an
 * image with an accessible name instead of a hidden decoration.
 */
export function Spinner({
  size = "md",
  label,
  spin = true,
  className,
  ...props
}: Omit<ComponentProps<"svg">, "size"> & {
  size?: "sm" | "md" | "lg" | "xl";
  label?: string;
  spin?: boolean;
}) {
  return (
    <Loader2
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      className={cn(spin && "animate-spin", SPINNER_SIZE[size], className)}
      {...props}
    />
  );
}

/**
 * The CSS-ring spinner — a bordered circle with a transparent leading edge.
 *
 * It reads as a "page is working" indicator rather than a "this control is
 * working" one, so it is used where the whole surface is replaced. `Spinner`
 * is the right choice everywhere else.
 *
 * The ring is decorative: it always sits inside a container that carries the
 * status text, so it is hidden from assistive tech.
 */
export function SpinnerRing({
  size = "md",
  className,
  ...props
}: Omit<ComponentProps<"span">, "size"> & {
  size?: "sm" | "md";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "animate-spin rounded-full border-2 border-primary border-t-transparent",
        RING_SIZE[size],
        className
      )}
      {...props}
    />
  );
}

const SPINNER_SIZE: Record<"sm" | "md" | "lg" | "xl", string> = {
  sm: "size-3",
  md: "size-3.5",
  lg: "size-4",
  xl: "size-4.5",
};

const RING_SIZE: Record<"sm" | "md", string> = {
  sm: "size-5",
  md: "size-6",
};

/**
 * The segmented control's segment — a button that is either on or off.
 *
 * The workbench has four segmented controls (the rail mode, the document
 * view, the editor font size, the mobile view switcher). Each of them was
 * written by hand, and they had drifted: three different active treatments
 * and two different base paddings for the same idea.
 *
 * This primitive holds the *shape* of the control — a `type="button"`
 * element that reports its state through `aria-pressed` and takes the
 * active or the idle class list — and leaves the visual treatment to the
 * caller, because the four controls genuinely differ (one of them carries
 * an icon above its label, another is a text pill).
 */
export function ToggleButton({
  pressed,
  baseClassName,
  activeClassName,
  inactiveClassName,
  children,
  ...props
}: Omit<ComponentProps<"button">, "className"> & {
  pressed: boolean;
  baseClassName: string;
  activeClassName?: string;
  inactiveClassName?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        baseClassName,
        pressed ? activeClassName : inactiveClassName,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * The hover label of an icon-only control.
 *
 * An icon-only button has no visible text, so its name lives in an
 * `aria-label` that a sighted user never sees. This wrapper adds the missing
 * visible half: the same label on hover, in the app's own tooltip styling.
 *
 * The trigger renders the child in place (`asChild`), so the control keeps
 * its own markup, its own focus ring and its own click handling — the
 * tooltip adds no wrapper element around it.
 *
 * The `aria-label` stays on the control: the tooltip describes it, it does
 * not name it.
 */
export function IconTooltip({
  label,
  side = "bottom",
  children,
}: {
  label: string;
  side?: "top" | "right" | "bottom" | "left";
  children: ReactElement<Record<string, unknown>>;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
