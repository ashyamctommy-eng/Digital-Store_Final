"use client";

import { useEffect, useRef, useState } from "react";
import { useNotices } from "@/lib/notices";
import Icon from "./ui/Icon";
import type { IconName } from "./ui/Icon";

const TONES: Record<string, { card: string; icon: string }> = {
  amber: {
    card: "border-amber-200 bg-amber-50 dark:border-amber-500/25 dark:bg-amber-500/10",
    icon: "bg-amber-500 text-white",
  },
  blue: {
    card: "border-blue-200 bg-blue-50 dark:border-blue-500/25 dark:bg-blue-500/10",
    icon: "bg-[var(--color-blue)] text-white",
  },
  sky: {
    card: "border-sky-200 bg-sky-50 dark:border-sky-500/25 dark:bg-sky-500/10",
    icon: "bg-[#229ED9] text-white",
  },
  green: {
    card: "border-green-200 bg-green-50 dark:border-green-500/25 dark:bg-green-500/10",
    icon: "bg-[#25D366] text-white",
  },
};

/**
 * Announcement carousel. Cards scroll horizontally with snap points;
 * it auto-advances until the user interacts, then stays put.
 */
export default function NoticeSlider({ className = "" }: { className?: string }) {
  const { notices } = useNotices();
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  // Auto-advance one card at a time.
  useEffect(() => {
    if (paused || notices.length < 2) return;
    const timer = setInterval(() => {
      setActive((prev) => {
        const next = (prev + 1) % notices.length;
        scrollTo(next);
        return next;
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [paused, notices.length]);

  const scrollTo = (index: number) => {
    const track = trackRef.current;
    if (!track) return;
    const card = track.children[index] as HTMLElement | undefined;
    if (card) track.scrollTo({ left: card.offsetLeft - track.offsetLeft, behavior: "smooth" });
  };

  // Keep the dots in sync when the user swipes manually.
  const handleScroll = () => {
    const track = trackRef.current;
    if (!track) return;
    const children = Array.from(track.children) as HTMLElement[];
    const centre = track.scrollLeft + track.clientWidth / 2;
    let closest = 0;
    let best = Infinity;
    children.forEach((child, i) => {
      const mid = child.offsetLeft - track.offsetLeft + child.clientWidth / 2;
      const distance = Math.abs(mid - centre);
      if (distance < best) {
        best = distance;
        closest = i;
      }
    });
    setActive(closest);
  };

  return (
    <section
      className={`w-full ${className}`}
      aria-label="Store announcements"
      onPointerDown={() => setPaused(true)}
      onMouseEnter={() => setPaused(true)}
    >
      <div
        ref={trackRef}
        onScroll={handleScroll}
        className="flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory px-3 sm:px-4 pb-1"
      >
        {notices.map((notice) => {
          const tone = TONES[notice.tone] ?? TONES.blue;
          return (
            <article
              key={notice.id}
              className={`snap-center shrink-0 w-[85%] sm:w-[320px] rounded-2xl border p-4 shadow-sm ${tone.card}`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${tone.icon}`}
                >
                  <Icon name={notice.icon as IconName} className="w-4.5 h-4.5" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[var(--color-ink)]">
                    {notice.title}
                  </h3>
                  <p className="text-xs text-[var(--color-ink-soft)] mt-1 leading-relaxed">
                    {notice.body}
                  </p>
                  {notice.href && (
                    <a
                      href={notice.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 mt-2 text-[11px] font-bold text-[var(--color-brand)] hover:underline"
                    >
                      {notice.cta}
                      <Icon name="chevronRight" className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {/* Dots */}
      <div className="flex items-center justify-center gap-1.5 mt-3">
        {notices.map((notice, i) => (
          <button
            key={notice.id}
            type="button"
            aria-label={`Go to notice ${i + 1}`}
            onClick={() => {
              setPaused(true);
              setActive(i);
              scrollTo(i);
            }}
            className={`h-1.5 rounded-full transition-all ${
              i === active
                ? "w-6 bg-[var(--color-brand)]"
                : "w-1.5 bg-[var(--color-ink-faint)]/40 hover:bg-[var(--color-ink-faint)]"
            }`}
          />
        ))}
      </div>
    </section>
  );
}
