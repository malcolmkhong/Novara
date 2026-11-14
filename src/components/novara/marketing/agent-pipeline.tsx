"use client";

// ---------------------------------------------------------------------------
// The Leader → Sub-agent diagram.
//
// This is drawn as one SVG rather than as HTML boxes joined by CSS borders.
// The previous version positioned the connector lines with percentage left
// and right values, which silently drifted off the chip centres as soon as
// the labels had different widths. In SVG the geometry is declared once and
// the lines cannot fall out of alignment.
//
// The lines draw themselves in when the section scrolls into view, and a
// highlight then travels the trunk on a loop so the diagram reads as live
// delegation rather than a static illustration.
// ---------------------------------------------------------------------------

import { motion, useReducedMotion } from "framer-motion";
import { EASE_OUT_EXPO } from "./motion";

const SUB_AGENTS = [
  { label: "Structure", x: 120 },
  { label: "World & characters", x: 360 },
  { label: "Prose", x: 600 },
];

const NODE_WIDTH = 176;
const BUS_Y = 128;
const DROP_END_Y = 172;
const NODE_TOP = 202;
const NODE_HEIGHT = 56;

const TRUNK = "M360 70 L360 128";
const BUS = "M120 128 L600 128";
const DROP_LEFT = "M120 128 L120 172";
const DROP_MIDDLE = "M360 128 L360 172";
const DROP_RIGHT = "M600 128 L600 172";

export function AgentPipeline() {
  const reduce = useReducedMotion();

  const draw = (delay: number) => ({
    initial: { pathLength: 0, opacity: 0 },
    whileInView: { pathLength: 1, opacity: 1 },
    viewport: { once: true, amount: 0.4 },
    transition: { duration: 0.75, delay, ease: EASE_OUT_EXPO },
  });

  return (
    <div className="mx-auto w-full max-w-3xl">
      <svg
        viewBox="0 0 720 280"
        className="h-auto w-full overflow-visible"
        role="img"
        aria-label="The Leader Agent delegates to three specialised sub-agents: structure, world and characters, and prose."
      >
        {/* Base rails — always visible so the diagram is not empty before
            the draw animation runs. */}
        <g className="stroke-primary/25" fill="none" strokeWidth={1.5}>
          <path d={TRUNK} />
          <path d={BUS} />
          <path d={DROP_LEFT} />
          <path d={DROP_MIDDLE} />
          <path d={DROP_RIGHT} />
        </g>

        {/* Animated rails drawn on top of the base. */}
        <g fill="none" strokeWidth={1.75}>
          <motion.path
            d={TRUNK}
            className="stroke-primary"
            {...draw(0.05)}
          />
          <motion.path d={BUS} className="stroke-primary" {...draw(0.22)} />
          <motion.path d={DROP_LEFT} className="stroke-primary" {...draw(0.42)} />
          <motion.path d={DROP_MIDDLE} className="stroke-primary" {...draw(0.5)} />
          <motion.path d={DROP_RIGHT} className="stroke-primary" {...draw(0.58)} />
        </g>

        {/* A highlight travelling the trunk and the bus. */}
        {!reduce && (
          <g fill="none" strokeWidth={2.5} strokeLinecap="round">
            <motion.path
              d={TRUNK}
              className="stroke-amber-400"
              initial={{ strokeDasharray: "8 80", strokeDashoffset: 0, opacity: 0 }}
              animate={{ strokeDashoffset: 80, opacity: [0, 1, 1, 0] }}
              transition={{
                duration: 2.6,
                times: [0, 0.15, 0.8, 1],
                repeat: Infinity,
                ease: "linear",
                repeatDelay: 0.8,
              }}
            />
            <motion.path
              d={BUS}
              className="stroke-amber-400"
              initial={{ strokeDasharray: "16 520", strokeDashoffset: 0, opacity: 0 }}
              animate={{ strokeDashoffset: 520, opacity: [0, 1, 1, 0] }}
              transition={{
                duration: 2.6,
                times: [0, 0.15, 0.8, 1],
                repeat: Infinity,
                ease: "linear",
                repeatDelay: 0.8,
                delay: 0.42,
              }}
            />
          </g>
        )}
        {/* Leader node. */}
        <motion.g
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: -10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.6, ease: EASE_OUT_EXPO }}
        >
          <rect
            x="225"
            y="16"
            width="270"
            height="54"
            rx="27"
            className="fill-primary/10 stroke-primary/40"
            strokeWidth={1.5}
          />
          <circle cx="262" cy="43" r="4" className="fill-primary" />
          <text
            x="360"
            y="49"
            textAnchor="middle"
            className="fill-primary font-sans text-[15px] font-semibold"
          >
            Leader Agent
          </text>
        </motion.g>

        {/* Sub-agent nodes. */}
        {SUB_AGENTS.map((agent, index) => {
          const x = agent.x - NODE_WIDTH / 2;
          return (
            <motion.g
              key={agent.label}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{
                duration: 0.6,
                delay: 0.6 + index * 0.11,
                ease: EASE_OUT_EXPO,
              }}
            >
              <text
                x={agent.x}
                y="192"
                textAnchor="middle"
                className="fill-muted-foreground font-sans text-micro font-semibold uppercase tracking-[0.18em]"
              >
                Sub-agent
              </text>
              <rect
                x={x}
                y={NODE_TOP}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={NODE_HEIGHT / 2}
                className="fill-card stroke-border"
                strokeWidth={1.5}
              />
              <text
                x={agent.x}
                y={NODE_TOP + 34}
                textAnchor="middle"
                className="fill-foreground font-sans text-[14px] font-medium"
              >
                {agent.label}
              </text>
            </motion.g>
          );
        })}
      </svg>
    </div>
  );
}