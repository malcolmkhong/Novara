"use client";

// ---------------------------------------------------------------------------
// Pricing.
//
// The cycle toggle is real: switching it re-quotes every plan. Nothing is
// purchasable yet — the gateway is still in development — so the toggle is
// labelled as display-only rather than pretending to be a checkout.
// ---------------------------------------------------------------------------

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  PAYMENT_GATEWAY_STATUS,
  SUBSCRIPTION_PLANS,
  formatAnnualTotal,
  formatPrice,
  type BillingCycle,
} from "@/config/subscription-plans";
import { cn } from "@/lib/utils";
import { EASE_OUT_EXPO } from "./motion";
import { Container, FeatureList, SectionIntro } from "./kit";
import { TEXT_META, TEXT_HEADING, TEXT_LABEL } from "@/components/novara/styles";

function CycleToggle({
  cycle,
  onChange,
}: {
  cycle: BillingCycle;
  onChange: (next: BillingCycle) => void;
}) {
  const options: { id: BillingCycle; label: string }[] = [
    { id: "monthly", label: "Monthly" },
    { id: "annual", label: "Annual" },
  ];

  return (
    <div
      role="group"
      aria-label="Billing cycle"
      className="relative inline-flex rounded-full border bg-muted/60 p-1"
    >
      {options.map((option) => {
        const active = option.id === cycle;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.id)}
            className={cn(
              "relative z-10 rounded-full px-4 py-1.5",
              TEXT_LABEL,
              "transition-colors duration-200",
              active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId="pricing-cycle-pill"
                className="absolute inset-0 rounded-full bg-primary"
                transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
              />
            )}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Pricing({ onEnterWriter }: { onEnterWriter: () => void }) {
  const [cycle, setCycle] = useState<BillingCycle>("monthly");

  return (
    <section
      id="home-plans"
      aria-labelledby="home-plans-heading"
      className="bg-secondary/50 py-20 sm:py-28"
    >
      <Container>
        <SectionIntro
          eyebrow="Pricing"
          title="Plans that grow with your manuscript"
          description="Start free, then move up when the draft gets long. Every plan includes the full writing workspace."
          headingId="home-plans-heading"
          reveal={false}
          descriptionClassName="mx-auto max-w-lg"
        >
          <div className="mt-7 flex flex-col items-center gap-3">
            <CycleToggle cycle={cycle} onChange={setCycle} />
            <AnimatePresence mode="wait">
              {cycle === "annual" && (
                <motion.p
                  key="annual-note"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
                  className="text-xs font-medium text-primary"
                >
                  Two months free on every paid plan
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </SectionIntro>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {SUBSCRIPTION_PLANS.map((plan, index) => {
            const annualTotal = formatAnnualTotal(plan, cycle);
            return (
              <motion.div
                key={plan.id}
                initial={{ opacity: 0, y: 26 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.25 }}
                transition={{
                  duration: 0.7,
                  delay: index * 0.09,
                  ease: EASE_OUT_EXPO,
                }}
                className={cn(
                  "relative",
                  plan.highlighted && "md:-mt-4 md:mb-[-1rem]",
                )}
              >
                <Card
                  className={cn(
                    "group pointer-sheen relative h-full overflow-hidden transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-1",
                    plan.highlighted
                      ? "border-primary/60 shadow-xl shadow-primary/10"
                      : "hover:border-primary/30 hover:shadow-lg",
                  )}
                >
                  {plan.highlighted && (
                    <div
                      aria-hidden="true"
                      className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent"
                    />
                  )}
                  {plan.badge && (
                    <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 shadow-sm">
                      {plan.badge}
                    </Badge>
                  )}
                  <CardContent className="flex h-full flex-col">
                    <h3 className={TEXT_HEADING}>{plan.name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>

                    <div className="mt-5 flex items-baseline gap-1.5">
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.span
                          key={`${plan.id}-${cycle}`}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.28, ease: EASE_OUT_EXPO }}
                          className="font-display text-4xl font-bold tabular-nums"
                        >
                          {formatPrice(plan, cycle)}
                        </motion.span>
                      </AnimatePresence>
                      <span className="text-sm text-muted-foreground">/ month</span>
                    </div>
                    {annualTotal && (
                      <p className={cn("mt-1", TEXT_META)}>{annualTotal}</p>
                    )}

                    <FeatureList
                      items={plan.features.slice(0, 5)}
                      className="mt-6 flex-1 space-y-2.5 text-sm"
                      textClassName="text-muted-foreground"
                    />

                    <div className="mt-7">
                      {plan.ctaAvailable ? (
                        <Button className="w-full sheen" onClick={onEnterWriter}>
                          {plan.ctaLabel}
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={onEnterWriter}
                        >
                          {plan.ctaLabel}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>

        <div className="mt-10 text-center">
          <Button variant="outline" asChild className="group">
            <a href="#/plans">
              View All Plans
              <Sparkles
                className="size-4 transition-transform duration-300 group-hover:rotate-12"
                aria-hidden="true"
              />
            </a>
          </Button>
          <p className={cn("mt-4", TEXT_META)}>
            {PAYMENT_GATEWAY_STATUS.label} — plans are not yet purchasable.
          </p>
        </div>
      </Container>
    </section>
  );
}