import type { Asset, AssetPage, AssetQuery, BulkResult } from '@/lib/types';

/**
 * Client, pass 2: typed errors, cancellation, and de-duplication.
 *
 * Still open (closed in later passes):
 *   - no retry / backoff / Retry-After handling
 */

/** Every error the API can return, typed instead of parsed from a string. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** True for failures that are safe to retry unchanged: network errors, 503, 429. */
  readonly retryable: boolean;
  /** Present on 429/503 when the server tells us how long to wait, in seconds. */
  readonly retryAfterSeconds: number | null;

  constructor(opts: {
    status: number;
    code: string;
    message: string;
    retryAfterSeconds: number | null;
  }) {
    super(opts.message);
    this.name = 'ApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.retryAfterSeconds = opts.retryAfterSeconds;
    // Structural, not string-matched: retryability is decided by status code only.
    this.retryable = opts.status === 503 || opts.status === 429;
  }
}

/** Thrown when a request is cancelled via AbortSignal. Callers should treat this
 *  as "ignore", never as a user-facing error. */
export class RequestCancelledError extends Error {
  constructor() {
    super('Request cancelled');
    this.name = 'RequestCancelledError';
  }
}

function toSearchParams(query: AssetQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status?.length) params.set('status', query.status.join(','));
  if (query.kind?.length) params.set('kind', query.kind.join(','));
  if (query.tag?.length) params.set('tag', query.tag.join(','));
  if (query.collectionId) params.set('collectionId', query.collectionId);
  if (query.owner) params.set('owner', query.owner);
  if (query.sort) params.set('sort', query.sort);
  if (query.limit) params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  return params.toString();
}

interface RequestOptions extends RequestInit {
  /** Pass through from the caller so in-flight requests can be cancelled. */
  signal?: AbortSignal;
}

async function request<T>(path: string, init?: RequestOptions): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (err) {
    // fetch() rejects with an AbortError when the signal fires — surface that
    // distinctly so callers never treat a cancellation as a real failure.
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new RequestCancelledError();
    }
    // Any other rejection here is a genuine network error (offline, DNS, etc.)
    // and is treated as retryable.
    throw new ApiError({
      status: 0,
      code: 'network_error',
      message: 'Network error — check your connection.',
      retryAfterSeconds: null,
    });
  }

  if (!res.ok) {
    let code = 'unknown';
    let message = res.statusText || 'Request failed';
    try {
      const body = await res.json();
      code = body?.error?.code ?? code;
      message = body?.error?.message ?? message;
    } catch {
      /* response was not JSON */
    }
    const retryAfterHeader = res.headers.get('retry-after');
    throw new ApiError({
      status: res.status,
      code,
      message,
      retryAfterSeconds: retryAfterHeader ? Number(retryAfterHeader) : null,
    });
  }

  return res.json() as Promise<T>;
}

/**
 * Collapses identical concurrent GET requests into a single network call.
 * Went through two wrong versions before this one — worth recording why,
 * since the failure mode only shows up under a specific timing:
 *
 * React 18 Strict Mode double-invokes every effect on mount, synchronously:
 * setup → cleanup → setup, all before any promise has settled. A naive
 * "one shared AbortController" dedupe (attempt 1) let caller A's
 * cleanup-triggered abort kill the response caller B was legitimately
 * waiting on, since B's request reused the same still-pending promise.
 * A refcounted version (attempt 2) still broke, because AbortController's
 * 'abort' event fires SYNCHRONOUSLY — refCount hit zero and cancelled the
 * shared fetch a tick before B (Strict Mode's second, "real" mount) had
 * even registered to keep it alive. Confirmed both failures by replaying
 * the exact timing against the live API before landing on this version.
 *
 * Fix: still refcount callers, but defer the "is anyone still interested"
 * check by one microtask before actually cancelling the shared fetch. Since
 * Strict Mode's setup → cleanup → setup runs fully synchronously (no await
 * in between), a "rescue" caller always gets to re-register before the
 * deferred check runs — while a genuinely abandoned request (no rescue
 * arrives) still gets truly network-cancelled once the microtask fires,
 * which matters: without it, an abandoned query would keep running in the
 * background and still eat rate-limit budget, silently reintroducing the
 * exact problem cancellation was built to solve in the first place.
 */
interface InFlightEntry<T> {
  promise: Promise<T>;
  controller: AbortController;
  refCount: number;
}

const inFlightGets = new Map<string, InFlightEntry<unknown>>();

function dedupedGet<T>(
  key: string,
  callerSignal: AbortSignal | undefined,
  exec: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  let entry = inFlightGets.get(key) as InFlightEntry<T> | undefined;

  if (!entry) {
    const controller = new AbortController();
    const promise = exec(controller.signal).finally(() => {
      inFlightGets.delete(key);
    });
    entry = { promise, controller, refCount: 0 };
    inFlightGets.set(key, entry as InFlightEntry<unknown>);
  }

  entry.refCount += 1;
  const sharedEntry = entry;

  if (!callerSignal) return sharedEntry.promise;

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const onCallerAbort = () => {
      if (settled) return;
      settled = true;
      sharedEntry.refCount -= 1;
      // Deferred by one microtask so a synchronous "rescue" caller (Strict
      // Mode's second mount, which runs right after this) can re-register
      // before we commit to actually cancelling the shared network request.
      queueMicrotask(() => {
        if (sharedEntry.refCount <= 0) {
          sharedEntry.controller.abort();
        }
      });
      reject(new RequestCancelledError());
    };
    callerSignal.addEventListener('abort', onCallerAbort);

    sharedEntry.promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        callerSignal.removeEventListener('abort', onCallerAbort);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        callerSignal.removeEventListener('abort', onCallerAbort);
        reject(err);
      },
    );
  });
}

export function listAssets(query: AssetQuery, signal?: AbortSignal): Promise<AssetPage> {
  const path = `/api/assets?${toSearchParams(query)}`;
  return dedupedGet(path, signal, (sharedSignal) =>
    request<AssetPage>(path, { signal: sharedSignal }),
  );
}

export function getAsset(id: string, signal?: AbortSignal): Promise<Asset> {
  const path = `/api/assets/${id}`;
  return dedupedGet(path, signal, (sharedSignal) => request<Asset>(path, { signal: sharedSignal }));
}

export function getAssetsByIds(
  ids: string[],
  signal?: AbortSignal,
): Promise<{ items: Asset[]; missing: string[] }> {
  // Note: the endpoint rejects more than 25 ids per call — caller must chunk.
  const path = `/api/assets/batch?ids=${ids.join(',')}`;
  return dedupedGet(path, signal, (sharedSignal) => request(path, { signal: sharedSignal }));
}

export function updateAsset(
  id: string,
  version: number,
  patch: Partial<Pick<Asset, 'name' | 'status' | 'tags'>>,
  signal?: AbortSignal,
): Promise<Asset> {
  return request<Asset>(`/api/assets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ version, patch }),
    signal,
  });
}

export function bulkSetStatus(
  ids: string[],
  status: Asset['status'],
  signal?: AbortSignal,
): Promise<BulkResult> {
  // Note: the endpoint rejects more than 50 ids per call — caller must chunk.
  return request<BulkResult>('/api/assets/bulk-status', {
    method: 'POST',
    body: JSON.stringify({ ids, status }),
    signal,
  });
}

export const thumbnailUrl = (id: string) => `/api/thumb/${id}.svg`;