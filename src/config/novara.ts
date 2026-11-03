import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Clock,
  Compass,
  DollarSign,
  FileDown,
  Globe2,
  Layers,
  ListOrdered,
  PenLine,
  Puzzle,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
  Workflow,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Site navigation
// ---------------------------------------------------------------------------

export interface NavLink {
  label: string;
  route: string; // hash route, e.g. "product" -> "#/product"
}

export const NAV_LINKS: NavLink[] = [
  { label: "Home", route: "home" },
  { label: "Product", route: "product" },
  { label: "Plans", route: "plans" },
  { label: "About", route: "about" },
];

// ---------------------------------------------------------------------------
// Hero stats
// ---------------------------------------------------------------------------

export const HERO_STATS = [
  { value: "5", label: "Specialized AI agents" },
  { value: "1", label: "Shared story bible" },
  { value: "~100,000", label: "Words per novel pipeline" },
  { value: "0", label: "Continuity drift target" },
];

// ---------------------------------------------------------------------------
// Section 2 — The Problem
// ---------------------------------------------------------------------------

export interface ProblemCard {
  icon: LucideIcon;
  title: string;
  description: string;
}

export const PROBLEMS: ProblemCard[] = [
  {
    icon: Clock,
    title: "Novels take enormous time",
    description:
      "A full-length novel means months of planning, drafting and rewriting — most projects stall long before the final chapter.",
  },
  {
    icon: Puzzle,
    title: "Planning & worldbuilding sprawl",
    description:
      "Timelines, magic systems, factions and character backstories pile up across scattered notes until nothing can be tracked reliably.",
  },
  {
    icon: Layers,
    title: "Long stories drift and contradict",
    description:
      "In chapter 30 the eye color changes. In chapter 45 a dead character reappears. Long novels quietly break their own rules.",
  },
  {
    icon: Workflow,
    title: "One author, four jobs",
    description:
      "Writing, editing, quality checking and project management all compete for the same person's attention — usually at the same time.",
  },
];

// ---------------------------------------------------------------------------
// Section 3 — Introducing Novara AI (value pillars)
// ---------------------------------------------------------------------------

export interface Pillar {
  icon: LucideIcon;
  title: string;
  description: string;
}

export const PILLARS: Pillar[] = [
  {
    icon: Users,
    title: "A team, not a text box",
    description:
      "A Leader Agent coordinates specialized sub-agents. Each one owns one discipline — structure, world, characters, plot, prose, editing or continuity.",
  },
  {
    icon: BookOpen,
    title: "Manages the whole journey",
    description:
      "Novara AI is not just generating paragraphs. It helps plan the book, maintain the world bible, track the outline and keep every chapter aligned with what came before.",
  },
  {
    icon: ShieldCheck,
    title: "Consistency as a feature",
    description:
      "Character states, world rules and story facts are recorded and checked as the manuscript grows — so chapter 60 still agrees with chapter 3.",
  },
];

// ---------------------------------------------------------------------------
// Section 4 — The AI Team
// ---------------------------------------------------------------------------

export interface AgentProfile {
  icon: LucideIcon;
  name: string;
  role: string;
  description: string;
  delivers: string;
}

export const AI_TEAM: AgentProfile[] = [
  {
    icon: Compass,
    name: "Atlas",
    role: "Team leader",
    description:
      "Turns your premise into a viable plan: evaluates the concept, decomposes it into concrete tasks, delegates every job across the team and verifies each result.",
    delivers: "Plans, task orders & verified results",
  },
  {
    icon: PenLine,
    name: "Sage",
    role: "Writer",
    description:
      "Drafts chapter prose that follows the outline, respects the story bible and keeps each character's voice consistent — one chapter at a time.",
    delivers: "Chapter drafts",
  },
  {
    icon: Globe2,
    name: "Nova",
    role: "Researcher",
    description:
      "Answers factual questions about your project — settings, characters, timeline, canon — pulling ground truth straight from the story bible.",
    delivers: "Ground-truth facts & lookups",
  },
  {
    icon: ScrollText,
    name: "Prism",
    role: "Analyst",
    description:
      "Reviews every draft for clarity, pacing and continuity, settles what happened into the story bible and flags contradictions before they reach readers.",
    delivers: "Review verdicts & canon updates",
  },
  {
    icon: Layers,
    name: "Forge",
    role: "Engineer",
    description:
      "Keeps the project library clean — assets, documents and exports stay organized, validated and ready to download at any time.",
    delivers: "Library hygiene & exports",
  },
];

// ---------------------------------------------------------------------------
// Section 5 — How It Works
// ---------------------------------------------------------------------------

export interface WorkflowStep {
  title: string;
  description: string;
}

export const HOW_IT_WORKS: WorkflowStep[] = [
  {
    title: "Input your novel concept",
    description:
      "Describe your idea — genre, premise, the story you want to tell. One paragraph is enough to start.",
  },
  {
    title: "AI Team builds the story foundation",
    description:
      "Atlas analyzes your concept and establishes the story's core structure and direction.",
  },
  {
    title: "World & characters are created",
    description:
      "Nova researches your premise while the team builds the setting bible and the cast that will carry your story.",
  },
  {
    title: "Plot & chapter outline",
    description:
      "Atlas shapes acts, volumes and chapter-level beats, so every chapter has a job to do.",
  },
  {
    title: "Sage drafts the chapters",
    description:
      "Chapters are written against the outline and the bible — one chapter at a time, in your review loop.",
  },
  {
    title: "Prism refines every chapter",
    description:
      "Drafts are reviewed for clarity, pacing and style, then revised until they meet the bar.",
  },
  {
    title: "The story bible stays honest",
    description:
      "Prism settles each finished chapter into the bible — settings, timelines, character states and open plot lines checked for contradictions.",
  },
  {
    title: "You review, refine and export",
    description:
      "You stay in the director's chair the whole time — approve, adjust, and Forge exports your finished manuscript.",
  },
];

