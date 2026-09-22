import { useMemo, useState } from 'react';
import { AssetDetail } from '@/features/assets/AssetDetail';
import { AssetGrid } from '@/features/assets/AssetGrid';
import { useAssets } from '@/features/assets/useAssets';
import { useBulkStatusAction } from '@/features/assets/useBulkStatusAction';
import { useSelection } from '@/features/assets/useSelection';
import { useUrlQuery } from '@/features/assets/useUrlQuery';
import { statusLabel } from '@/lib/format';
import type { Asset, AssetStatus, AssetQuery } from '@/lib/types';

const STATUSES: AssetStatus[] = ['draft', 'in_review', 'approved', 'archived'];
const SORTS: Array<{ value: NonNullable<AssetQuery['sort']>; label: string }> = [
  { value: 'updatedAt:desc', label: 'Recently updated' },
  { value: 'name:asc', label: 'Name A–Z' },
  { value: 'sizeBytes:desc', label: 'Largest first' },
  { value: 'createdAt:desc', label: 'Newest' },
];

export function App() {
  const { rawQ, setRawQ, debouncedQ, status, toggleStatus, sort, setSort } = useUrlQuery();
  const [activeId, setActiveId] = useState<string | null>(null);

  // debouncedQ (not rawQ) drives the network request, so a burst of
  // keystrokes collapses into one request instead of one per character.
  const {
    items,
    total,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    patchItemsOptimistically,
    replaceItems,
  } = useAssets({ q: debouncedQ, status, sort, limit: 24 });

  const orderedIds = useMemo(() => items.map((a) => a.id), [items]);
  const { selectedIds, toggle: toggleSelect, selectAllLoaded, clear: clearSelection } = useSelection(orderedIds);

  const bulk = useBulkStatusAction({ items, patchItemsOptimistically, replaceItems });

  function handleSaved(updated: Asset) {
    // Sync the list's copy so the grid reflects a single-asset edit made in
    // the detail panel, instead of showing a stale row until the next
    // unrelated refetch — this was defect #11 from the baseline inventory.
    replaceItems([updated]);
  }

  const retryableCount = bulk.lastSummary?.failed.filter((f) => f.retryable).length ?? 0;

  return (
    <div className="app">
      <header className="topbar">
        <h1>MediaVault</h1>
        <input
          className="search"
          type="search"
          placeholder="Search assets"
          value={rawQ}
          onChange={(e) => setRawQ(e.target.value)}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </header>

      <div className="filters">
        {STATUSES.map((s) => (
          <label key={s}>
            <input
              type="checkbox"
              checked={status.includes(s)}
              onChange={(e) => toggleStatus(s, e.target.checked)}
            />
            {statusLabel(s)}
          </label>
        ))}
        <span className="muted">
          {loading ? 'Loading…' : `${items.length} of ${total.toLocaleString()} shown`}
        </span>
      </div>

      {selectedIds.size > 0 && (
        <div className="bulkbar">
          <span>{selectedIds.size} selected</span>
          {STATUSES.map((s) => (
            <button key={s} disabled={bulk.running} onClick={() => bulk.run([...selectedIds], s)}>
              Set {statusLabel(s).toLowerCase()}
            </button>
          ))}
          <button onClick={selectAllLoaded} disabled={bulk.running}>
            Select all loaded ({items.length})
          </button>
          <button onClick={clearSelection} disabled={bulk.running}>
            Clear selection
          </button>
        </div>
      )}

      {bulk.running && <p className="notice">Updating {selectedIds.size || ''} assets…</p>}

      {bulk.lastSummary && !bulk.running && (
        <div className={bulk.lastSummary.failed.length > 0 ? 'notice notice--partial' : 'notice'}>
          <p>
            {bulk.lastSummary.applied} updated
            {bulk.lastSummary.failed.length > 0 && `, ${bulk.lastSummary.failed.length} failed`}.
          </p>
          {bulk.lastSummary.failed.length > 0 && (
            <ul className="bulk-failures">
              {bulk.lastSummary.failed.map((f) => (
                <li key={f.id}>
                  <code>{f.id}</code> — {f.message}
                  {!f.retryable && ' (won\u2019t succeed on retry)'}
                </li>
              ))}
            </ul>
          )}
          <div className="row">
            {retryableCount > 0 && (
              <button onClick={bulk.retryFailed}>Retry {retryableCount} failed</button>
            )}
            <button onClick={bulk.dismiss}>Dismiss</button>
          </div>
        </div>
      )}

      <main className="content">
        <AssetGrid
          assets={items}
          loading={loading}
          loadingMore={loadingMore}
          error={error}
          hasMore={hasMore}
          onLoadMore={loadMore}
          selectedIds={selectedIds}
          activeId={activeId}
          onToggleSelect={toggleSelect}
          onOpen={setActiveId}
        />
        {activeId && (
          <AssetDetail id={activeId} onClose={() => setActiveId(null)} onSaved={handleSaved} />
        )}
      </main>
    </div>
  );
}