import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Novara AI — Your AI Novel Writing Team",
  description:
    "Novara AI coordinates a team of specialized AI agents — story architecture, worldbuilding, characters, plotting, drafting, editing and continuity — to take your novel from concept to a full-length manuscript.",
  keywords: [
    "Novara AI",
    "AI novel writing",
    "AI writing team",
    "novel planning",
    "worldbuilding",
    "web novel",
    "fiction writing assistant",
  ],
  authors: [{ name: "Novara AI" }],
  openGraph: {
    title: "Novara AI — Your AI Novel Writing Team",
    description:
      "Plan, write, edit and manage long-form novels with a coordinated AI team.",
    siteName: "Novara AI",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
