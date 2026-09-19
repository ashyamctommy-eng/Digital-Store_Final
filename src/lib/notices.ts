"use client";

import { useCallback } from "react";
import { clearStore, readStore, useStore, writeStore } from "./browserStore";
import { NOTICES } from "./config";
import type { IconName } from "@/components/ui/Icon";

export interface EditableNotice {
  id: string;
  icon: IconName;
  tone: "amber" | "blue" | "sky" | "green";
  title: string;
  body: string;
  href?: string;
  cta?: string;
}

export const NOTICES_KEY = "dhs.notices.v1";

export const TONE_OPTIONS: EditableNotice["tone"][] = [
  "amber",
  "blue",
  "sky",
  "green",
];

export const ICON_OPTIONS: IconName[] = [
  "shield",
  "clock",
  "telegram",
  "whatsapp",
  "bolt",
  "star",
  "headset",
  "globe",
];

/** Shipped defaults, derived from src/lib/config.ts. */
export const DEFAULT_NOTICES: EditableNotice[] = NOTICES.map((n) => ({
  id: n.id,
  icon: n.icon as IconName,
  tone: n.tone,
  title: n.title,
  body: n.body,
  href: "href" in n ? n.href : undefined,
  cta: "cta" in n ? n.cta : undefined,
}));

export function loadNotices(): EditableNotice[] {
  return readStore<EditableNotice[]>(NOTICES_KEY, DEFAULT_NOTICES);
}

export function saveNotices(list: EditableNotice[]): void {
  writeStore(NOTICES_KEY, list);
}

export function resetNotices(): void {
  clearStore(NOTICES_KEY);
}

/**
 * Reads the announcement cards, preferring staff edits saved in the browser
 * and falling back to the shipped defaults. Hydration-safe by construction.
 */
export function useNotices() {
  const [notices, setNotices] = useStore<EditableNotice[]>(
    NOTICES_KEY,
    DEFAULT_NOTICES
  );

  const update = useCallback(
    (index: number, patch: Partial<EditableNotice>) => {
      const current = readStore<EditableNotice[]>(NOTICES_KEY, DEFAULT_NOTICES);
      setNotices(current.map((n, i) => (i === index ? { ...n, ...patch } : n)));
    },
    [setNotices]
  );

  const reset = useCallback(() => resetNotices(), []);

  return { notices, setNotices, update, reset };
}
