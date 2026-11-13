"use client";

// ---------------------------------------------------------------------------
// The hero. Two jobs: state the promise in one line, and prove the product
// works by showing the team actually doing something.
//
// The mock on the right is not a screenshot — it runs. Chapters advance, prose
// fills in line by line, and the active agent changes with the chapter. It is
// the only thing on the page that demonstrates the product instead of
// describing it.
// ---------------------------------------------------------------------------

import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";
import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BRAND, HERO_STATS } from "@/config/novara";
import { cn } from "@/lib/utils";
import { CountUp, EASE_OUT_EXPO, MaskLine } from "./motion";

const MOCK_CHAPTERS = [
  { name: "Chapter 1", words: "2,412" },
  { name: "Chapter 2", words: "1,874" },
  { name: "Chapter 3", words: "2,208" },
  { name: "Chapter 4", words: "1,655" },
];

const MOCK_LINES = [
  { width: "w-11/12", accent: false },
  { width: "w-full", accent: false },
  { width: "w-10/12", accent: false },
  { width: "w-9/12", accent: true },
  { width: "w-full", accent: false },
  { width: "w-2/3", accent: false },
  { width: "w-5/6", accent: false },
];

const MOCK_AGENTS = [
  { name: "Atlas", role: "Leader" },
  { name: "Sage", role: "Writer" },
  { name: "Prism", role: "Analyst" },
  { name: "Nova", role: "Researcher" },
];

const TICK_MS = 420;
const LINES_PER_CHAPTER = 8;

// ---------------------------------------------------------------------------
// Backdrop — grain, grid and three drifting light sources that react to the
// pointer. The pointer offset is a spring, not a raw value, so the light
// trails the cursor instead of snapping to it.
// ---------------------------------------------------------------------------

