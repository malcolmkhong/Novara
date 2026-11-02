"use client";

import { ArrowRight, BookOpen, Check, Info, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AI_TEAM,
  BRAND,
  GENRES,
  HERO_STATS,
  HOW_IT_WORKS,
  MONETIZATION_CHANNELS,
  MONETIZATION_DISCLAIMER,
  NOVEL_FORMATS,
  PERSONAS,
  PILLARS,
  PROBLEMS,
} from "@/config/novara";
import {
  PAYMENT_GATEWAY_STATUS,
  SUBSCRIPTION_PLANS,
  formatPrice,
} from "@/config/subscription-plans";
import { cn } from "@/lib/utils";

export interface HomePageProps {
  onEnterWriter: () => void;
}

// --- Hero mock (pure CSS, decorative) ---------------------------------------

const HERO_MOCK_CHAPTERS = [
  { name: "Chapter 1", words: "2,412", active: true },
  { name: "Chapter 2", words: "1,874", active: false },
  { name: "Chapter 3", words: "2,208", active: false },
  { name: "Chapter 4", words: "1,655", active: false },
];

const HERO_MOCK_LINES: { width: string; accent?: boolean }[] = [
  { width: "w-11/12" },
  { width: "w-full" },
  { width: "w-9/12" },
  { width: "w-8/12", accent: true },
  { width: "w-full" },
  { width: "w-10/12" },
  { width: "w-2/3" },
];

const HERO_AGENT_CHIPS = [
  "Story Architect",
  "Editor",
  "Continuity Checker",
  "Plot Planner",
];

const SOLUTION_SUBAGENTS = [
  "Sub-agent · Structure",
  "Sub-agent · World & cast",
  "Sub-agent · Prose",
];

