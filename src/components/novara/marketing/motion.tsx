"use client";

// ---------------------------------------------------------------------------
// Shared motion primitives for the marketing pages.
//
// Everything here degrades to a static end state when the visitor has
// prefers-reduced-motion enabled. framer-motion's useReducedMotion() covers
// the JS-driven animations; the CSS guard in globals.css covers the
// keyframe-driven ones.
// ---------------------------------------------------------------------------

import {
  animate,
  motion,
  useInView,
  useReducedMotion,
  type Variants,
} from "framer-motion";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

/** Exponential-out. Fast departure, long settle — reads as "considered". */
export const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];
/** Softer, for elements that should feel gentle rather than decisive. */
export const EASE_OUT_SOFT: [number, number, number, number] = [0.32, 0.72, 0, 1];

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 26 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.72, ease: EASE_OUT_EXPO },
  },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.6, ease: EASE_OUT_SOFT } },
};

// ---------------------------------------------------------------------------
// Reveal — fade and rise as the element enters the viewport.
// ---------------------------------------------------------------------------

export function Reveal({
  children,
  className,
  delay = 0,
  y = 26,
  duration = 0.72,
  amount = 0.25,
  once = true,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  duration?: number;
  amount?: number;
  once?: boolean;
}) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, amount }}
      transition={{ duration, delay, ease: EASE_OUT_EXPO }}
    >
      {children}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Stagger / StaggerItem — a parent that reveals its children in sequence.
// ---------------------------------------------------------------------------

export function Stagger({
  children,
  className,
  delay = 0,
  gap = 0.09,
  amount = 0.15,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  gap?: number;
  amount?: number;
}) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount }}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: gap, delayChildren: delay } },
      }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
  y = 22,
}: {
  children: ReactNode;
  className?: string;
  y?: number;
}) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: reduce ? 0 : y },
        show: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.68, ease: EASE_OUT_EXPO },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// MaskLine — a headline line that slides up out of a clipping mask.
//
// The caller supplies explicit line breaks rather than letting the browser
// wrap, because a mask only reads correctly when the line is known.
// ---------------------------------------------------------------------------

export function MaskLine({
  children,
  delay = 0,
  duration = 0.9,
  className,
}: {
  children: ReactNode;
  delay?: number;
  duration?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();

  return (
    <span className={cn("block overflow-hidden pb-[0.1em]", className)}>
      <motion.span
        className="block will-change-transform"
        initial={reduce ? { y: 0 } : { y: "112%" }}
        animate={{ y: 0 }}
        transition={{ duration, delay, ease: EASE_OUT_EXPO }}
      >
        {children}
      </motion.span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// CountUp — a number that counts to its value the first time it is seen.
// ---------------------------------------------------------------------------

export function CountUp({
  to,
  duration = 1.9,
  format,
  className,
}: {
  to: number;
  duration?: number;
  format?: (value: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduce = useReducedMotion();
  const [value, setValue] = useState(0);

  useEffect(() => {
    // With reduced motion the final value is rendered directly below, so
    // there is nothing to animate and nothing to set here.
    if (!inView || reduce) return;
    const controls = animate(0, to, {
      duration,
      ease: EASE_OUT_EXPO,
      onUpdate: (latest) => setValue(latest),
    });
    return () => controls.stop();
  }, [inView, to, duration, reduce]);

  const shown = reduce ? to : value;

  return (
    <span ref={ref} className={className}>
      {format
        ? format(shown)
        : Math.round(shown).toLocaleString("en-US")}
    </span>
  );
}

// ---------------------------------------------------------------------------
// usePointerSpotlight — feeds --mx/--my so .pointer-sheen can follow the
// cursor inside a card.
// ---------------------------------------------------------------------------

export function usePointerSpotlight<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  const onPointerMove = (event: ReactPointerEvent<T>) => {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    element.style.setProperty("--mx", `${event.clientX - rect.left}px`);
    element.style.setProperty("--my", `${event.clientY - rect.top}px`);
  };

  return { ref, onPointerMove };
}