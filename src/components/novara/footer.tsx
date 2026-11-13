"use client";

import { PenLine } from "lucide-react";
import { BRAND } from "@/config/novara";

interface FooterProps {
  onEnterWriter: () => void;
}

export function Footer({ onEnterWriter }: FooterProps) {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t bg-secondary/50">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <PenLine className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="font-display text-xl font-bold">
                {BRAND.name}
              </span>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {BRAND.tagline}. Plan, write, edit and manage long-form novels
              with a coordinated AI team.
            </p>
          </div>

          <nav aria-label="Footer — product">
            <h3 className="mb-3 text-sm font-semibold">Product</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <a
                  href="#/product"
                  className="inline-flex min-h-6 items-center text-muted-foreground transition-colors hover:text-primary"
                >
                  Product
                </a>
              </li>
              <li>
                <a
                  href="#/plans"
                  className="inline-flex min-h-6 items-center text-muted-foreground transition-colors hover:text-primary"
                >
                  Subscription Plans
                </a>
              </li>
              <li>
                <button
                  type="button"
                  onClick={onEnterWriter}
                  className="inline-flex min-h-6 items-center text-muted-foreground transition-colors hover:text-primary"
                >
                  AI Writer
                </button>
              </li>
            </ul>
          </nav>

          <nav aria-label="Footer — company">
            <h3 className="mb-3 text-sm font-semibold">Company</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <a
                  href="#/about"
                  className="inline-flex min-h-6 items-center text-muted-foreground transition-colors hover:text-primary"
                >
                  About Us
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${BRAND.contactEmail}`}
                  className="inline-flex min-h-6 items-center text-muted-foreground transition-colors hover:text-primary"
                >
                  Contact
                </a>
              </li>
            </ul>
          </nav>

          <nav aria-label="Footer — account and legal">
            <h3 className="mb-3 text-sm font-semibold">Account & Legal</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <button
                  type="button"
                  onClick={onEnterWriter}
                  className="inline-flex min-h-6 items-center text-muted-foreground transition-colors hover:text-primary"
                >
                  Login
                </button>
              </li>
              <li>
                <a
                  href="#/terms"
                  className="inline-flex min-h-6 items-center text-muted-foreground transition-colors hover:text-primary"
                >
                  Terms of Service
                </a>
              </li>
              <li>
                <a
                  href="#/privacy"
                  className="inline-flex min-h-6 items-center text-muted-foreground transition-colors hover:text-primary"
                >
                  Privacy Policy
                </a>
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-2 border-t pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <p>
            © {year} {BRAND.name}. All rights reserved.
          </p>
          <p>Payment gateway pending development — plans are not yet purchasable.</p>
        </div>
      </div>
    </footer>
  );
}
