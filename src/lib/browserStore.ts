"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A tiny external store for values persisted in localStorage.
 *
 * Why this exists: the site is a static export, so there is no server-rendered
 * user state. Reading storage inside a useEffect and calling setState is the
 * obvious approach, but it causes a cascading render and (worse) a visible
 * flash of empty state. `useSyncExternalStore` is React's supported answer:
 * the server snapshot is used for hydration and the real value is swapped in
 * without a mismatch warning.
 *
 * The cached snapshot is also what makes it safe for objects and arrays —
 * `getSnapshot` must return a referentially stable value between changes.
 */

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();
const snapshots = new Map<string, unknown>();

function listenersFor(key: string): Set<Listener> {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  return set;
}

function emit(key: string) {
  listenersFor(key).forEach((listener) => listener());
}

/** Reads (and caches) the current value for a key. */
export function readStore<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  if (snapshots.has(key)) return snapshots.get(key) as T;

  let value = fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw !== null) value = JSON.parse(raw) as T;
  } catch {
    // Unreadable or corrupt — fall back to the default.
  }
  snapshots.set(key, value);
  return value;
}

/** Writes a value, refreshes the cache and notifies subscribers. */
export function writeStore<T>(key: string, value: T): void {
  snapshots.set(key, value);
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode / quota exceeded — the in-memory cache still updates.
  }
  emit(key);
}

/** Clears a key back to its fallback. */
export function clearStore(key: string): void {
  snapshots.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
  emit(key);
}

function subscribeTo(key: string, listener: Listener): () => void {
  const set = listenersFor(key);
  set.add(listener);

  // Keep other tabs in sync.
  const onStorage = (e: StorageEvent) => {
    if (e.key === key) {
      snapshots.delete(key);
      listener();
    }
  };
  window.addEventListener("storage", onStorage);

  return () => {
    set.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Subscribes a component to a persisted value.
 *
 * @param key      localStorage key.
 * @param fallback value used during SSR and hydration. Pass a module-level
 *                 constant so the reference stays stable across renders.
 */
export function useStore<T>(key: string, fallback: T): [T, (value: T) => void] {
  const subscribe = useCallback(
    (listener: Listener) => subscribeTo(key, listener),
    [key]
  );
  const getSnapshot = useCallback(() => readStore(key, fallback), [key, fallback]);
  const getServerSnapshot = useCallback(() => fallback, [fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (next: T) => writeStore(key, next),
    [key]
  );

  return [value, setValue];
}

/**
 * Locks or restores page scrolling. Lives outside components so it reads as an
 * external-system update rather than component state mutation.
 */
export function setBodyScrollLock(locked: boolean): void {
  if (typeof document === "undefined") return;
  document.body.style.overflow = locked ? "hidden" : "";
}
