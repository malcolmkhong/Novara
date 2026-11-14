"use client";

// ---------------------------------------------------------------------------
// How it works — eight steps.
//
// The list on the left is pinned and tracks the reader's progress through
// the steps on the right. One scroll position drives both, so the rail is
// always telling you where you are in the pipeline.
// ---------------------------------------------------------------------------

import {
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";
import { useRef, useState } from "react";
import { Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { HOW_IT_WORKS } from "@/config/novara";
import { cn } from "@/lib/utils";
import { EASE_OUT_EXPO } from "./motion";
import { TEXT_PROSE } from "@/components/novara/styles";

export function StepRail() {
  const trackRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);

  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ["start 80%", "end 70%"],
  });

  const fill = useTransform(scrollYProgress, [0, 1], [0, 1]);

  useMotionValueEvent(scrollYProgress, "change", (value) => {
    const index = Math.min(
      HOW_IT_WORKS.length - 1,
      Math.max(0, Math.floor(value * HOW_IT_WORKS.length)),
    );
    setActive(index);
  });

  return (
    <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] lg:gap-14">
      {/* The pinned rail. */}
      <div className="lg:sticky lg:top-28 lg:self-start">
        <ol className="relative space-y-1">
          <div
            aria-hidden="true"
            className="absolute bottom-3 left-[15px] top-3 w-px bg-border"
          />
          <motion.div
            aria-hidden="true"
            style={reduce ? { scaleY: 1 } : { scaleY: fill }}
            className="absolute bottom-3 left-[15px] top-3 w-px origin-top bg-primary"
          />
          {HOW_IT_WORKS.map((step, index) => {
            const done = index < active;
            const current = index === active;
            return (
              <li key={step.title} className="relative flex items-start gap-4 py-2.5">
                <span
                  className={cn(
                    "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors duration-300",
                    done && "border-primary bg-primary text-primary-foreground",
                    current &&
                      "border-primary bg-background text-primary ring-4 ring-primary/15",
                    !done && !current && "border-border bg-background text-muted-foreground",
                  )}
                >
                  {done ? (
                    <Check className="size-3.5" aria-hidden="true" />
                  ) : (
                    String(index + 1).padStart(2, "0")
                  )}
                </span>
                <span
                  className={cn(
                    "pt-1 text-sm leading-snug transition-colors duration-300",
                    current
                      ? "font-semibold text-foreground"
                      : done
                        ? "text-muted-foreground"
                        : "text-muted-foreground/70",
                  )}
                >
                  {step.title}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {/* The steps themselves. */}
      <div ref={trackRef} className="space-y-4">
        {HOW_IT_WORKS.map((step, index) => (
          <motion.div
            key={step.title}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.6, ease: EASE_OUT_EXPO }}
          >
            <Card
              className={cn(
                "transition-[border-color,box-shadow] duration-500",
                index === active
                  ? "border-primary/50 shadow-md shadow-primary/5"
                  : "border-border",
              )}
            >
              <CardContent className="flex gap-4">
                <span className="font-display text-2xl font-bold tabular-nums text-primary/40">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="font-display text-lg font-bold leading-snug">{step.title}</h3>
                  <p className={cn("mt-1.5", TEXT_PROSE)}>
                    {step.description}
                  </p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}