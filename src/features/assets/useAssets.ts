import { useEffect, useRef, useState } from 'react';
import { listAssets, ApiError, RequestCancelledError } from '@/api/client';
import type { Asset, AssetQuery } from '@/lib/types';

interface State {
  items: Asset[];
  total: number;
  nextCursor: string | null;
  loading: boolean;
  error: ApiError | null;
}

/**
 * Loader, pass 1: race-safe.
 *
 * Two independent defenses against stale responses, both necessary:
 *  1. AbortController cancels the in-flight fetch for the previous query as
 *     soon as a new one starts — this is what actually stops the wasted
 *     network call and keeps it off the rate-limit budget.
 *  2. A monotonically increasing request id lets the resolved handler check
 *     "am I still the latest request" before touching state, as a second
 *     line of defense in case a response resolves in the same tick the
 *     abort fires (or a caller reuses this hook without wiring the signal
 *     through correctly).
 *
 * Still open (closed in later passes): debounce, URL state, de-duplication,
 * retry/backoff, pagination beyond a single page.
 */
export function useAssets(query: AssetQuery) {
  const [state, setState] = useState<State>({
    items: [],
    total: 0,
    nextCursor: null,
    loading: true,
    error: null,
  });

  const latestRequestId = useRef(0);

  useEffect(() => {
    const requestId = ++latestRequestId.current;
    const controller = new AbortController();

    setState((s) => ({ ...s, loading: true, error: null }));

    listAssets(query, controller.signal)
      .then((page) => {
        // Belt-and-braces: only the most recent request is allowed to write state.
        if (requestId !== latestRequestId.current) return;
        setState({
          items: page.items,
          total: page.total,
          nextCursor: page.nextCursor,
          loading: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (requestId !== latestRequestId.current) return;
        // A cancellation is not a failure — the request that superseded this
        // one owns updating state, so this one has nothing to report.
        if (err instanceof RequestCancelledError) return;
        setState((s) => ({
          ...s,
          loading: false,
          error:
            err instanceof ApiError
              ? err
              : new ApiError({
                  status: 0,
                  code: 'unknown',
                  message: 'Something went wrong.',
                  retryAfterSeconds: null,
                }),
        }));
      });

    // Cleanup fires on every dependency change AND on unmount — both cases
    // where an in-flight request for this hook instance is no longer wanted.
    return () => controller.abort();
  }, [JSON.stringify(query)]);

  return state;
}