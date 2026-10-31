"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";

/** Subtle fade + 8px rise used to animate tab content switches. */
export function FadeIn({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
