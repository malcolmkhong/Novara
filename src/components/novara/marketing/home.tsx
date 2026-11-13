"use client";

// ---------------------------------------------------------------------------
// The homepage.
//
// Structure note: the previous version repeated one layout — centered heading,
// then a grid of identical cards — seven times over. The repetition is what
// made the page read as flat, so each section now gets an archetype of its
// own: a sticky problem list, an animated delegation diagram, live agent
// consoles, a pinned step rail, a bento grid, and a scrolling genre marquee.
//
// Motion lives in the small primitives in ./motion and in the section
// components next to this file. This file is mostly layout.
// ---------------------------------------------------------------------------

import { motion } from "framer-motion";
import { ArrowRight, Info, Target } from "lucide-react";
import { BrandMark } from "@/components/novara/brand-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  GENRES,
  MONETIZATION_CHANNELS,
  MONETIZATION_DISCLAIMER,
  NOVEL_FORMATS,
  PERSONAS,
  PILLARS,
  PROBLEMS,
} from "@/config/novara";
import { cn } from "@/lib/utils";
import { AgentPipeline } from "./agent-pipeline";
import { AgentTeam } from "./agent-team";
import { Hero } from "./hero";
import { EASE_OUT_EXPO, Reveal, Stagger, StaggerItem } from "./motion";
import { Pricing } from "./pricing";
import { StepRail } from "./step-rail";

export interface HomePageProps {
  onEnterWriter: () => void;
}

const ICON_SQUARE =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary";

/** Fade a section in as it scrolls up. */
function SectionIntro({
  eyebrow,
  title,
  description,
  headingId,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  headingId: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <Reveal>
        {eyebrow && (
          <p className="text-sm font-medium uppercase tracking-wide text-primary">{eyebrow}</p>
        )}
        <h2
          id={headingId}
          className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl"
        >
          {title}
        </h2>
        {description && <p className="mt-4 text-muted-foreground">{description}</p>}
      </Reveal>
    </div>
  );
}