export function HomePage({ onEnterWriter }: HomePageProps) {
  return (
    <div>
      {/* ---------------------------------------------------------------- */}
      {/* Section 1 — Hero (dark, premium)                                 */}
      {/* ---------------------------------------------------------------- */}
      <section
        aria-labelledby="home-hero-title"
        className="relative overflow-hidden bg-stone-950 text-stone-50"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
        >
          <div className="absolute -top-32 left-1/4 h-96 w-96 rounded-full bg-amber-500/10 blur-3xl" />
          <div className="absolute -bottom-40 right-1/4 h-96 w-96 rounded-full bg-amber-500/10 blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-400">
                AI-Powered Novel Writing Team
              </span>
              <h1
                id="home-hero-title"
                className="mt-5 font-display text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl"
              >
                {BRAND.tagline}
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-stone-300 sm:text-lg">
                Novara AI coordinates a team of specialized AI agents — story
                architecture, worldbuilding, characters, plot, drafting,
                editing and continuity — to take your novel from a one-line
                concept to a complete manuscript. It{" "}
                <strong className="font-semibold text-stone-100">
                  plans the book, writes the chapters and keeps every detail
                  consistent
                </strong>{" "}
                from first outline to final export.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button
                  size="lg"
                  className="h-11 px-8 text-base"
                  onClick={onEnterWriter}
                >
                  Start Creating
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  asChild
                  className="h-11 border-stone-700 bg-transparent px-8 text-base text-stone-200 hover:bg-stone-900 hover:text-stone-50"
                >
                  <a href="#/product">
                    Explore Features
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </a>
                </Button>
              </div>
              <div className="mt-10 grid grid-cols-2 gap-6 border-t border-stone-800 pt-8 sm:grid-cols-4">
                {HERO_STATS.map((stat) => (
                  <div key={stat.label}>
                    <p className="font-display text-2xl font-bold text-amber-400 sm:text-3xl">
                      {stat.value}
                    </p>
                    <p className="mt-1 text-xs text-stone-400 sm:text-sm">
                      {stat.label}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* CSS-only product mock */}
            <div className="hidden lg:block" aria-hidden="true">
              <div className="overflow-hidden rounded-xl border border-stone-800 bg-stone-900 shadow-2xl">
                <div className="flex items-center gap-2 border-b border-stone-800 px-4 py-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-stone-700" />
                  <span className="h-2.5 w-2.5 rounded-full bg-stone-700" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
                  <span className="ml-2 text-xs font-medium text-stone-400">
                    Novara AI — Writer
                  </span>
                </div>
                <div className="flex">
                  <div className="w-40 shrink-0 space-y-1 border-r border-stone-800 p-3">
                    {HERO_MOCK_CHAPTERS.map((chapter) => (
                      <div
                        key={chapter.name}
                        className={cn(
                          "flex items-center justify-between rounded-md px-2 py-1.5 text-[11px]",
                          chapter.active && "bg-stone-800/80"
                        )}
                      >
                        <span
                          className={
                            chapter.active
                              ? "font-medium text-amber-400"
                              : "text-stone-400"
                          }
                        >
                          {chapter.name}
                        </span>
                        <span className="text-stone-500">{chapter.words}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex-1 space-y-2.5 p-5">
                    {HERO_MOCK_LINES.map((line, index) => (
                      <div
                        key={index}
                        className={cn(
                          "h-2 rounded",
                          line.accent ? "bg-amber-500/70" : "bg-stone-800",
                          line.width
                        )}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {HERO_AGENT_CHIPS.map((chip) => (
                  <span
                    key={chip}
                    className="inline-flex items-center gap-1.5 rounded-full border border-stone-700 bg-stone-900 px-3 py-1 text-xs text-stone-300"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Section 2 — The Problem                                          */}
      {/* ---------------------------------------------------------------- */}
      <section
        aria-labelledby="home-problem-heading"
        className="bg-background"
      >
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              The problem
            </p>
            <h2
              id="home-problem-heading"
              className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl"
            >
              Writing a novel is a team-sized job
            </h2>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {PROBLEMS.map((problem) => (
              <Card key={problem.title} className="h-full">
                <CardHeader>
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-900">
                    <problem.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <CardTitle className="mt-2 font-display text-base">
                    {problem.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {problem.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Section 3 — Introducing Novara AI                                */}
      {/* ---------------------------------------------------------------- */}
      <section
        aria-labelledby="home-solution-heading"
        className="bg-secondary/50"
      >
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              The solution
            </p>
            <h2
              id="home-solution-heading"
              className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl"
            >
              Meet Novara AI — an AI-powered Novel Creation System
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
              {BRAND.positioning} A Leader Agent coordinates the specialist
              agents while you stay in the director’s chair.
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {PILLARS.map((pillar) => (
              <Card key={pillar.title} className="h-full">
                <CardHeader>
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-900">
                    <pillar.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <CardTitle className="mt-2 font-display text-lg">
                    {pillar.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {pillar.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Leader → sub-agents mini diagram (pure CSS) */}
          <div className="mx-auto mt-12 max-w-2xl rounded-xl border bg-card px-6 py-8">
            <div className="mx-auto flex max-w-xl flex-col items-center">
              <span className="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground">
                Leader Agent
              </span>
              <span aria-hidden="true" className="h-5 w-px bg-primary/30" />
              <span
                aria-hidden="true"
                className="hidden h-px w-2/3 bg-primary/30 sm:block"
              />
              <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
                {SOLUTION_SUBAGENTS.map((agent) => (
                  <div key={agent} className="flex flex-col items-center">
                    <span
                      aria-hidden="true"
                      className="hidden h-4 w-px bg-primary/30 sm:block"
                    />
                    <span className="rounded-full border bg-background px-3 py-1.5 text-xs font-medium text-foreground">
                      {agent}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-6 text-center text-xs text-muted-foreground">
              One leader, specialized sub-agents — every result is written back
              to the shared story bible.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Section 4 — The AI Team                                          */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="home-team-heading" className="bg-background">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              The AI Team
            </p>
            <h2
              id="home-team-heading"
              className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl"
            >
              Seven specialists. One shared story bible.
            </h2>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {AI_TEAM.map((agent, index) => (
              <Card
                key={agent.name}
                className={cn("h-full", index === AI_TEAM.length - 1 && "lg:col-start-2")}
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-900">
                      <agent.icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {agent.role}
                    </Badge>
                  </div>
                  <CardTitle className="mt-2 font-display text-lg">
                    {agent.name}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {agent.description}
                  </p>
                  <p className="mt-3 text-sm font-medium text-primary">
                    Delivers: {agent.delivers}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="mx-auto mt-8 flex max-w-2xl items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <BookOpen className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            All seven agents read from and write to one shared story bible, so
            every hand-off stays consistent.
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Section 5 — How It Works                                         */}
      {/* ---------------------------------------------------------------- */}
      <section
        aria-labelledby="home-how-heading"
        className="bg-secondary/50"
      >
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              How it works
            </p>
            <h2
              id="home-how-heading"
              className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl"
            >
              From concept to manuscript in eight steps
            </h2>
          </div>
          <ol className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {HOW_IT_WORKS.map((step, index) => (
              <li key={step.title}>
                <Card className="h-full">
                  <CardContent>
                    <p className="font-display text-3xl font-bold text-primary">
                      {String(index + 1).padStart(2, "0")}
                    </p>
                    <h3 className="mt-3 font-medium leading-snug">
                      {step.title}
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                      {step.description}
                    </p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Section 6 — What Can You Create?                                 */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="home-create-heading" className="bg-background">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2
              id="home-create-heading"
              className="font-display text-3xl font-bold tracking-tight sm:text-4xl"
            >
              What can you create with Novara AI?
            </h2>
            <p className="mt-4 text-base text-muted-foreground sm:text-lg">
              From complete novels to long-running serials — pick the shape of
              your story.
            </p>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {NOVEL_FORMATS.map((format) => (
              <Card key={format.title} className="h-full">
                <CardHeader>
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-900">
                    <format.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <CardTitle className="mt-2 font-display text-lg">
                    {format.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {format.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <h3 className="mt-14 text-center text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Genres the team can work in
          </h3>
          <ul className="mt-5 flex flex-wrap justify-center gap-2">
            {GENRES.map((genre) => (
              <li key={genre}>
                <span className="inline-block rounded-full border bg-card px-3.5 py-1.5 text-sm text-foreground">
                  {genre}
                </span>
              </li>
            ))}
          </ul>

          <div className="mx-auto mt-10 flex max-w-3xl items-center gap-4 rounded-xl border border-primary/30 bg-accent/60 p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Target className="h-5 w-5" aria-hidden="true" />
            </span>
            <p className="text-sm leading-relaxed sm:text-base">
              <span className="font-semibold">
                Target: one complete ~100,000-word novel
              </span>{" "}
              — foundation → outline → 40+ chapters → reviews → export.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Section 7 — Who Is Novara For?                                   */}
      {/* ---------------------------------------------------------------- */}
      <section
        aria-labelledby="home-personas-heading"
        className="bg-secondary/50"
      >
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2
              id="home-personas-heading"
              className="font-display text-3xl font-bold tracking-tight sm:text-4xl"
            >
              Who is Novara for?
            </h2>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {PERSONAS.map((persona) => (
              <Card key={persona.title} className="h-full">
                <CardHeader>
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-900">
                    <persona.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <CardTitle className="mt-2 font-display text-base">
                    {persona.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {persona.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Section 8 — Monetization Opportunities                           */}
      {/* ---------------------------------------------------------------- */}
      <section
        aria-labelledby="home-monetization-heading"
        className="bg-background"
      >
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2
              id="home-monetization-heading"
              className="font-display text-3xl font-bold tracking-tight sm:text-4xl"
            >
              From manuscript to income
            </h2>
            <p className="mt-4 text-base text-muted-foreground sm:text-lg">
              Many writers use Novara AI to prepare their manuscripts for
              channels like these.
            </p>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {MONETIZATION_CHANNELS.map((channel) => (
              <Card key={channel.title} className="h-full">
                <CardHeader>
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-900">
                    <channel.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <CardTitle className="mt-2 font-display text-base">
                    {channel.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {channel.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="mx-auto mt-10 flex max-w-3xl gap-3 rounded-lg border bg-muted/50 p-4">
            <Info
              className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">
              {MONETIZATION_DISCLAIMER}
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Section 9 — Subscription Preview                                 */}
      {/* ---------------------------------------------------------------- */}
      <section
        aria-labelledby="home-pricing-heading"
        className="bg-secondary/50"
      >
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              Pricing
            </p>
            <h2
              id="home-pricing-heading"
              className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl"
            >
              Plans that grow with your manuscript
            </h2>
          </div>
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
                <CardHeader className="text-center">
                  <CardTitle className="font-display text-xl">
                    {plan.name}
                  </CardTitle>
                  <div className="mt-2 flex items-baseline justify-center gap-1">
                    <span className="font-display text-3xl font-bold">
                      {formatPrice(plan)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      / month
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="flex-1">
                  <ul className="space-y-2.5 text-sm">
                    {plan.features.slice(0, 4).map((feature) => (
                      <li key={feature} className="flex items-start gap-2">
                        <Check
                          className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                          aria-hidden="true"
                        />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="mt-6 text-center text-xs text-muted-foreground">
            {PAYMENT_GATEWAY_STATUS.label} — plans are not purchasable yet.
          </p>
          <div className="mt-8 text-center">
            <Button
              size="lg"
              variant="outline"
              asChild
              className="h-11 px-8 text-base"
            >
              <a href="#/plans">View All Plans</a>
            </Button>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Section 10 — Final CTA (footer is provided by the app shell)     */}
      {/* ---------------------------------------------------------------- */}
      <section
        aria-labelledby="home-final-cta-heading"
        className="relative overflow-hidden bg-stone-950 text-stone-50"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
        >
          <div className="absolute -top-24 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-amber-500/10 blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-20">
          <h2
            id="home-final-cta-heading"
            className="font-display text-3xl font-bold tracking-tight sm:text-4xl"
          >
            Start Creating with Novara AI
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-stone-300 sm:text-lg">
            Bring your concept, and let your AI writing team handle the
            planning, drafting and continuity — while you stay in the
            director’s chair.
          </p>
          <Button
            size="lg"
            className="mt-8 h-11 px-8 text-base"
            onClick={onEnterWriter}
          >
            Start Creating
          </Button>
        </div>
      </section>
    </div>
  );
}
