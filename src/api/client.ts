import type { Asset, AssetPage, AssetQuery, BulkResult } from '@/lib/types';

/**
 * Client, pass 1: typed errors + cancellation.
 *
 * Still open (closed in later passes):
 *   - no retry / backoff / Retry-After handling
 *   - no de-duplication of concurrent identical requests
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

export function listAssets(query: AssetQuery, signal?: AbortSignal): Promise<AssetPage> {
  return request<AssetPage>(`/api/assets?${toSearchParams(query)}`, { signal });
}

export function getAsset(id: string, signal?: AbortSignal): Promise<Asset> {
  return request<Asset>(`/api/assets/${id}`, { signal });
}

export function getAssetsByIds(
  ids: string[],
  signal?: AbortSignal,
): Promise<{ items: Asset[]; missing: string[] }> {
  // Note: the endpoint rejects more than 25 ids per call — caller must chunk.
  return request(`/api/assets/batch?ids=${ids.join(',')}`, { signal });
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