"use client";

import {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
} from "react";
import { useStore } from "@/lib/browserStore";

export type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const THEME_KEY = "dhs.theme";
const DEFAULT_THEME: Theme = "light";

/**
 * Keeps the theme class on <html> in sync with the persisted preference.
 *
 * An inline script in the root layout applies the same class before first
 * paint, so there is no flash of the wrong colour scheme; this component only
 * keeps React state in step and handles toggling.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setStoredTheme] = useStore<Theme>(THEME_KEY, DEFAULT_THEME);

  // Sync the DOM (external system) with the current value.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
  }, [theme]);

  const setTheme = useCallback(
    (next: Theme) => setStoredTheme(next),
    [setStoredTheme]
  );

  const toggleTheme = useCallback(() => {
    setStoredTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setStoredTheme]);

  const value = useMemo(
    () => ({ theme, toggleTheme, setTheme }),
    [theme, toggleTheme, setTheme]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

/** Inline script injected before paint to avoid a theme flash. */
export const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem('${THEME_KEY}');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = stored === 'light' || stored === 'dark' ? stored : (prefersDark ? 'dark' : 'light');
    if (theme === 'dark') document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = theme;
  } catch (e) {}
})();
`;
