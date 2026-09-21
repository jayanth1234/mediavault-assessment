import { useCallback, useEffect, useRef, useState } from 'react';
import { listAssets, ApiError, RequestCancelledError } from '@/api/client';
import type { Asset, AssetQuery } from '@/lib/types';

interface State {
  items: Asset[];
  total: number;
  nextCursor: string | null;
  /** True only while fetching the FIRST page of the current query. */
  loading: boolean;
  /** True while fetching a subsequent page via loadMore(). */
  loadingMore: boolean;
  error: ApiError | null;
}

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError
    ? err
    : new ApiError({
        status: 0,
        code: 'unknown',
        message: 'Something went wrong.',
        retryAfterSeconds: null,
      });
}

// Cursor pagination with generation-safe resets and cancellation of stale in-flight requests.
export function useAssets(query: AssetQuery) {
  const [state, setState] = useState<State>({
    items: [],
    total: 0,
    nextCursor: null,
    loading: true,
    loadingMore: false,
    error: null,
  });

  const generation = useRef(0);
  const inFlightControllers = useRef<Set<AbortController>>(new Set());

  const abortAllInFlight = useCallback(() => {
    for (const c of inFlightControllers.current) c.abort();
    inFlightControllers.current.clear();
  }, []);

  // Query changed: new generation, reset, fetch page 1.
  useEffect(() => {
    const myGeneration = ++generation.current;
    abortAllInFlight();

    const controller = new AbortController();
    inFlightControllers.current.add(controller);

    setState({
      items: [],
      total: 0,
      nextCursor: null,
      loading: true,
      loadingMore: false,
      error: null,
    });

    listAssets(query, controller.signal)
      .then((page) => {
        inFlightControllers.current.delete(controller);
        if (myGeneration !== generation.current) return;
        setState({
          items: page.items,
          total: page.total,
          nextCursor: page.nextCursor,
          loading: false,
          loadingMore: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        inFlightControllers.current.delete(controller);
        if (myGeneration !== generation.current) return;
        if (err instanceof RequestCancelledError) return;
        setState((s) => ({ ...s, loading: false, loadingMore: false, error: toApiError(err) }));
      });

    return () => {
      // Effect cleanup covers both "query changed again" and unmount.
      abortAllInFlight();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(query)]);

  const loadMore = useCallback(() => {
    setState((s) => {
      if (s.loading || s.loadingMore || !s.nextCursor) return s;

      const myGeneration = generation.current;
      const cursor = s.nextCursor;
      const controller = new AbortController();
      inFlightControllers.current.add(controller);

      listAssets({ ...query, cursor }, controller.signal)
        .then((page) => {
          inFlightControllers.current.delete(controller);
          if (myGeneration !== generation.current) return; // query moved on — discard
          setState((prev) => ({
            items: [...prev.items, ...page.items],
            total: page.total,
            nextCursor: page.nextCursor,
            loading: false,
            loadingMore: false,
            error: null,
          }));
        })
        .catch((err: unknown) => {
          inFlightControllers.current.delete(controller);
          if (myGeneration !== generation.current) return;
          if (err instanceof RequestCancelledError) return;
          setState((prev) => ({ ...prev, loadingMore: false, error: toApiError(err) }));
        });

      return { ...s, loadingMore: true };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(query)]);

  return {
    items: state.items,
    total: state.total,
    hasMore: state.nextCursor !== null,
    loading: state.loading,
    loadingMore: state.loadingMore,
    error: state.error,
    loadMore,
  };
}