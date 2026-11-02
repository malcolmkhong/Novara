"use client";

import { Check, CreditCard, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  PAYMENT_GATEWAY_STATUS,
  SUBSCRIPTION_PLANS,
  formatLimit,
  formatPrice,
} from "@/config/subscription-plans";
import { cn } from "@/lib/utils";

interface PlansPageProps {
  onEnterWriter: () => void;
}

export function PlansPage({ onEnterWriter }: PlansPageProps) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      {/* Header */}
      <div className="mx-auto max-w-2xl text-center">
        <Badge variant="outline" className="mb-4">
          Subscription Plans
        </Badge>
        <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
          Simple plans for every stage of your novel
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Start free while Novara AI grows. Upgrade when your manuscript does.
        </p>
      </div>

      {/* Payment gateway status — honest notice */}
      <Alert className="mx-auto mt-8 max-w-3xl border-amber-300 bg-amber-50/60 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">
        <CreditCard className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>{PAYMENT_GATEWAY_STATUS.label}</AlertTitle>
        <AlertDescription>{PAYMENT_GATEWAY_STATUS.note}</AlertDescription>
      </Alert>

      {/* Plan cards */}
      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {SUBSCRIPTION_PLANS.map((plan) => (
          <Card
            key={plan.id}
            className={cn(
              "relative flex flex-col",
              plan.highlighted && "border-primary shadow-lg shadow-primary/5"
            )}
          >
            {plan.badge && (
              <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
                {plan.badge}
              </Badge>
            )}
            <CardHeader className="pb-4 text-center">
              <h2 className="font-display text-xl font-bold">{plan.name}</h2>
              <p className="min-h-10 text-sm text-muted-foreground">
                {plan.tagline}
              </p>
              <div className="mt-3 flex items-baseline justify-center gap-1">
                <span className="font-display text-4xl font-bold">
                  {formatPrice(plan)}
                </span>
                <span className="text-sm text-muted-foreground">/ month</span>
              </div>
            </CardHeader>
            <CardContent className="flex-1">
              <ul className="space-y-2.5 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check
                      className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Separator className="my-5" />
              <dl className="space-y-2 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <dt>Novels</dt>
                  <dd className="font-medium text-foreground">
                    {formatLimit(plan.limits.novels)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>AI draft words</dt>
                  <dd className="font-medium text-foreground">
                    {formatLimit(plan.limits.aiDraftWordsPerMonth)} / mo
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Agent team</dt>
                  <dd className="font-medium text-foreground">
                    {plan.limits.agentTeam === "all"
                      ? "All 7 agents"
                      : "Core agents"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Support</dt>
                  <dd className="font-medium text-foreground">
                    {plan.limits.support}
                  </dd>
                </div>
              </dl>
            </CardContent>
            <CardFooter className="flex-col gap-2">
              {plan.ctaAvailable ? (
                <Button className="w-full" onClick={onEnterWriter}>
                  {plan.ctaLabel}
                </Button>
              ) : (
                <>
                  <Button className="w-full" disabled>
                    {plan.ctaLabel}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Available after payment gateway launch
                  </p>
                </>
              )}
            </CardFooter>
          </Card>
        ))}
      </div>

      {/* Notes */}
      <div className="mx-auto mt-12 max-w-3xl space-y-4">
        <div className="flex gap-3 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            Usage limits are part of the plan design and will be enforced once
            accounts and subscriptions are introduced. The current preview
            build does not restrict usage and does not track any subscription
            state.
          </p>
        </div>
        <div className="flex gap-3 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            Your novels, chapters, characters and world settings always belong
            to you. Every plan includes portable JSON backups so you can export
            and re-import your work at any time.
          </p>
        </div>
      </div>
    </div>
  );
}
