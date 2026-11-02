"use client";

import { Check, Info, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

const HERO_MOCK_LINES = [
  { width: "w-11/12", accent: false },
  { width: "w-full", accent: false },
  { width: "w-10/12", accent: false },
  { width: "w-9/12", accent: true },
  { width: "w-full", accent: false },
  { width: "w-2/3", accent: false },
  { width: "w-5/6", accent: false },
];

const HERO_AGENT_CHIPS = ["Story Architect", "Editor", "Continuity Checker"];

const SOLUTION_SUBAGENTS = [
  "Sub-agent · Structure",
  "Sub-agent · World & characters",
  "Sub-agent · Prose",
];

const CARD_HOVER =
  "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md";

const ICON_SQUARE =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-900";

export function HomePage({ onEnterWriter }: HomePageProps) {
  return (
    <>
      {/* S1 — Hero */}
      <section
        aria-labelledby="home-hero-heading"
        className="relative overflow-hidden bg-stone-950 text-stone-50"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-amber-500/20 blur-3xl" />
          <div className="absolute -bottom-16 right-0 h-80 w-80 rounded-full bg-amber-600/10 blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24 lg:py-28">
          <div className="grid items-center gap-14 lg:grid-cols-2">
            <div>
              <Badge
                variant="outline"
                className="border-stone-700 bg-stone-900/60 text-amber-300"
              >
                AI-Powered Novel Writing Team
              </Badge>
              <h1
                id="home-hero-heading"
                className="mt-5 font-display text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl"
              >
                {BRAND.tagline}
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-stone-300 sm:text-lg">
                Novara AI gives you a team of specialized AI agents — story
                architecture, worldbuilding, characters, plot, drafting,
                editing, continuity. They take your novel from one-line concept
                to complete manuscript, and keep it consistent from the first
                page to the last.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button size="lg" onClick={onEnterWriter}>
                  Start Creating
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  asChild
                  className="border-stone-700 bg-transparent text-stone-200 hover:border-stone-600 hover:bg-stone-800 hover:text-stone-50"
                >
                  <a href="#/product">Explore Features</a>
                </Button>
              </div>
              <div className="mt-12 grid grid-cols-2 gap-6 border-t border-stone-800 pt-8 sm:grid-cols-4">
                {HERO_STATS.map((stat) => (
                  <div key={stat.label}>
                    <div className="font-display text-2xl font-bold text-amber-400 sm:text-3xl">
                      {stat.value}
                    </div>
                    <div className="mt-1 text-xs text-stone-400">
                      {stat.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="hidden lg:block">
              <div className="rounded-xl border border-stone-800 bg-stone-900 shadow-2xl">
                <div className="flex items-center gap-2 border-b border-stone-800 px-4 py-3">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 rounded-full bg-stone-700"
                  />
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 rounded-full bg-stone-700"
                  />
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 rounded-full bg-stone-700"
                  />
                  <span className="ml-3 text-xs text-stone-400">
                    Novara AI — Writer
                  </span>
                </div>
                <div className="flex">
                  <div className="w-40 shrink-0 border-r border-stone-800 p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">
                      Chapters
                    </p>
                    <div className="mt-3 space-y-1.5">
                      {HERO_MOCK_CHAPTERS.map((chapter) => (
                        <div
                          key={chapter.name}
                          className={cn(
                            "rounded-md px-2.5 py-1.5",
                            chapter.active && "bg-stone-800/80",
                          )}
                        >
                          <div
                            className={cn(
                              "text-xs font-medium",
                              chapter.active
                                ? "text-amber-300"
                                : "text-stone-400",
                            )}
                          >
                            {chapter.name}
                          </div>
                          <div className="text-[10px] text-stone-500">
                            {chapter.words} words
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex-1 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-stone-400">
                        Chapter 1 · Draft
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-stone-700 px-2 py-0.5 text-[10px] text-stone-400">
                        <span
                          aria-hidden="true"
                          className="h-1 w-1 rounded-full bg-amber-400"
                        />
                        Drafting
                      </span>
                    </div>
                    <div className="mt-4 space-y-2.5">
                      {HERO_MOCK_LINES.map((line, index) => (
                        <div
                          key={index}
                          aria-hidden="true"
                          className={cn(
                            "h-2 rounded-full",
                            line.width,
                            line.accent
                              ? "bg-amber-500/60"
                              : "bg-stone-800",
                          )}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {HERO_AGENT_CHIPS.map((chip) => (
                  <span
                    key={chip}
                    className="inline-flex items-center gap-1.5 rounded-full border border-stone-700 bg-stone-900 px-3 py-1 text-xs text-stone-300"
                  >
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 rounded-full bg-amber-400"
                    />
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* S2 — The problem */}
      <section aria-labelledby="home-problem-heading" className="py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-medium uppercase tracking-wide text-primary">
              The problem
            </p>
            <h2
              id="home-problem-heading"
              className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl"
            >
              Writing a novel is a team-sized job
            </h2>
            <p className="mt-4 text-muted-foreground">
              One person is asked to be architect, worldbuilder, writer, editor
              and continuity checker — all at once.
            </p>
          </div>
          <div className="mt-10 grid gap-5 sm:mt-12 sm:grid-cols-2 lg:grid-cols-4">
            {PROBLEMS.map((problem) => {
              const Icon = problem.icon;
              return (
                <Card key={problem.title} className={CARD_HOVER}>
                  <CardContent className="space-y-3">
                    <span className={ICON_SQUARE}>
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <h3 className="text-base font-semibold">{problem.title}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {problem.description}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* S3 — The solution */}
      <section
        aria-labelledby="home-solution-heading"
        className="bg-secondary/50 py-16 sm:py-20"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-medium uppercase tracking-wide text-primary">
              The solution
            </p>
            <h2
              id="home-solution-heading"
              className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl"
            >
              Meet Novara AI — an AI-powered Novel Creation System
            </h2>
          </div>
          <div className="mt-10 grid gap-5 sm:mt-12 md:grid-cols-3">
            {PILLARS.map((pillar) => {
              const Icon = pillar.icon;
              return (
                <Card key={pillar.title} className={CARD_HOVER}>
                  <CardContent className="space-y-3">
                    <span className={ICON_SQUARE}>
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <h3 className="font-display text-lg font-bold">
                      {pillar.title}
                    </h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {pillar.description}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Leader → sub-agents diagram */}
          <div className="mx-auto mt-14 w-full max-w-xl">
            <div className="flex flex-col items-center">
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-5 py-2 text-sm font-semibold text-primary">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full bg-primary"
                />
                Leader Agent
              </span>
              <div aria-hidden="true" className="h-6 w-px bg-primary/30" />
              <div className="relative">
                <div
                  aria-hidden="true"
                  className="absolute left-[16.6%] right-[16.6%] top-0 hidden h-px bg-primary/30 sm:block"
                />
                <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-3 sm:pt-5">
                  {SOLUTION_SUBAGENTS.map((label) => (
                    <div key={label} className="flex flex-col items-center">
                      <div
                        aria-hidden="true"
                        className="h-5 w-px bg-primary/30"
                      />
                      <span className="rounded-full border bg-background px-4 py-1.5 text-xs font-medium text-muted-foreground">
                        {label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* S4 — The AI Team */}
      <section
        aria-labelledby="home-team-heading"
        className="py-16 sm:py-20"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-medium uppercase tracking-wide text-primary">
              The AI Team
            </p>
            <h2
              id="home-team-heading"
              className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl"
            >
              Seven specialists. One shared story bible.
            </h2>
          </div>
          <div className="mt-10 grid gap-5 sm:mt-12 sm:grid-cols-2 lg:grid-cols-3">
            {AI_TEAM.map((agent) => {
              const Icon = agent.icon;
              return (
                <Card key={agent.name} className={CARD_HOVER}>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-900">
                        <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[11px] uppercase tracking-wide text-muted-foreground"
                      >
                        {agent.role}
                      </Badge>
                    </div>
                    <h3 className="font-display text-lg font-bold">
                      {agent.name}
                    </h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {agent.description}
                    </p>
                    <p className="text-sm font-medium text-primary">
                      Delivers: {agent.delivers}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted-foreground">
            All seven agents read and write to{" "}
            <span className="font-medium text-foreground">
              one shared story bible
            </span>{" "}
            — so every hand-off between agents stays consistent.
          </p>
        </div>
      </section>

      {/* S5 — How it works */}
      <section
        aria-labelledby="home-how-heading"
        className="bg-secondary/50 py-16 sm:py-20"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2
              id="home-how-heading"
              className="font-display text-3xl font-bold tracking-tight sm:text-4xl"
            >
              From concept to manuscript in eight steps
            </h2>
          </div>
          <div className="mt-10 grid gap-5 sm:mt-12 sm:grid-cols-2 lg:grid-cols-4">
            {HOW_IT_WORKS.map((step, index) => (
              <Card key={step.title} className={CARD_HOVER}>
                <CardContent className="space-y-3">
                  <span className="font-display text-3xl font-bold text-primary">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="text-base font-semibold leading-snug">
                    {step.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {step.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* S6 — What can you create */}
      <section
        aria-labelledby="home-create-heading"
        className="py-16 sm:py-20"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2
              id="home-create-heading"
              className="font-display text-3xl font-bold tracking-tight sm:text-4xl"
            >
              What can you create with Novara AI?
            </h2>
          </div>
          <div className="mt-10 grid gap-5 sm:mt-12 md:grid-cols-3">
            {NOVEL_FORMATS.map((format) => {
              const Icon = format.icon;
              return (
                <Card key={format.title} className={CARD_HOVER}>
                  <CardContent className="space-y-3">
                    <span className={ICON_SQUARE}>
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <h3 className="font-display text-lg font-bold">
                      {format.title}
                    </h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {format.description}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <div className="mx-auto mt-10 max-w-3xl">
            <p className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Genres
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {GENRES.map((genre) => (
                <span
                  key={genre}
                  className="rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground"
                >
                  {genre}
                </span>
              ))}
            </div>
          </div>
          <div className="mx-auto mt-10 max-w-3xl rounded-xl border border-primary/30 bg-primary/5 px-6 py-4">
            <p className="flex flex-wrap items-center justify-center gap-2 text-center text-sm sm:text-base">
              <Target className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>
                <span className="font-semibold text-primary">Target:</span> one
                complete ~100,000-word novel — foundation → outline → 40+
                chapters → reviews → export.
              </span>
            </p>
          </div>
        </div>
      </section>

      {/* S7 — Who is Novara for */}
      <section
        aria-labelledby="home-personas-heading"
        className="bg-secondary/50 py-16 sm:py-20"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2
              id="home-personas-heading"
              className="font-display text-3xl font-bold tracking-tight sm:text-4xl"
            >
              Who is Novara AI for?
            </h2>
          </div>
          <div className="mt-10 grid gap-5 sm:mt-12 sm:grid-cols-2 lg:grid-cols-3">
            {PERSONAS.map((persona) => {
              const Icon = persona.icon;
              return (
                <Card key={persona.title} className={CARD_HOVER}>
                  <CardContent className="flex gap-4">
                    <span className={ICON_SQUARE}>
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div>
                      <h3 className="font-semibold">{persona.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        {persona.description}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* S8 — Monetization */}
      <section
        aria-labelledby="home-monetization-heading"
        className="py-16 sm:py-20"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2
              id="home-monetization-heading"
              className="font-display text-3xl font-bold tracking-tight sm:text-4xl"
            >
              From manuscript to income
            </h2>
            <p className="mt-4 text-muted-foreground">
              A finished novel is a product. Novara AI helps you build it — the
              channels below are where it can go.
            </p>
          </div>
          <div className="mt-10 grid gap-5 sm:mt-12 sm:grid-cols-2 lg:grid-cols-3">
            {MONETIZATION_CHANNELS.map((channel) => {
              const Icon = channel.icon;
              return (
                <Card key={channel.title} className={CARD_HOVER}>
                  <CardContent className="space-y-3">
                    <span className={ICON_SQUARE}>
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <h3 className="font-semibold">{channel.title}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {channel.description}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <div className="mx-auto mt-10 max-w-3xl rounded-lg border bg-muted/40 p-4">
            <div className="flex gap-3">
              <Info
                className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="text-sm leading-relaxed text-muted-foreground">
                {MONETIZATION_DISCLAIMER}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* S9 — Subscription preview */}
      <section
        aria-labelledby="home-plans-heading"
        className="bg-secondary/50 py-16 sm:py-20"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-medium uppercase tracking-wide text-primary">
              Pricing
            </p>
            <h2
              id="home-plans-heading"
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
                  plan.highlighted && "border-primary shadow-lg shadow-primary/5",
                )}
              >
                {plan.badge && (
                  <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                    {plan.badge}
                  </Badge>
                )}
                <CardContent className="flex-1">
                  <h3 className="font-display text-lg font-bold">{plan.name}</h3>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="font-display text-3xl font-bold">
                      {formatPrice(plan)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      / month
                    </span>
                  </div>
                  <ul className="mt-5 space-y-2 text-sm">
                    {plan.features.slice(0, 4).map((feature) => (
                      <li key={feature} className="flex items-start gap-2">
                        <Check
                          className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                          aria-hidden="true"
                        />
                        <span className="text-muted-foreground">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Button variant="outline" asChild>
              <a href="#/plans">View All Plans</a>
            </Button>
            <p className="mt-4 text-xs text-muted-foreground">
              {PAYMENT_GATEWAY_STATUS.label} — plans are not yet purchasable.
            </p>
          </div>
        </div>
      </section>

      {/* S10 — Final CTA */}
      <section aria-labelledby="home-final-cta-heading" className="py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="relative overflow-hidden rounded-2xl bg-stone-950 px-6 py-14 text-center text-stone-50 sm:px-12 sm:py-16">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
            >
              <div className="absolute -top-20 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-amber-500/20 blur-3xl" />
              <div className="absolute -bottom-24 right-1/4 h-56 w-56 rounded-full bg-amber-600/10 blur-3xl" />
            </div>
            <div className="relative mx-auto max-w-2xl">
              <h2
                id="home-final-cta-heading"
                className="font-display text-3xl font-bold tracking-tight sm:text-4xl"
              >
                Start Creating with Novara AI
              </h2>
              <p className="mt-4 text-base text-stone-300">
                Enter the AI Writer, give the team your concept, and watch it
                grow into a manuscript — free to start.
              </p>
              <div className="mt-8">
                <Button size="lg" onClick={onEnterWriter}>
                  Start Creating
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
      {/* S11 — Footer: intentionally not rendered here; the shell provides it. */}
    </>
  );
}
