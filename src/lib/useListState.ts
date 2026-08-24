import { useCallback } from "react";
import type { SetStateAction } from "react";
import { useSearchParams } from "react-router-dom";

type Setter<T> = (value: SetStateAction<T>) => void;

/**
 * List controls belong in the URL, not transient component state. That makes a
 * paged/filtered list restore exactly after opening a detail screen, using the
 * browser Back button, refreshing, or sharing the link.
 */
export function useQueryString(key: string, fallback = ""): [string, Setter<string>] {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? fallback;

  const setValue = useCallback<Setter<string>>((next) => {
    setParams((current) => {
      const updated = new URLSearchParams(current);
      const previous = updated.get(key) ?? fallback;
      const resolved = typeof next === "function" ? next(previous) : next;
      if (!resolved || resolved === fallback) updated.delete(key);
      else updated.set(key, resolved);
      return updated;
    }, { replace: true });
  }, [fallback, key, setParams]);

  return [value, setValue];
}

export function useQueryNumber(
  key: string,
  fallback: number,
  bounds: { min?: number; max?: number } = {},
): [number, Setter<number>] {
  const [params, setParams] = useSearchParams();
  const raw = Number(params.get(key));
  const min = bounds.min ?? Number.MIN_SAFE_INTEGER;
  const max = bounds.max ?? Number.MAX_SAFE_INTEGER;
  const value = Number.isFinite(raw) && params.has(key)
    ? Math.min(max, Math.max(min, Math.trunc(raw)))
    : fallback;

  const setValue = useCallback<Setter<number>>((next) => {
    setParams((current) => {
      const updated = new URLSearchParams(current);
      const currentRaw = Number(updated.get(key));
      const previous = Number.isFinite(currentRaw) && updated.has(key)
        ? Math.min(max, Math.max(min, Math.trunc(currentRaw)))
        : fallback;
      const requested = typeof next === "function" ? next(previous) : next;
      const resolved = Math.min(max, Math.max(min, Math.trunc(requested)));
      if (resolved === fallback) updated.delete(key);
      else updated.set(key, String(resolved));
      return updated;
    }, { replace: true });
  }, [fallback, key, max, min, setParams]);

  return [value, setValue];
}

export function useQueryPage(key = "page"): [number, Setter<number>] {
  return useQueryNumber(key, 1, { min: 1 });
}
