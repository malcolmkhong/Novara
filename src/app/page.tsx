import { FileSearch, ScanSearch, Zap } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AiDetectorPanel } from "@/components/detector/ai-detector-panel";
import { FadeIn } from "@/components/detector/fade-in";
import { HallucinationPanel } from "@/components/detector/hallucination-panel";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="w-full flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-10">
          {/* Header */}
          <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div
                className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm"
                aria-hidden="true"
              >
                <ScanSearch className="size-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                  TruthLab
                </h1>
                <p className="text-sm text-muted-foreground">
                  AI Detector &amp; Hallucination Detector
                </p>
              </div>
            </div>
            <Badge variant="outline" className="w-fit gap-1.5 px-3 py-1 text-xs">
              <Zap className="text-amber-500" aria-hidden="true" />
              Powered by GLM
            </Badge>
          </header>

          {/* Detector tabs */}
          <Tabs defaultValue="ai">
            <TabsList className="grid h-auto w-full grid-cols-1 sm:w-[560px] sm:grid-cols-2">
              <TabsTrigger value="ai" className="h-11 gap-2 px-4 sm:h-9">
                <ScanSearch aria-hidden="true" />
                AI Content Detector
              </TabsTrigger>
              <TabsTrigger value="hallucination" className="h-11 gap-2 px-4 sm:h-9">
                <FileSearch aria-hidden="true" />
                Hallucination Detector
              </TabsTrigger>
            </TabsList>
            <TabsContent value="ai" className="mt-6">
              <FadeIn>
                <AiDetectorPanel />
              </FadeIn>
            </TabsContent>
            <TabsContent value="hallucination" className="mt-6">
              <FadeIn>
                <HallucinationPanel />
              </FadeIn>
            </TabsContent>
          </Tabs>
        </div>
      </main>

      {/* Sticky footer: mt-auto keeps it at the viewport bottom on short
          pages and pushes it down naturally when content overflows. */}
      <footer className="mt-auto border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 text-xs text-muted-foreground sm:flex-row">
          <p>
            TruthLab · GLM-powered detection for research &amp; education —
            probabilistic, not proof.
          </p>
          <p>AI score · Hallucination check · Heuristics + LLM analysis</p>
        </div>
      </footer>
    </div>
  );
}