export function HomePage({ onEnterWriter }: HomePageProps) {
  return (
    <>
      {/* S1 — Hero */}
      <Hero onEnterWriter={onEnterWriter} />

      {/* S2 — The problem: a sticky thesis beside a list that scrolls past it. */}
      <section
        id="home-problem"
        aria-labelledby="home-problem-heading"
        className="py-20 sm:py-28"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <Reveal>
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
              </Reveal>
            </div>

            <Stagger className="space-y-4">
              {PROBLEMS.map((problem, index) => {
                const Icon = problem.icon;
                return (
                  <StaggerItem key={problem.title}>
                    <Card className="group pointer-sheen overflow-hidden transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg">
                      <CardContent className="flex gap-4">
                        <span className={ICON_SQUARE}>
                          <Icon className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <div>
                          <div className="flex items-baseline gap-3">
                            <span className="font-mono text-xs tabular-nums text-primary/50">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <h3 className="text-lg font-semibold">{problem.title}</h3>
                          </div>
                          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                            {problem.description}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  </StaggerItem>
                );
              })}
            </Stagger>
          </div>
        </div>
      </section>

      {/* S3 — The solution: pillars, then the delegation diagram. */}
      <section
        id="home-solution"
        aria-labelledby="home-solution-heading"
        className="bg-secondary/50 py-20 sm:py-28"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionIntro
            eyebrow="The solution"
            title="Meet Novara AI — an AI-powered Novel Creation System"
            headingId="home-solution-heading"
          />

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {PILLARS.map((pillar, index) => {
              const Icon = pillar.icon;
              return (
                <motion.div
                  key={pillar.title}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.3 }}
                  transition={{
                    duration: 0.7,
                    delay: index * 0.1,
                    ease: EASE_OUT_EXPO,
                  }}
                >
                  <Card className="group pointer-sheen relative h-full overflow-hidden transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-xl">
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute -right-1 -top-3 font-display text-7xl font-bold text-primary/[0.07]"
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <CardContent className="relative space-y-3">
                      <span className={ICON_SQUARE}>
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <h3 className="font-display text-xl font-bold">{pillar.title}</h3>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {pillar.description}
                      </p>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>

          <div className="mt-16">
            <AgentPipeline />
          </div>
        </div>
      </section>

      {/* S4 — The AI team: live consoles instead of static descriptions. */}
      <section
        id="home-team"
        aria-labelledby="home-team-heading"
        className="py-20 sm:py-28"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionIntro
            eyebrow="The AI Team"
            title="Five specialists. One shared story bible."
            headingId="home-team-heading"
          />
          <AgentTeam />
          <Reveal className="mx-auto mt-10 max-w-2xl text-center text-sm text-muted-foreground">
            All five agents read and write to{" "}
            <span className="font-medium text-foreground">one shared story bible</span>{" "}
            — so every hand-off between agents stays consistent.
          </Reveal>
        </div>
      </section>

      {/* S5 — How it works: a pinned rail that tracks scroll position. */}
      <section
        id="home-how"
        aria-labelledby="home-how-heading"
        className="bg-secondary/50 py-20 sm:py-28"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionIntro
            title="From concept to manuscript in eight steps"
            headingId="home-how-heading"
          />
          <StepRail />
        </div>
      </section>

      {/* S6 — What can you create: a bento grid plus a genre marquee. */}
      <section
        id="home-create"
        aria-labelledby="home-create-heading"
        className="overflow-hidden py-20 sm:py-28"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionIntro
            title="What can you create with Novara AI?"
            headingId="home-create-heading"
          />

          <div className="mt-12 grid gap-5 lg:grid-cols-6">
            {NOVEL_FORMATS.map((format, index) => {
              const Icon = format.icon;
              const span =
                index === 0 ? "lg:col-span-4" : index === 1 ? "lg:col-span-2" : "lg:col-span-3";
              return (
                <motion.div
                  key={format.title}
                  initial={{ opacity: 0, y: 26 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.3 }}
                  transition={{
                    duration: 0.7,
                    delay: index * 0.09,
                    ease: EASE_OUT_EXPO,
                  }}
                  className={span}
                >
                  <Card className="group pointer-sheen h-full overflow-hidden transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-xl">
                    <CardContent className="flex h-full flex-col space-y-3">
                      <span className={ICON_SQUARE}>
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <h3 className="font-display text-xl font-bold">{format.title}</h3>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {format.description}
                      </p>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}

            <motion.div
              initial={{ opacity: 0, y: 26 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.7, delay: 0.27, ease: EASE_OUT_EXPO }}
              className="lg:col-span-3"
            >
              <div className="flex h-full flex-col justify-center rounded-xl border border-primary/30 bg-primary/5 px-6 py-8">
                <p className="flex flex-wrap items-center justify-center gap-2 text-center text-sm sm:text-lg">
                  <Target className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>
                    <span className="font-semibold text-primary">Target:</span> one complete
                    ~100,000-word novel — foundation + outline + 40+ chapters + reviews
                    + export.
                  </span>
                </p>
              </div>
            </motion.div>
          </div>

          <div className="mt-16">
            <p className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Genres
            </p>
            <div className="marquee-mask mt-4 flex overflow-hidden">
              <div className="flex w-max animate-marquee">
                {[0, 1].map((copy) => (
                  <div key={copy} className="flex shrink-0 gap-3 pr-3">
                    {GENRES.map((genre) => (
                      <span
                        key={genre}
                        className="shrink-0 rounded-full border bg-card px-4 py-1.5 text-sm text-muted-foreground"
                      >
                        {genre}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* S7 — Who is Novara for: rows, not cards. */}
      <section
        id="home-personas"
        aria-labelledby="home-personas-heading"
        className="bg-secondary/50 py-20 sm:py-28"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionIntro
            title="Who is Novara AI for?"
            headingId="home-personas-heading"
          />

          <div className="mt-12 grid gap-4 sm:grid-cols-2">
            {PERSONAS.map((persona, index) => {
              const Icon = persona.icon;
              return (
                <motion.div
                  key={persona.title}
                  initial={{ opacity: 0, y: 22 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.35 }}
                  transition={{
                    duration: 0.6,
                    delay: index * 0.06,
                    ease: EASE_OUT_EXPO,
                  }}
                >
                  <div className="group flex h-full items-start gap-4 rounded-xl border bg-card p-5 transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md">
                    <span className={ICON_SQUARE}>
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold">{persona.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        {persona.description}
                      </p>
                    </div>
                    <ArrowRight
                      className="mt-1 h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-all duration-300 group-hover:translate-x-1 group-hover:opacity-100"
                      aria-hidden="true"
                    />
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* S8 — Monetization. */}
      <section
        id="home-monetization"
        aria-labelledby="home-monetization-heading"
        className="py-20 sm:py-28"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionIntro
            eyebrow="Monetization"
            title="From manuscript to income"
            description="A finished novel is a product. Novara AI helps you build it — the channels below are where it can go."
            headingId="home-monetization-heading"
          />

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {MONETIZATION_CHANNELS.map((channel, index) => {
              const Icon = channel.icon;
              return (
                <motion.div
                  key={channel.title}
                  initial={{ opacity: 0, y: 22 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.3 }}
                  transition={{
                    duration: 0.6,
                    delay: index * 0.06,
                    ease: EASE_OUT_EXPO,
                  }}
                >
                  <div className="group pointer-sheen relative h-full overflow-hidden rounded-xl border bg-card p-5 transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-1 hover:border-primary/35 hover:shadow-lg">
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute right-4 top-3 font-display text-4xl font-bold text-primary/[0.07]"
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="relative">
                      <span className={ICON_SQUARE}>
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <h3 className="mt-3 font-semibold">{channel.title}</h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                        {channel.description}
                      </p>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>

          <Reveal className="mx-auto mt-10 max-w-3xl">
            <div className="flex gap-3 rounded-lg border bg-muted/40 p-4">
              <Info
                className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="text-sm leading-relaxed text-muted-foreground">
                {MONETIZATION_DISCLAIMER}
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* S9 — Pricing. */}
      <Pricing onEnterWriter={onEnterWriter} />

      {/* S10 — Final CTA: bookends the hero so the page opens and closes on
          the same visual note. */}
      <section
        aria-labelledby="home-final-cta-heading"
        className="relative isolate overflow-hidden bg-stone-950 py-20 text-stone-50 sm:py-28"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="hero-grid absolute inset-0 opacity-60" />
          <motion.div
            className="absolute -top-32 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-amber-500/20 blur-[120px]"
            animate={{ scale: [1, 1.14, 1], opacity: [0.65, 1, 0.65] }}
            transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
          />
          <div className="absolute -bottom-28 right-[18%] h-64 w-64 rounded-full bg-orange-600/[0.12] blur-[110px]" />
          <div className="grain absolute inset-0" />
        </div>

        <div className="relative mx-auto max-w-3xl px-4 text-center sm:px-6">
          <Reveal>
            <div className="mx-auto mb-8 flex h-14 w-14 items-center justify-center">
              <BrandMark variant="dark" className="h-14 w-14" />
            </div>
            <h2
              id="home-final-cta-heading"
              className="font-display text-3xl font-bold tracking-tight sm:text-5xl"
            >
              Start creating with Novara AI
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-lg text-stone-300">
              Enter the AI Writer, give the team your concept, and watch it grow into a
              manuscript — free to start.
            </p>
            <div className="mt-9 flex justify-center">
              <Button size="lg" className="sheen group" onClick={onEnterWriter}>
                Start Creating
                <ArrowRight
                  className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1"
                  aria-hidden="true"
                />
              </Button>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}