"use client";



import type { LucideIcon } from "lucide-react";
import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  FileDown,
  PenLine,
  ShieldCheck,
  Sparkles,
  Workflow,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Container, FeatureList, ICON_SQUARE_ACCENT, SectionIntro } from "./kit";
import { cn } from "@/lib/utils";
import { TEXT_META, TEXT_PROSE, TEXT_LABEL } from "@/components/novara/styles";

export interface ProductPageProps {
  onEnterWriter: () => void;
}

// --- Page data ---------------------------------------------------------------

const PIPELINE_STAGES = [
  "Concept",
  "Story Foundation",
  "World & Characters",
  "Outline",
  "Drafting",
  "Editing",
  "Continuity Check",
  "Export",
];

const COLLAB_POINTS = [
  {
    title: "The Leader Agent decomposes the goal",
    description:
      "Your concept is broken into concrete tasks and assigned to the right specialist.",
  },
  {
    title: "Specialists work in their discipline",
    description:
      "Structure, world, characters, plot, prose, editing, continuity — each agent stays in its lane.",
  },
  {
    title: "Results are verified, then written back",
    description:
      "Every result is checked and recorded in the shared story bible before the next step begins.",
  },
];

const HANDOFF_CHAIN = [
  "Premise",
  "Story foundation",
  "World bible + Cast",
  "Outline & beats",
  "Chapter draft",
  "Review",
  "Consistency report",
];

type InsideStatus = "live" | "live-experimental" | "in-development";

interface InsideItem {
  icon: LucideIcon;
  title: string;
  description: string;
  status: InsideStatus;
}

const INSIDE_ITEMS: InsideItem[] = [
  {
    icon: BookOpen,
    title: "AI Writer workspace",
    description:
      "Novels, chapters and a living story bible — characters, worldbuilding and outline — with live word counts.",
    status: "live",
  },
  {
    icon: FileDown,
    title: "Import & Export",
    description:
      "Portable, versioned JSON backups with an integrity report, so your work always stays yours.",
    status: "live",
  },
  {
    icon: Sparkles,
    title: "AI Draft",
    description:
      "One-click AI-assisted chapter drafting, grounded in your synopsis, characters and outline.",
    status: "live-experimental",
  },
  {
    icon: Workflow,
    title: "Autonomous agent runtime",
    description:
      "Background tasks, verification gates and full five-agent orchestration — roadmap phases 3-5.",
    status: "in-development",
  },
];

const NOVEL_STAGES = [
  {
    title: "Foundation",
    description:
      "Your one-line concept becomes a story foundation: premise, world bible and cast.",
  },
  {
    title: "Structure",
    description:
      "Acts, chapter beats and pacing — typically 35-45 chapters of 2,200-2,800 words each.",
  },
  {
    title: "Drafting & review loop",
    description:
      "Draft, editor notes, revise, continuity check — repeated chapter by chapter, on your approval.",
  },
  {
    title: "Finish",
    description:
      "A final pass, export, and the manuscript is ready to prepare for publishing.",
  },
];

const BUSYWORK_BEFORE = [
  "Scattered notes across files and folders",
  "Tracking the timeline and facts by hand",
  "Self-editing alone, with no second pass",
  "Planning that lives in your head",
];

const BUSYWORK_AFTER = [
  "One story bible for the entire novel",
  "Continuity checks on every chapter",
  "An AI editor's first pass on every draft",
  "An outline on record, chapter by chapter",
];

interface TourItem {
  icon: LucideIcon;
  title: string;
  description: string;
}

const TOUR_ITEMS: TourItem[] = [
  {
    icon: BookOpen,
    title: "Story Bible",
    description:
      "The single source of truth. Characters, worldbuilding and outline live in one place that every agent reads.",
  },
  {
    icon: PenLine,
    title: "Chapter Workspace",
    description:
      "A focused editor for every chapter, with draft, revised and final statuses and per-chapter word counts.",
  },
  {
    icon: ShieldCheck,
    title: "Quality statuses",
    description:
      "Chapters move forward only through your approval — you always see exactly what state each one is in.",
  },
  {
    icon: FileDown,
    title: "Portable data",
    description:
      "JSON backup import and export keeps your library yours, in a format you can actually read.",
  },
];

function StatusBadge({ status }: { status: InsideStatus }) {
  if (status === "in-development") {
    return (
      <Badge
        variant="outline"
        className="border-warning-border bg-warning-surface-strong text-warning-text-heading"
      >
        In development
      </Badge>
    );
  }
  return (
    <>
      <Badge
        variant="outline"
        className="border-success-border bg-success-surface-strong text-success-text-heading"
      >
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full bg-success-dot"
        />
        Live
      </Badge>
      {status === "live-experimental" && (
        <Badge variant="secondary">Experimental</Badge>
      )}
    </>
  );
}

