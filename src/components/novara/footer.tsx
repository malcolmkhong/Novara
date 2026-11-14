"use client";

import { BRAND } from "@/config/novara";
import { BrandMark } from "./brand-logo";
import { cn } from "@/lib/utils";
import { TEXT_META, TEXT_PROSE, TEXT_HEADING } from "@/components/novara/styles";

interface FooterProps {
  onEnterWriter: () => void;
}

/**
 * The footer link style, in one place.
 *
 * The footer used to repeat this exact class string on all eight of its
 * links, and every one of them is the same kind of thing: a quiet,
 * full-height row that brightens on hover. A shared constant keeps the
 * eight from drifting apart.
 */
const LINK_CLASS =
  "inline-flex min-h-6 items-center text-muted-foreground transition-colors hover:text-primary";

export function Footer({ onEnterWriter }: FooterProps) {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t bg-secondary/50">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center">
                <BrandMark className="size-8" />
              </span>
              <span className={TEXT_HEADING}>
                {BRAND.name}
              </span>
            </div>
            <p className={TEXT_PROSE}>
              {BRAND.tagline}. Plan, write, edit and manage long-form novels
              with a coordinated AI team.
            </p>
          </div>

          <nav aria-label="Footer — product">
            <h3 className="mb-3 text-sm font-semibold">Product</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <a href="#/product" className={LINK_CLASS}>
                  Product
                </a>
              </li>
              <li>
                <a href="#/plans" className={LINK_CLASS}>
                  Subscription Plans
                </a>
              </li>
              <li>
                <button type="button" onClick={onEnterWriter} className={LINK_CLASS}>
                  AI Writer
                </button>
              </li>
            </ul>
          </nav>

          <nav aria-label="Footer — company">
            <h3 className="mb-3 text-sm font-semibold">Company</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <a href="#/about" className={LINK_CLASS}>
                  About Us
                </a>
              </li>
              <li>
                <a href={`mailto:${BRAND.contactEmail}`} className={LINK_CLASS}>
                  Contact
                </a>
              </li>
            </ul>
          </nav>

          <nav aria-label="Footer — account and legal">
            <h3 className="mb-3 text-sm font-semibold">Account & Legal</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <button type="button" onClick={onEnterWriter} className={LINK_CLASS}>
                  Login
                </button>
              </li>
              <li>
                <a href="#/terms" className={LINK_CLASS}>
                  Terms of Service
                </a>
              </li>
              <li>
                <a href="#/privacy" className={LINK_CLASS}>
                  Privacy Policy
                </a>
              </li>
            </ul>
          </nav>
        </div>

        <div className={cn("mt-10 flex flex-col items-start justify-between gap-2 border-t pt-6", TEXT_META, "sm:flex-row sm:items-center")}>
          <p>
            © {year} {BRAND.name}. All rights reserved.
          </p>
          <p>Payment gateway pending development — plans are not yet purchasable.</p>
        </div>
      </div>
    </footer>
  );
}
