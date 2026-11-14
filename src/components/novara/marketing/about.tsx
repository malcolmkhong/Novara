"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BRAND, ROADMAP } from "@/config/novara";
import { cn } from "@/lib/utils";
import { TEXT_PROSE } from "@/components/novara/styles";



const PRINCIPLES = [
  {
    title: "The author stays in control",
    description:
      "Novara AI is a team of assistants, not a ghostwriter that takes over. Every outline, chapter and revision passes through your hands — you approve what ships.",
  },
  {
    title: "Consistency over raw speed",
    description:
      "Fast text is worthless if chapter 40 contradicts chapter 4. We invest in the unglamorous machinery — story bibles, memory, continuity checks — that keeps long novels whole.",
  },
  {
    title: "Honest AI, verifiable results",
    description:
      "The system reports what actually happened, not what sounds good. Progress is measured in real saved chapters and real word counts — never invented.",
  },
];

const STATUS_STYLES: Record<string, string> = {
  live: "bg-success-surface-strong text-success-text-heading border-success-border",
  "in-progress": "bg-warning-surface-strong text-warning-text-heading border-warning-border",
  planned: "bg-muted text-muted-foreground",
};

const STATUS_LABELS: Record<string, string> = {
  live: "Live now",
  "in-progress": "In progress",
  planned: "Planned",
};

interface AboutPageProps {
  onEnterWriter: () => void;
}

export function AboutPage({ onEnterWriter }: AboutPageProps) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
      {/* Mission */}
      <div className="text-center">
        <Badge variant="outline" className="mb-4">
          About Us
        </Badge>
        <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
          We build the team we always wanted as writers
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          {BRAND.positioning}
        </p>
      </div>

      {/* Principles */}
      <div className="mt-14 grid gap-5 md:grid-cols-3">
        {PRINCIPLES.map((p) => (
          <Card key={p.title}>
            <CardHeader>
              <CardTitle className="font-display text-lg">{p.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className={TEXT_PROSE}>
                {p.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Vision */}
      <section className="mt-16">
        <h2 className="font-display text-2xl font-bold">Where Novara is going</h2>
        <p className="mt-3 text-muted-foreground">
          Novara AI is under active development. We ship in phases, and each
          phase has to earn its place before the next one begins. Here is the
          current map — and an honest account of where we are today.
        </p>
        <ol className="mt-8 space-y-4">
          {ROADMAP.map((phase) => (
            <li
              key={phase.phase}
              className="flex flex-col gap-3 rounded-lg border bg-card p-5 sm:flex-row sm:items-start"
            >
              <div className="flex w-24 shrink-0 flex-col items-start gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {phase.phase}
                </span>
                <Badge
                  variant="outline"
                  className={cn("text-caption", STATUS_STYLES[phase.status])}
                >
                  {STATUS_LABELS[phase.status]}
                </Badge>
              </div>
              <div>
                <h3 className="font-semibold">{phase.title}</h3>
                <p className={cn("mt-1", TEXT_PROSE)}>
                  {phase.description}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Contact CTA */}
      <section className="mt-16 rounded-xl border bg-secondary/60 p-8 text-center">
        <h2 className="font-display text-2xl font-bold">
          Come write the first page with us
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
          Enter the AI Writer and see the workspace for yourself, or reach out
          — we read everything.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button onClick={onEnterWriter}>Enter AI Writer</Button>
          <Button variant="outline" asChild>
            <a href={`mailto:${BRAND.contactEmail}`}>Contact us</a>
          </Button>
        </div>
      </section>
    </div>
  );
}
