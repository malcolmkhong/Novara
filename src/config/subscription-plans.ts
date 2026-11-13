// ---------------------------------------------------------------------------
// Novara AI — Subscription configuration (single source of truth for plans)
//
// IMPORTANT: The payment gateway is NOT developed yet. This file only defines
// plan metadata for display. Nothing here grants, stores or fakes a
// subscription state. When the payment gateway arrives, its adapter should
// consume this config instead of hard-coding plans elsewhere.
// ---------------------------------------------------------------------------

export const PAYMENT_GATEWAY_STATUS = {
  developed: false,
  label: "Payment gateway pending development",
  note: "Plans below define the intended packaging. Checkout is not available yet — no payment can be made and no subscription state is created.",
} as const;

export type UsageAmount = number | "unlimited";

export interface PlanLimits {
  novels: UsageAmount;
  aiDraftWordsPerMonth: UsageAmount;
  /** "core" = drafting & editing agents only; "all" = full five-agent team */
  agentTeam: "core" | "all";
  continuityChecks: boolean;
  exportFormats: string[];
  importFromBackup: boolean;
  support: string;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  tagline: string;
  monthlyPrice: number; // display only — no checkout exists yet
  currency: string;
  features: string[];
  limits: PlanLimits;
  highlighted: boolean;
  badge?: string;
  /** Whether the plan's CTA can actually be used today (only free, until payments exist) */
  ctaAvailable: boolean;
  ctaLabel: string;
}

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: "free",
    name: "Free",
    tagline: "Try the full writing workspace with no commitment.",
    monthlyPrice: 0,
    currency: "USD",
    features: [
      "1 novel project",
      "10,000 AI draft words / month",
      "Core agents: Novel Writer & Editor",
      "Chapter editor & story bible",
      "JSON backup export & import",
      "Community support",
    ],
    limits: {
      novels: 1,
      aiDraftWordsPerMonth: 10000,
      agentTeam: "core",
      continuityChecks: false,
      exportFormats: ["JSON backup"],
      importFromBackup: true,
      support: "Community",
    },
    highlighted: false,
    ctaAvailable: true,
    ctaLabel: "Start with Free",
  },
  {
    id: "creator",
    name: "Creator",
    tagline: "For writers shipping a serious long-form project.",
    monthlyPrice: 19,
    currency: "USD",
    features: [
      "5 novel projects",
      "100,000 AI draft words / month",
      "Full AI team (all 5 agents)",
      "Continuity checking on every chapter",
      "JSON backup + Markdown export",
      "Priority task queue",
      "Email support",
    ],
    limits: {
      novels: 5,
      aiDraftWordsPerMonth: 100000,
      agentTeam: "all",
      continuityChecks: true,
      exportFormats: ["JSON backup", "Markdown"],
      importFromBackup: true,
      support: "Email",
    },
    highlighted: true,
    badge: "Most popular",
    ctaAvailable: false,
    ctaLabel: "Choose Creator",
  },
  {
    id: "studio",
    name: "Studio",
    tagline: "For prolific authors and small fiction studios.",
    monthlyPrice: 49,
    currency: "USD",
    features: [
      "Unlimited novel projects",
      "400,000 AI draft words / month",
      "Full AI team (all 5 agents)",
      "Continuity checking + consistency doctor",
      "All export formats",
      "Early access to new agent features",
      "Priority support",
    ],
    limits: {
      novels: "unlimited",
      aiDraftWordsPerMonth: 400000,
      agentTeam: "all",
      continuityChecks: true,
      exportFormats: ["JSON backup", "Markdown", "TXT"],
      importFromBackup: true,
      support: "Priority",
    },
    highlighted: false,
    ctaAvailable: false,
    ctaLabel: "Choose Studio",
  },
];

export function getPlan(id: string): SubscriptionPlan | undefined {
  return SUBSCRIPTION_PLANS.find((p) => p.id === id);
}

/** Which billing period a price is quoted for. Annual pricing is display-only
    — the payment gateway still does not exist. */
export type BillingCycle = "monthly" | "annual";

export function formatPrice(
  plan: SubscriptionPlan,
  cycle: BillingCycle = "monthly",
): string {
  if (plan.monthlyPrice === 0) return "$0";
  if (cycle === "monthly") return `$${plan.monthlyPrice}`;
  // Annual is charged as ten monthly payments, shown as the equivalent
  // monthly rate so the saving is legible at a glance.
  return `$${Math.round((plan.monthlyPrice * 10) / 12)}`;
}

/** The yearly amount actually billed, or null when it does not apply. */
export function formatAnnualTotal(
  plan: SubscriptionPlan,
  cycle: BillingCycle,
): string | null {
  if (cycle !== "annual" || plan.monthlyPrice === 0) return null;
  return `$${plan.monthlyPrice * 10} billed yearly`;
}

export function formatLimit(v: UsageAmount): string {
  return v === "unlimited" ? "Unlimited" : v.toLocaleString("en-US");
}
