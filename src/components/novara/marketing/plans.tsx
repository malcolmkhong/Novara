"use client";

import { CreditCard, Info } from "lucide-react";
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
import { Container, FeatureList } from "./kit";
import { TEXT_HEADING, TEXT_META, TEXT_VALUE } from "@/components/novara/styles";

interface PlansPageProps {
  onEnterWriter: () => void;
}

export function PlansPage({ onEnterWriter }: PlansPageProps) {
  return (
    <Container className="py-16">
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
      <Alert className="mx-auto mt-8 max-w-3xl border-warning-border-strong bg-warning-surface/60 text-warning-text-deep">
        <CreditCard className="size-4" aria-hidden="true" />
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
              <h2 className={TEXT_HEADING}>{plan.name}</h2>
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
              <FeatureList
                items={plan.features}
                className="space-y-2.5 text-sm"
              />
              <Separator className="my-5" />
              <dl className={cn("space-y-2", TEXT_META)}>
                <div className="flex justify-between">
                  <dt>Novels</dt>
                  <dd className={TEXT_VALUE}>
                    {formatLimit(plan.limits.novels)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>AI draft words</dt>
                  <dd className={TEXT_VALUE}>
                    {formatLimit(plan.limits.aiDraftWordsPerMonth)} / mo
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Agent team</dt>
                  <dd className={TEXT_VALUE}>
                    {plan.limits.agentTeam === "all"
                      ? "All 5 agents"
                      : "Core agents"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Support</dt>
                  <dd className={TEXT_VALUE}>
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
                  <p className={TEXT_META}>
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
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            Usage limits are part of the plan design and will be enforced once
            accounts and subscriptions are introduced. The current preview
            build does not restrict usage and does not track any subscription
            state.
          </p>
        </div>
        <div className="flex gap-3 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            Your novels, chapters, characters and world settings always belong
            to you. Every plan includes portable JSON backups so you can export
            and re-import your work at any time.
          </p>
        </div>
      </div>
    </Container>
  );
}
