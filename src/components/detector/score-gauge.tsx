"use client";

import * as React from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { cn } from "@/lib/utils";

interface ScoreGaugeProps {
  /** Score from 0 to 100. */
  value: number;
  /** Display label under the number, e.g. "AI-generated" or "Hallucination". */
  label: string;
  /** Diameter of the gauge in px. */
  size?: number;
}

const clamp = (n: number): number => Math.min(100, Math.max(0, n));

/**
 * Threshold tints (emerald = good, amber = warning, red = bad).
 * - AI gauge: <40 emerald, 40–64 amber, >=65 red.
 * - Hallucination gauge (inverted semantics): <35 emerald, 35–64 amber, >=65 red.
 */
export interface ScoreTint {
  text: string;
  border: string;
  borderL: string;
  bgSoft: string;
  /** Literal class targeting the shadcn Progress indicator child. */
  bar: string;
}

export function scoreTint(value: number, kind: "ai" | "hallucination"): ScoreTint {
  const amberAt = kind === "ai" ? 40 : 35;
  const v = clamp(value);
  if (v >= 65) {
    return {
      text: "text-red-600 dark:text-red-400",
      border: "border-red-500",
      borderL: "border-l-red-500",
      bgSoft: "bg-red-500",
      bar: "[&>div]:bg-red-500",
    };
  }
  if (v >= amberAt) {
    return {
      text: "text-amber-600 dark:text-amber-400",
      border: "border-amber-500",
      borderL: "border-l-amber-500",
      bgSoft: "bg-amber-500",
      bar: "[&>div]:bg-amber-500",
    };
  }
  return {
    text: "text-emerald-600 dark:text-emerald-400",
    border: "border-emerald-500",
    borderL: "border-l-emerald-500",
    bgSoft: "bg-emerald-500",
    bar: "[&>div]:bg-emerald-500",
  };
}

export function ScoreGauge({ value, label, size = 128 }: ScoreGaugeProps) {
  const kind = label.toLowerCase().startsWith("hallucination")
    ? "hallucination"
    : "ai";
  const v = clamp(value);
  const tint = scoreTint(v, kind);

  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const targetOffset = circumference * (1 - v / 100);

  // Animated counter
  const raw = useMotionValue(0);
  const spring = useSpring(raw, { stiffness: 55, damping: 18 });
  const display = useTransform(spring, (latest) => `${Math.round(latest)}%`);

  React.useEffect(() => {
    raw.set(v);
  }, [raw, v]);

  const ariaLabel = kind === "ai"
    ? `AI likelihood ${v} out of 100`
    : `Hallucination likelihood ${v} out of 100`;

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className="relative shrink-0"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="block"
        aria-hidden="true"
      >
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          stroke="currentColor"
          className="text-muted-foreground/20"
        />
        {/* Value arc */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          className={tint.text}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: targetOffset }}
          transition={{ duration: 0.9, ease: "easeOut" }}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-3 text-center">
        <motion.span
          className={cn("text-2xl font-semibold tabular-nums tracking-tight", tint.text)}
        >
          {display}
        </motion.span>
        <span className="text-[10px] font-medium uppercase leading-tight tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
    </div>
  );
}
