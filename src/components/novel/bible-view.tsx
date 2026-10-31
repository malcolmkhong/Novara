"use client";

import * as React from "react";
import {
  Crown,
  FlaskConical,
  Globe2,
  ScrollText,
  Swords,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import type { NovelDetail } from "@/lib/novel/types";

/**
 * 设定集 (story bible): logline/conflict, world, power system, golden
 * finger, cast cards and the mirror-image villain — the init output that
 * every later step treats as canon.
 */
export function BibleView({ novel }: { novel: NovelDetail }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Logline & core conflict */}
      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="size-4 text-amber-500" aria-hidden="true" />
            Story core
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <p className="leading-relaxed">
            <span className="font-medium">Logline: </span>
            {novel.logline}
          </p>
          {novel.coreConflict && (
            <p className="leading-relaxed">
              <span className="font-medium">Core conflict: </span>
              {novel.coreConflict}
            </p>
          )}
          {novel.platform && (
            <p className="text-xs text-muted-foreground">
              Target readers: {novel.platform}
            </p>
          )}
          {novel.bible && novel.bible.themes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {novel.bible.themes.map((theme) => (
                <Badge key={theme} variant="outline" className="text-xs">
                  {theme}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* World */}
      {novel.bible && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe2 className="size-4 text-emerald-600" aria-hidden="true" />
              世界观 · World
            </CardTitle>
            <CardDescription>
              Borders, social structure, key locations — canon for every chapter.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm leading-relaxed">
            {novel.bible.world}
          </CardContent>
        </Card>
      )}

      {/* Power system */}
      {novel.bible && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FlaskConical className="size-4 text-emerald-600" aria-hidden="true" />
              力量体系 · Power system
            </CardTitle>
            <CardDescription>Stage chain, limits and costs.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm leading-relaxed">
            {novel.bible.power}
          </CardContent>
        </Card>
      )}

      {/* Golden finger */}
      {novel.bible && (
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Swords className="size-4 text-amber-500" aria-hidden="true" />
              金手指 · Golden finger
            </CardTitle>
            <CardDescription>
              Function, trigger, cost & counter-play — the cool-point engine.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm leading-relaxed">
            {novel.bible.goldenFinger}
          </CardContent>
        </Card>
      )}

      {/* Cast */}
      {novel.characters.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="size-4 text-emerald-600" aria-hidden="true" />
              主要角色 · Cast
            </CardTitle>
            <CardDescription>
              Desire / flaw / arc — the OOC guardrail for every drafting run.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {novel.characters.map((character) => (
              <div
                key={character.name}
                className="rounded-lg border bg-muted/30 p-3 text-sm"
              >
                <p className="font-medium">
                  {character.name}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {character.role}
                  </span>
                </p>
                {character.desire && (
                  <p className="mt-1 text-xs leading-relaxed">
                    <span className="text-muted-foreground">Desire: </span>
                    {character.desire}
                  </p>
                )}
                {character.flaw && (
                  <p className="text-xs leading-relaxed">
                    <span className="text-muted-foreground">Flaw: </span>
                    {character.flaw}
                  </p>
                )}
                {character.arc && (
                  <p className="text-xs leading-relaxed">
                    <span className="text-muted-foreground">Arc: </span>
                    {character.arc}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Villain */}
      {novel.villain && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Crown className="size-4 text-red-500" aria-hidden="true" />
              反派 · Villain
            </CardTitle>
            <CardDescription>
              Scheme and mirror relation to the protagonist.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p className="font-medium">{novel.villain.name}</p>
            {novel.villain.scheme && (
              <p className="leading-relaxed">
                <span className="text-muted-foreground">Scheme: </span>
                {novel.villain.scheme}
              </p>
            )}
            {novel.villain.mirror && (
              <p className="leading-relaxed">
                <span className="text-muted-foreground">Mirror: </span>
                {novel.villain.mirror}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