// ---------------------------------------------------------------------------
// Section 6 — What can you create
// ---------------------------------------------------------------------------

export const GENRES = [
  "Fantasy",
  "Sci-Fi",
  "Romance",
  "Mystery & Thriller",
  "Xianxia / Cultivation",
  "Urban Fantasy",
  "Horror",
  "Historical",
  "LitRPG / Progression",
  "Adventure",
  "Slice of Life",
  "Drama",
];

export const NOVEL_FORMATS = [
  {
    icon: BookOpen,
    title: "Full-length novels",
    description:
      "Plan and draft a complete ~100,000-word novel with a managed pipeline: foundation, outline, chapter drafts, reviews and export.",
  },
  {
    icon: ListOrdered,
    title: "Serialized web novels",
    description:
      "Keep a long-running serial coherent for dozens or hundreds of chapters — hooks at chapter ends, and a bible that remembers everything.",
  },
  {
    icon: Store,
    title: "Commercial works",
    description:
      "Develop market-aware stories with clean structure and consistent canon, ready for self-publishing or platform submission.",
  },
];

// ---------------------------------------------------------------------------
// Section 7 — Who is Novara for
// ---------------------------------------------------------------------------

export interface Persona {
  icon: LucideIcon;
  title: string;
  description: string;
}

export const PERSONAS: Persona[] = [
  {
    icon: Sparkles,
    title: "First-time writers",
    description:
      "Get structure, feedback and a clear process instead of a blank page.",
  },
  {
    icon: PenLine,
    title: "Independent authors",
    description:
      "Turn a finished manuscript into a real product without hiring a full editorial team.",
  },
  {
    icon: BookOpen,
    title: "Web novel writers",
    description:
      "Keep long serials on schedule with a bible that never forgets a detail.",
  },
  {
    icon: Compass,
    title: "Aspiring authors",
    description:
      "Learn how stories are structured by watching a full novel pipeline run end to end.",
  },
  {
    icon: FileDown,
    title: "Content creators",
    description:
      "Produce fiction-based content — stories, serials, scripts — with consistent quality.",
  },
  {
    icon: Clock,
    title: "Busy writers",
    description:
      "Reduce manual work: let the team handle planning, tracking and first-pass review.",
  },
];

// ---------------------------------------------------------------------------
// Section 8 — Monetization opportunities
// ---------------------------------------------------------------------------

export interface MonetizationChannel {
  icon: LucideIcon;
  title: string;
  description: string;
}

export const MONETIZATION_CHANNELS: MonetizationChannel[] = [
  {
    icon: BookOpen,
    title: "WebNovel platforms",
    description:
      "Publish serialized chapters on web novel platforms and grow a readership chapter by chapter.",
  },
  {
    icon: Users,
    title: "Subscription reading platforms",
    description:
      "Offer your completed or ongoing work on subscription-based reading services.",
  },
  {
    icon: Store,
    title: "Self-publishing",
    description:
      "Take your finished manuscript directly to readers through self-publishing channels.",
  },
  {
    icon: FileDown,
    title: "E-books",
    description:
      "Export and format your novel as an e-book for storefronts and direct sales.",
  },
  {
    icon: Layers,
    title: "Paid chapter platforms",
    description:
      "Monetize ongoing stories with paywalled chapters where platforms support it.",
  },
  {
    icon: DollarSign,
    title: "Independent publishing",
    description:
      "Combine channels — serial first, then collected editions — on your own terms.",
  },
];

export const MONETIZATION_DISCLAIMER =
  "Novara AI provides creation tools — it does not guarantee income. Commercial results depend on your work's quality, market demand, platform rules and your own promotion and operations.";

// ---------------------------------------------------------------------------
// Roadmap (About page + Product page) — honest status markers
// ---------------------------------------------------------------------------

export interface RoadmapPhase {
  phase: string;
  title: string;
  description: string;
  status: "live" | "in-progress" | "planned";
}

export const ROADMAP: RoadmapPhase[] = [
  {
    phase: "Phase 1",
    title: "Core foundation",
    description:
      "Website, AI Writer workspace, novel/chapter/world/character data model, import & export.",
    status: "live",
  },
  {
    phase: "Phase 2",
    title: "Novel creation system",
    description:
      "Guided novel setup, story bible editor, outline tooling, AI-assisted drafting.",
    status: "in-progress",
  },
  {
    phase: "Phase 3",
    title: "Agent runtime",
    description:
      "Background AI tasks with verification — the Leader Agent starts orchestrating real writing work.",
    status: "planned",
  },
  {
    phase: "Phase 4",
    title: "RAG & story memory",
    description:
      "Long-range story memory: semantic retrieval over your novel so the AI remembers everything it wrote.",
    status: "planned",
  },
  {
    phase: "Phase 5",
    title: "Full AI team",
    description:
      "All five agents working in parallel with leader-verified results and progress visibility.",
    status: "planned",
  },
  {
    phase: "Phase 6",
    title: "Quality & optimization",
    description:
      "Quality gates, revision loops, consistency doctor and export polish.",
    status: "planned",
  },
];

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

export const BRAND = {
  name: "Novara AI",
  tagline: "Your AI Novel Writing Team",
  positioning:
    "Novara AI is not just an AI writing tool — it is an AI-powered Novel Creation System that helps you plan, write, edit and manage long-form fiction.",
  contactEmail: "hello@novara.ai",
};
