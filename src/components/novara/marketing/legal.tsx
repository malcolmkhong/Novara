"use client";

import { Badge } from "@/components/ui/badge";
import { BRAND } from "@/config/novara";
import { cn } from "@/lib/utils";
import { TEXT_PROSE } from "@/components/novara/styles";

type LegalKind = "terms" | "privacy";

const LAST_UPDATED = "November 2026";

const TERMS_SECTIONS: { heading: string; body: string[] }[] = [
  {
    heading: "1. About these terms",
    body: [
      "These terms govern your use of the Novara AI website and writing application. Novara AI is currently in a public preview stage: features are still being built, and these terms will be updated as accounts, subscriptions and payments are introduced.",
    ],
  },
  {
    heading: "2. The service",
    body: [
      "Novara AI provides software tools that assist with planning, drafting, editing and organizing fictional works. The service currently operates in guest mode — no account is required, and no subscription or payment state exists while the payment gateway is pending development.",
      "AI-generated output is assistance, not a guarantee. You are responsible for reviewing, editing and approving anything you choose to publish.",
    ],
  },
  {
    heading: "3. Your content",
    body: [
      "You retain full ownership of the novels, chapters, characters, world settings and any other content you create or import into Novara AI. We claim no rights over your manuscripts.",
      "You are responsible for the content you create and for ensuring it complies with the laws and platform rules that apply where you publish it.",
    ],
  },
  {
    heading: "4. No income guarantee",
    body: [
      "Novara AI provides creation tools only. We do not guarantee publication, readership, or any commercial outcome. Earnings from your work — if any — depend on quality, market demand, platform rules and your own operations.",
    ],
  },
  {
    heading: "5. Availability & changes",
    body: [
      "The service is provided \u201cas is\u201d during the preview period, without warranties of any kind. Features may change, and stored data may be reset between preview builds. Export your work regularly using the built-in backup feature.",
    ],
  },
  {
    heading: "6. Contact",
    body: [
      `Questions about these terms can be sent to ${BRAND.contactEmail}.`,
    ],
  },
];

const PRIVACY_SECTIONS: { heading: string; body: string[] }[] = [
  {
    heading: "1. Summary",
    body: [
      "This preview build of Novara AI is designed to collect as little as possible: no accounts, no tracking, no advertising. This policy explains what is stored and why. It will be updated before accounts or payments launch.",
    ],
  },
  {
    heading: "2. What we store",
    body: [
      "Your novel content (titles, synopses, chapters, characters, world settings, outlines) is stored in the application database so the workspace can function. It is used solely to provide the product back to you.",
      "A small \u201cguest session\u201d record may be stored in your browser's local storage when you enter the AI Writer. It contains only a timestamp and never leaves your browser.",
    ],
  },
  {
    heading: "3. What we do not do",
    body: [
      "We do not sell or share your manuscripts or personal data. We do not run third-party advertising or tracking scripts.",
      "When you use AI-assisted drafting, the relevant story context is sent to the language model provider to generate text for you. It is not used to train models by Novara AI.",
    ],
  },
  {
    heading: "4. Data portability",
    body: [
      "You can export any novel as a portable JSON backup file at any time from the AI Writer, and re-import it later. Your work is yours to take away.",
    ],
  },
  {
    heading: "5. Changes & contact",
    body: [
      "As Novara AI adds accounts and subscriptions, this policy will be revised and re-published before those features go live. Questions can be sent to " +
        BRAND.contactEmail +
        ".",
    ],
  },
];

export function LegalPage({ kind }: { kind: LegalKind }) {
  const isTerms = kind === "terms";
  const sections = isTerms ? TERMS_SECTIONS : PRIVACY_SECTIONS;
  const title = isTerms ? "Terms of Service" : "Privacy Policy";

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <div className="flex items-center gap-3">
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
          {title}
        </h1>
        <Badge variant="outline">Preview draft</Badge>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Last updated: {LAST_UPDATED}
      </p>

      <div className="mt-10 max-w-[40rem] space-y-8">
        {sections.map((section) => (
          <section key={section.heading}>
            <h2 className="font-display text-lg font-semibold">
              {section.heading}
            </h2>
            {section.body.map((paragraph, i) => (
              <p
                key={i}
                className={cn("mt-3", TEXT_PROSE)}
              >
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>

      <p className="mt-12 rounded-lg border bg-secondary/50 p-4 text-xs leading-relaxed text-muted-foreground">
        This document is a preview draft provided for transparency during
        development. It is not legal advice and will be replaced with final
        versions before any commercial launch.
      </p>
    </div>
  );
}
