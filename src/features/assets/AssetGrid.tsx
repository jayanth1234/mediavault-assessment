import { memo, useState } from 'react';
import { VirtuosoGrid } from 'react-virtuoso';
import { thumbnailUrl, type ApiError } from '@/api/client';
import { formatBytes, formatDate, statusLabel } from '@/lib/format';
import type { Asset } from '@/lib/types';

interface Props {
  assets: Asset[];
  loading: boolean;
  loadingMore: boolean;
  error: ApiError | null;
  hasMore: boolean;
  onLoadMore: () => void;
  selectedIds: Set<string>;
  activeId: string | null;
  onToggleSelect: (id: string, opts?: { shiftKey?: boolean }) => void;
  onOpen: (id: string) => void;
}

//  Thumbnail with a stable placeholder on load failure.
//  `loading="lazy"` deliberately omitted: virtualization already
//  means only on-screen (plus a small overscan) rows are ever mounted, so the
//  browser's own lazy-loading has nothing left to add.

function Thumbnail({ assetId }: { assetId: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="card__thumb card__thumb--placeholder" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
      </div>
    );
  }

  return (
    <img className="card__thumb" src={thumbnailUrl(assetId)} alt="" onError={() => setFailed(true)} />
  );
}


// One card, memoized. This is what makes "toggling selection on one card
// doesn't re-render the others" actually true. Usage of React.memo is deliberate and important: 
// the card is a pure function of its props, and the parent grid re-renders whenever selection changes,
// so without memoization every card would re-render on every selection change, 
// defeating the whole point of the optimization.

const AssetCard = memo(function AssetCard({
  asset,
  selected,
  active,
  onToggleSelect,
  onOpen,
}: {
  asset: Asset;
  selected: boolean;
  active: boolean;
  onToggleSelect: (id: string, opts?: { shiftKey?: boolean }) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div
      className={'card' + (selected ? ' card--selected' : '') + (active ? ' card--active' : '')}
      onClick={() => onOpen(asset.id)}
    >
      <Thumbnail assetId={asset.id} />
      <div className="card__body">
        <p className="card__name">{asset.name}</p>
        <p className="muted">
          {asset.kind} · {formatBytes(asset.sizeBytes)} · {formatDate(asset.updatedAt)}
        </p>
        <span className={`pill pill--${asset.status}`}>{statusLabel(asset.status)}</span>
      </div>
      <input
        type="checkbox"
        className="card__check"
        checked={selected}
        aria-label={`Select ${asset.name}`}
        onClick={(e) => {
          e.stopPropagation();

          onToggleSelect(asset.id, {
            shiftKey: e.shiftKey,
          });
        }}
        onChange={() => {
          // State is handled by onClick.
        }}
      />
    </div>
  );
});


// Virtualized grid via react-virtuoso's VirtuosoGrid, which is purpose-built
// for responsive multi-column grids, so 12400 assets can be scrolled through 
// without ever mounting them all at once.

export function AssetGrid({
  assets,
  loading,
  loadingMore,
  error,
  hasMore,
  onLoadMore,
  selectedIds,
  activeId,
  onToggleSelect,
  onOpen,
}: Props) {
  if (error && assets.length === 0) {
    return (
      <div className="empty empty--error" role="alert">
        <p>Couldn't load assets.</p>
        <p className="muted">{error.message}</p>
      </div>
    );
  }

  if (loading && assets.length === 0) {
    return (
      <div className="empty empty--loading" aria-busy="true">
        <p>Loading assets…</p>
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <div className="empty">
        <p>Nothing matches these filters.</p>
        <p className="muted">Clear the search box or widen the status filter.</p>
      </div>
    );
  }

  return (
    <VirtuosoGrid
      className="grid-scroller"
      listClassName="grid__list"
      itemClassName="grid__cell"
      data={assets}
      overscan={200}
      endReached={() => {
        if (hasMore && !loading && !loadingMore) onLoadMore();
      }}
      computeItemKey={(index) => assets[index]?.id ?? index}
      itemContent={(_index, asset) => (
        <AssetCard
          asset={asset}
          selected={selectedIds.has(asset.id)}
          active={activeId === asset.id}
          onToggleSelect={onToggleSelect}
          onOpen={onOpen}
        />
      )}
      components={{
        Footer: () => {
          if (error && assets.length > 0) {
            return (
              <div className="grid__loading-more grid__loading-more--error" role="alert">
                <p className="muted">Couldn't load more — {error.message}</p>
                <button onClick={onLoadMore}>Retry</button>
              </div>
            );
          }
          if (loadingMore) {
            return (
              <p className="muted grid__loading-more" aria-live="polite">
                Loading more…
              </p>
            );
          }
          return null;
        },
      }}
    />
  );
}