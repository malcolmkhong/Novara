import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * The Novara type scale adds four sizes to Tailwind's built-in names:
 * `text-micro`, `text-tiny`, `text-caption` and `text-small`.
 *
 * `tailwind-merge` only recognises Tailwind's own scale names and treats
 * every other `text-…` class as a *colour*. Without this registration,
 * `cn("text-caption text-muted-foreground")` would silently drop the size
 * and keep only the colour, because the two would look like two competing
 * colours. Listing the Novara sizes here keeps the merge result equal to
 * what the class list actually means.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["micro", "tiny", "caption", "small"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
