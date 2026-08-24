import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./http";

export type Query<T> = {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  /** True only on the very first load — lets pages show a skeleton once. */
  initial: boolean;
  reload: () => void;
  setData: (updater: T | ((prev: T | undefined) => T)) => void;
};

/**
 * Runs `fetcher` on mount and whenever `deps` change.
 *
 * Re-fetches keep the previous data on screen (no flash back to a skeleton)
 * and a stale response from an outdated dependency set is discarded.
 */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[] = []): Query<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [initial, setInitial] = useState(true);
  const [nonce, setNonce] = useState(0);

  const run = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    const id = ++run.current;
    let live = true;
    setLoading(true);
    fetcherRef
      .current()
      .then((res) => {
        if (!live || id !== run.current) return;
        setDataState(res);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!live || id !== run.current) return;
        setError(err instanceof ApiError ? err.message : (err as Error)?.message ?? "Something went wrong");
      })
      .finally(() => {
        if (!live || id !== run.current) return;
        setLoading(false);
        setInitial(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const setData = useCallback((updater: T | ((prev: T | undefined) => T)) => {
    setDataState((prev) => (typeof updater === "function" ? (updater as (p: T | undefined) => T)(prev) : updater));
  }, []);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, error, loading, initial, reload, setData };
}

/**
 * Wraps a write call so pages get `busy` state and a normalised error string
 * without repeating try/catch in every button handler.
 */
export function useMutation<Args extends unknown[], R>(fn: (...args: Args) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutate = useCallback(
    async (...args: Args): Promise<R | undefined> => {
      setBusy(true);
      setError(null);
      try {
        return await fn(...args);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : (err as Error)?.message ?? "Something went wrong");
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** Like `mutate` but tells the caller whether it worked, so a modal can stay open on failure. */
  const run = useCallback(async (...args: Args): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await fn(...args);
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error)?.message ?? "Something went wrong");
      return false;
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { mutate, run, busy, error, clearError: () => setError(null) };
}

/**
 * Re-runs a query's `reload` on an interval while the tab is visible.
 *
 * The chat and floor screens need to see new activity without a manual
 * refresh; the backend's Socket.IO channel is not wired into the panel, so
 * these screens poll.
 */
export function usePoll(reload: () => void, ms = 8000, enabled = true) {
  useEffect(() => {
    if (!enabled || ms <= 0) return;
    const tick = () => {
      if (document.visibilityState === "visible") reload();
    };
    const id = setInterval(tick, ms);
    return () => clearInterval(id);
  }, [reload, ms, enabled]);
}

/** Debounced value — used for search boxes that hit the API on every keystroke. */
export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