function HeroBackdrop({
  pointerX,
  pointerY,
}: {
  pointerX: ReturnType<typeof useMotionValue<number>>;
  pointerY: ReturnType<typeof useMotionValue<number>>;
}) {
  const reduce = useReducedMotion();

  const smoothX = useSpring(pointerX, { stiffness: 55, damping: 18, mass: 0.7 });
  const smoothY = useSpring(pointerY, { stiffness: 55, damping: 18, mass: 0.7 });

  const aX = useTransform(smoothX, [-1, 1], [34, -34]);
  const aY = useTransform(smoothY, [-1, 1], [24, -24]);
  const bX = useTransform(smoothX, [-1, 1], [-28, 28]);
  const bY = useTransform(smoothY, [-1, 1], [-20, 20]);
  const cX = useTransform(smoothX, [-1, 1], [18, -18]);
  const cY = useTransform(smoothY, [-1, 1], [-30, 30]);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Warm-tinted base. A flat slab of stone-950 read as a hole in the
          page; this reads as a lit surface. */}
      <div className="absolute inset-0 bg-[radial-gradient(115%_85%_at_50%_-12%,oklch(0.24_0.02_62)_0%,oklch(0.17_0.012_60)_42%,oklch(0.12_0.008_60)_100%)]" />

      <div className="hero-grid absolute inset-0 opacity-70" />

      <motion.div style={{ x: aX, y: aY }} className="absolute -top-40 left-[4%]">
        <div className="h-[30rem] w-[30rem] animate-float-slow rounded-full bg-amber-500/20 blur-[130px]" />
      </motion.div>
      <motion.div style={{ x: bX, y: bY }} className="absolute -bottom-52 right-[-6%]">
        <div className="h-[28rem] w-[28rem] animate-float-slower rounded-full bg-orange-600/[0.14] blur-[130px]" />
      </motion.div>
      <motion.div style={{ x: cX, y: cY }} className="absolute left-[46%] top-[28%]">
        <div className="h-[16rem] w-[16rem] rounded-full bg-amber-300/[0.07] blur-[100px]" />
      </motion.div>

      {/* Vignette keeps the focus in the middle of the frame. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_75%_60%_at_50%_45%,transparent_30%,oklch(0.12_0.008_60)_100%)] opacity-80" />

      {!reduce && <div className="grain absolute inset-0" />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The live mock.
// ---------------------------------------------------------------------------

function HeroMock() {
  const reduce = useReducedMotion();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => window.clearInterval(id);
  }, [reduce]);

  // With reduced motion the simulation is frozen on a complete-looking frame
  // rather than being left half-empty.
  const effectiveTick = reduce ? LINES_PER_CHAPTER - 1 : tick;
  const chapterIndex = Math.floor(effectiveTick / LINES_PER_CHAPTER) % MOCK_CHAPTERS.length;
  const lineCount = effectiveTick % LINES_PER_CHAPTER;
  const activeAgent = chapterIndex % MOCK_AGENTS.length;

  return (
    <div
      aria-hidden="true"
      className="relative w-full overflow-hidden rounded-2xl border border-stone-800/80 bg-stone-900/60 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] backdrop-blur-sm"
    >
      <div className="flex items-center gap-2 border-b border-stone-800/80 px-4 py-3">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-stone-700" />
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-stone-700" />
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-stone-700" />
        <span className="ml-3 text-xs text-stone-400">Novara AI — Writer</span>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-amber-400" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" />
          </span>
          LIVE
        </span>
      </div>

      <div className="flex">
        <div className="w-32 shrink-0 border-r border-stone-800/80 p-4 sm:w-40">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
            Chapters
          </p>
          <div className="mt-3 space-y-1.5">
            {MOCK_CHAPTERS.map((chapter, index) => {
              const active = index === chapterIndex;
              return (
                <div key={chapter.name} className="relative rounded-md px-2.5 py-1.5">
                  {active && (
                    <motion.span
                      layoutId="hero-mock-chapter"
                      className="absolute inset-0 rounded-md bg-stone-800/80"
                      transition={{ duration: 0.45, ease: EASE_OUT_EXPO }}
                    />
                  )}
                  <div
                    className={cn(
                      "relative text-xs font-medium transition-colors duration-300",
                      active ? "text-amber-300" : "text-stone-400",
                    )}
                  >
                    {chapter.name}
                  </div>
                  <div className="relative text-[11px] text-stone-500">{chapter.words} words</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="min-w-0 flex-1 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="truncate text-xs font-medium text-stone-400">
              {MOCK_CHAPTERS[chapterIndex].name} · Draft
            </span>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-stone-700 px-2 py-0.5 text-[10px] text-stone-400">
              <span aria-hidden="true" className="h-1 w-1 rounded-full bg-amber-400" />
              Drafting
            </span>
          </div>
          <div className="mt-4 space-y-2.5">
            {MOCK_LINES.map((line, index) => {
              const visible = index < lineCount;
              return (
                <motion.div
                  key={index}
                  className={cn(
                    "h-2 origin-left rounded-full",
                    line.width,
                    line.accent ? "bg-amber-500/70" : "bg-stone-800",
                  )}
                  initial={false}
                  animate={{ opacity: visible ? 1 : 0.2, scaleX: visible ? 1 : 0.86 }}
                  transition={{ duration: 0.42, ease: EASE_OUT_EXPO }}
                />
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-stone-800/80 px-4 py-3">
        {MOCK_AGENTS.map((agent, index) => {
          const active = index === activeAgent;
          return (
            <span
              key={agent.name}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors duration-300",
                active
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                  : "border-stone-800 bg-stone-900/60 text-stone-500",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "h-1.5 w-1.5 rounded-full transition-colors duration-300",
                  active ? "bg-amber-300" : "bg-stone-700",
                )}
              />
              {agent.name} · {agent.role}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The hero section.
// ---------------------------------------------------------------------------

export function Hero({ onEnterWriter }: { onEnterWriter: () => void }) {
  const reduce = useReducedMotion();
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (reduce) return;
    const rect = event.currentTarget.getBoundingClientRect();
    pointerX.set(((event.clientX - rect.left) / rect.width) * 2 - 1);
    pointerY.set(((event.clientY - rect.top) / rect.height) * 2 - 1);
  };

  return (
    <section
      aria-labelledby="home-hero-heading"
      onPointerMove={handlePointerMove}
      className="relative isolate overflow-hidden bg-stone-950 text-stone-50"
    >
      <HeroBackdrop pointerX={pointerX} pointerY={pointerY} />

      <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-28 sm:px-6 sm:pt-32 lg:pb-24 lg:pt-36">
        <div className="grid items-center gap-14 lg:grid-cols-[1.02fr_1fr] lg:gap-16">
          <div>
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.05, ease: EASE_OUT_EXPO }}
              className="inline-flex items-center gap-2 rounded-full border border-amber-400/25 bg-amber-400/[0.07] px-3.5 py-1.5 text-xs font-medium text-amber-200 backdrop-blur-sm"
            >
              <span aria-hidden="true" className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-amber-400" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" />
              </span>
              AI-Powered Novel Writing Team
            </motion.div>

            <h1
              id="home-hero-heading"
              className="mt-6 font-display text-[2.6rem] font-bold leading-[1.02] tracking-[-0.02em] sm:text-6xl lg:text-[4.1rem]"
            >
              {BRAND.taglineLines.map((line, index) => (
                <MaskLine key={line} delay={0.12 + index * 0.09}>
                  {index === BRAND.taglineLines.length - 1 ? (
                    <span className="text-ember">{line}</span>
                  ) : (
                    line
                  )}
                </MaskLine>
              ))}
            </h1>

            <motion.p
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.75, delay: 0.34, ease: EASE_OUT_EXPO }}
              className="mt-6 max-w-lg text-lg leading-relaxed text-stone-300"
            >
              A coordinated team of five specialized AI agents — a leader, a
              writer, a researcher, an analyst and an engineer. They take your
              novel from one-line concept to complete manuscript, and keep it
              consistent from the first page to the last.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.75, delay: 0.44, ease: EASE_OUT_EXPO }}
              className="mt-8 flex flex-wrap items-center gap-3"
            >
              <Button size="lg" className="sheen group" onClick={onEnterWriter}>
                Start Creating
                <ArrowRight
                  className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1"
                  aria-hidden="true"
                />
              </Button>
              <Button
                size="lg"
                variant="outline"
                asChild
                className="group border-stone-700 bg-white/[0.02] text-stone-200 backdrop-blur-sm hover:border-stone-600 hover:bg-white/[0.06] hover:text-stone-50"
              >
                <a href="#/product">
                  Explore Features
                  <ArrowRight
                    className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1"
                    aria-hidden="true"
                  />
                </a>
              </Button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.75, delay: 0.54, ease: EASE_OUT_EXPO }}
              className="mt-12 grid grid-cols-2 gap-x-6 gap-y-6 border-t border-stone-800/80 pt-8 xl:grid-cols-4"
            >
              {HERO_STATS.map((stat) => (
                <div key={stat.label} className="min-w-0">
                  <div className="font-display text-xl font-bold text-amber-400">
                    {stat.count && stat.count > 0 ? (
                      <>
                        {stat.prefix}
                        <CountUp
                          to={stat.count}
                          format={(n) => Math.round(n).toLocaleString("en-US")}
                        />
                      </>
                    ) : (
                      stat.value
                    )}
                  </div>
                  <div className="mt-1 text-xs leading-relaxed text-stone-400">
                    {stat.label}
                  </div>
                </div>
              ))}
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 34, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 1, delay: 0.26, ease: EASE_OUT_EXPO }}
            className="relative"
          >
            <div
              aria-hidden="true"
              className="absolute -inset-6 rounded-[2rem] bg-amber-500/[0.06] blur-2xl"
            />
            <div className="relative">
              <HeroMock />
            </div>
          </motion.div>
        </div>
      </div>

      {/* Screen-reader description of what the decorative mock shows. */}
      <p className="sr-only">
        The Novara AI writer workspace shows a chapter list beside a live draft
        panel, with the team’s agents — Atlas, Sage, Prism and Nova — taking
        turns drafting, analysing and researching.
      </p>
    </section>
  );
}