"use client";

import { useTheme } from "@/context/ThemeContext";
import Icon from "./ui/Icon";

/**
 * Light/dark switch. Both icons are rendered and swapped with CSS so the
 * server and client markup match (the theme is only known at runtime).
 */
export default function ThemeToggle({ className = "" }: { className?: string }) {
  const { toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle dark mode"
      title="Toggle dark mode"
      className={`p-2 rounded-full text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:bg-[var(--color-line)] transition-colors ${className}`}
    >
      <Icon name="sun" className="w-5 h-5 hidden dark:block" />
      <Icon name="moon" className="w-5 h-5 block dark:hidden" />
    </button>
  );
}
