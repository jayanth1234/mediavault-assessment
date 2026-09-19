import { useCallback, useEffect, useState } from 'react';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import type { AssetQuery, AssetStatus } from '@/lib/types';

const DEBOUNCE_MS = 350;

type Sort = NonNullable<AssetQuery['sort']>;
const DEFAULT_SORT: Sort = 'updatedAt:desc';
const VALID_STATUSES: AssetStatus[] = ['draft', 'in_review', 'approved', 'archived'];

interface FilterState {
  q: string;
  status: AssetStatus[];
  sort: Sort;
}

function readFromUrl(): FilterState {
  const params = new URLSearchParams(window.location.search);
  const statusParam = params.get('status');
  const status = statusParam
    ? statusParam.split(',').filter((s): s is AssetStatus => VALID_STATUSES.includes(s as AssetStatus))
    : [];
  const sortParam = params.get('sort');
  return {
    q: params.get('q') ?? '',
    status,
    sort: (sortParam as Sort) || DEFAULT_SORT,
  };
}

function writeToUrl(state: FilterState) {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.status.length) params.set('status', state.status.join(','));
  if (state.sort !== DEFAULT_SORT) params.set('sort', state.sort);

  const qs = params.toString();
  const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', next);
}

// Search/filter state that lives in the URL
export function useUrlQuery() {
  const [initial] = useState(readFromUrl);
  const [rawQ, setRawQ] = useState(initial.q);
  const [status, setStatus] = useState<AssetStatus[]>(initial.status);
  const [sort, setSort] = useState<Sort>(initial.sort);

  const debouncedQ = useDebouncedValue(rawQ, DEBOUNCE_MS);

  useEffect(() => {
    writeToUrl({ q: debouncedQ, status, sort });
  }, [debouncedQ, status, sort]);

  const toggleStatus = useCallback((s: AssetStatus, checked: boolean) => {
    setStatus((prev) => (checked ? [...prev, s] : prev.filter((x) => x !== s)));
  }, []);

  return {
    rawQ,
    setRawQ,
    debouncedQ,
    status,
    toggleStatus,
    sort,
    setSort,
    debounceMs: DEBOUNCE_MS,
  };
}