const CARD_HOVER =
  "transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md";

export function ProductPage({ onEnterWriter }: ProductPageProps) {
  return (
    <>
      {/* P1 — Header */}
      <section
        aria-labelledby="product-heading"
        className="py-16 sm:py-20"
      >
        <Container>
          <div className="mx-auto max-w-3xl text-center">
            <p className={cn(TEXT_LABEL, "uppercase tracking-wide text-primary")}>
              The Product
            </p>
            <h1
              id="product-heading"
              className="mt-2 font-display text-4xl font-bold tracking-tight sm:text-5xl"
            >
              How Novara AI turns a concept into a novel
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
              A Leader Agent coordinates specialized sub-agents; everyone reads
              and writes one shared story bible; work flows through a
              verifiable pipeline instead of one-shot generation.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" onClick={onEnterWriter}>
                Start Creating
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href="#/plans">See plans</a>
              </Button>
            </div>
          </div>
        </Container>
      </section>

      {/* P2 — Pipeline at a glance */}
      <section
        aria-labelledby="product-pipeline-heading"
        className="bg-secondary/50 py-16 sm:py-20"
      >
        <Container>
          <SectionIntro
            title="The pipeline at a glance"
            headingId="product-pipeline-heading"
            headingSpacing="flush"
            reveal={false}
            description="Every novel moves through the same eight stages — each with a clear owner and a verifiable result."
          />
          <div className="mt-10 rounded-xl border bg-card p-6 sm:p-8">
            <ol className="flex flex-wrap items-center gap-y-4">
              {PIPELINE_STAGES.map((stage, index) => (
                <li key={stage} className="flex items-center">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10 font-display text-sm font-bold text-primary">
                      {index + 1}
                    </span>
                    <span className={TEXT_LABEL}>{stage}</span>
                  </div>
                  {index < PIPELINE_STAGES.length - 1 && (
                    <span
                      aria-hidden="true"
                      className="mx-3 h-px w-6 bg-border sm:mx-4 sm:w-9"
                    />
                  )}
                </li>
              ))}
            </ol>
          </div>
        </Container>
      </section>

      {/* P3 — AI Team collaboration */}
      <section
        aria-labelledby="product-collab-heading"
        className="py-16 sm:py-20"
      >
        <Container>
          <div className="grid items-start gap-10 lg:grid-cols-2">
            <div>
              <h2
                id="product-collab-heading"
                className="font-display text-3xl font-bold tracking-tight sm:text-4xl"
              >
                A team that hands work to each other
              </h2>
              <p className="mt-4 text-muted-foreground">
                No single model writes your novel. Work moves between
                specialists, and each hand-off is recorded.
              </p>
              <ul className="mt-8 space-y-5">
                {COLLAB_POINTS.map((point) => (
                  <li key={point.title} className="flex gap-3">
                    <ArrowRight
                      className="mt-0.5 size-5 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    <div>
                      <h3 className="font-semibold">{point.title}</h3>
                      <p className={cn("mt-1", TEXT_PROSE)}>
                        {point.description}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border bg-card p-6 sm:p-8">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Hand-off chain
              </p>
              <ol className="mt-5 flex flex-col">
                {HANDOFF_CHAIN.map((step, index) => (
                  <li key={step}>
                    <div className="flex items-center gap-3 rounded-lg border bg-secondary/50 px-4 py-2.5">
                      <span className="font-display text-xs font-bold text-primary">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className={TEXT_LABEL}>{step}</span>
                    </div>
                    {index < HANDOFF_CHAIN.length - 1 && (
                      <ArrowDown
                        aria-hidden="true"
                        className="my-1.5 ml-6 size-4 text-primary/50"
                      />
                    )}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </Container>
      </section>

      {/* P4 — What is inside today */}
      <section
        aria-labelledby="product-inside-heading"
        className="bg-secondary/50 py-16 sm:py-20"
      >
        <Container>
          <SectionIntro
            title="What&apos;s inside Novara AI"
            headingId="product-inside-heading"
            headingSpacing="flush"
            reveal={false}
            description="An honest look at what works today — and what is still on the way."
          />
          <div className="mt-10 grid gap-5 sm:mt-12 sm:grid-cols-2">
            {INSIDE_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <Card key={item.title} className={CARD_HOVER}>
                  <CardContent>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-display text-lg font-bold">
                        {item.title}
                      </h3>
                      <StatusBadge status={item.status} />
                    </div>
                    <p className={cn("mt-3", TEXT_PROSE)}>
                      {item.description}
                    </p>
                    <div className="mt-4 flex items-center gap-2.5">
                      <span className="flex size-8 items-center justify-center rounded-lg bg-amber-100 text-amber-900">
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                      <span className={TEXT_META}>
                        {item.status === "in-development"
                          ? "On the roadmap — phases 3-5"
                          : "Available in the current preview"}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </Container>
      </section>

      {/* P5 — Writing a ~100,000-word novel */}
      <section
        aria-labelledby="product-novel-heading"
        className="py-16 sm:py-20"
      >
        <Container>
          <SectionIntro
            title="What writing a 100,000-word novel looks like"
            headingId="product-novel-heading"
            headingSpacing="flush"
            reveal={false}
          />
          <div className="mt-10 grid gap-5 sm:mt-12 sm:grid-cols-2 lg:grid-cols-4">
            {NOVEL_STAGES.map((stage, index) => (
              <Card key={stage.title} className={CARD_HOVER}>
                <CardContent className="space-y-3">
                  <span className="font-display text-3xl font-bold text-primary">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="text-base font-semibold leading-snug">
                    {stage.title}
                  </h3>
                  <p className={TEXT_PROSE}>
                    {stage.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className={cn("mx-auto mt-8 max-w-2xl text-center", TEXT_META)}>
            Chapter and word targets are a design guide, not a hard limit —
            Novara AI adapts to the story you want to tell.
          </p>
        </Container>
      </section>

      {/* P6 — Reduce the busywork */}
      <section
        aria-labelledby="product-busywork-heading"
        className="bg-secondary/50 py-16 sm:py-20"
      >
        <Container>
          <SectionIntro
            title="Where the time goes — before and after"
            headingId="product-busywork-heading"
            headingSpacing="flush"
            reveal={false}
            description="A qualitative comparison — how the same work is organized, not how fast."
          />
          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border bg-card p-6 sm:p-8">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-display text-lg font-bold">
                  Manual process
                </h3>
                <Badge
                  variant="outline"
                  className="text-muted-foreground"
                >
                  Before
                </Badge>
              </div>
              <ul className="mt-5 space-y-4">
                {BUSYWORK_BEFORE.map((row) => (
                  <li key={row} className="flex items-start gap-3 text-sm">
                    <X
                      className="mt-0.5 size-4 shrink-0 text-stone-400"
                      aria-hidden="true"
                    />
                    <span className="text-muted-foreground">{row}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-primary/40 bg-card p-6 shadow-sm sm:p-8">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-display text-lg font-bold">
                  With Novara AI
                </h3>
                <Badge>After</Badge>
              </div>
              <FeatureList
                items={BUSYWORK_AFTER}
                className="mt-5 space-y-4"
                itemClassName="gap-3 text-sm"
                textClassName="text-muted-foreground"
              />
            </div>
          </div>
        </Container>
      </section>

      {/* P7 — Feature tour */}
      <section
        aria-labelledby="product-tour-heading"
        className="py-16 sm:py-20"
      >
        <Container>
          <SectionIntro
            title="A closer look at the core features"
            headingId="product-tour-heading"
            headingSpacing="flush"
            reveal={false}
          />
          <div className="mt-10 grid gap-5 sm:mt-12 sm:grid-cols-2 lg:grid-cols-4">
            {TOUR_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <Card key={item.title} className={CARD_HOVER}>
                  <CardContent className="space-y-3">
                    <span className={ICON_SQUARE_ACCENT}>
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <h3 className="font-semibold">{item.title}</h3>
                    <p className={TEXT_PROSE}>
                      {item.description}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </Container>
      </section>

      {/* P8 — Final CTA strip */}
      <section
        aria-labelledby="product-cta-heading"
        className="bg-secondary/50 py-16 sm:py-20"
      >
        <Container>
          <div className="rounded-2xl border border-primary/20 bg-card px-6 py-14 text-center sm:px-12">
            <h2
              id="product-cta-heading"
              className="font-display text-3xl font-bold tracking-tight sm:text-4xl"
            >
              See the system for yourself
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              Enter the AI Writer and try it on your own concept. The current
              preview focuses on the writing workspace — full agent automation
              is on the roadmap.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" onClick={onEnterWriter}>
                Start Creating
              </Button>
              <Button size="lg" variant="ghost" asChild>
                <a href="#/about">About the roadmap</a>
              </Button>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
