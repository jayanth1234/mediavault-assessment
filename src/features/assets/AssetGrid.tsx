import { useState } from 'react';
import { thumbnailUrl, type ApiError } from '@/api/client';
import { formatBytes, formatDate, statusLabel } from '@/lib/format';
import type { Asset } from '@/lib/types';

interface Props {
  assets: Asset[];
  loading: boolean;
  error: ApiError | null;
  selectedIds: Set<string>;
  activeId: string | null;
  onToggleSelect: (id: string) => void;
  onOpen: (id: string) => void;
}

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
    <img
      className="card__thumb"
      src={thumbnailUrl(assetId)}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function AssetGrid({ assets, loading, error, selectedIds, activeId, onToggleSelect, onOpen }: Props) {
  if (error) {
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
    <div className="grid">
      {assets.map((asset) => (
        <div
          key={asset.id}
          className={
            'card' +
            (selectedIds.has(asset.id) ? ' card--selected' : '') +
            (activeId === asset.id ? ' card--active' : '')
          }
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
            checked={selectedIds.has(asset.id)}
            onClick={(e) => e.stopPropagation()}
            onChange={() => onToggleSelect(asset.id)}
          />
        </div>
      ))}
    </div>
  );
}