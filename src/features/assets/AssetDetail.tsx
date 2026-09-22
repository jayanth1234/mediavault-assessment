import { useEffect, useState } from 'react';
import { ApiError, getAsset, thumbnailUrl, updateAsset } from '@/api/client';
import { formatBytes, formatDate, formatDuration, statusLabel } from '@/lib/format';
import type { Asset, AssetStatus } from '@/lib/types';

const STATUSES: AssetStatus[] = ['draft', 'in_review', 'approved', 'archived'];

interface Props {
  id: string;
  onClose: () => void;
  onSaved: (asset: Asset) => void;
}

/**
 * Detail panel. Saves a status change with the asset's current `version`;
 * the API rejects a stale version with `409 version_conflict` if someone
 * else changed the asset first.
 */
export function AssetDetail({ id, onClose, onSaved }: Props) {
  const [asset, setAsset] = useState<Asset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflictNotice, setConflictNotice] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setAsset(null);
    setError(null);
    setConflictNotice(false);
    getAsset(id)
      .then(setAsset)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Load failed'));
  }, [id]);

  async function setStatus(status: AssetStatus) {
    if (!asset) return;
    setSaving(true);
    setError(null);
    setConflictNotice(false);
    try {
      const updated = await updateAsset(asset.id, asset.version, { status });
      setAsset(updated);
      onSaved(updated);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'version_conflict') {
        // Someone else changed this asset first. Refetch and show the real
        // current state — both here and in the grid — rather than retrying
        // blind against a version we know is stale.
        setConflictNotice(true);
        try {
          const latest = await getAsset(asset.id);
          setAsset(latest);
          onSaved(latest);
        } catch {
          setError('This asset changed elsewhere, and the latest version could not be loaded. Close and reopen to see it.');
        }
      } else {
        setError(err instanceof ApiError ? err.message : 'Save failed');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className="panel">
      <div className="panel__head">
        <h2>Asset detail</h2>
        <button onClick={onClose}>Close</button>
      </div>

      {error && <p className="error">{error}</p>}
      {conflictNotice && !error && (
        <p className="notice notice--partial">
          Someone else updated this asset first. Showing the latest version — reapply your change if it's still needed.
        </p>
      )}
      {!asset && !error && <p className="muted">Loading…</p>}

      {asset && (
        <div className="panel__body">
          <img className="panel__thumb" src={thumbnailUrl(asset.id)} alt="" />
          <h3>{asset.name}</h3>
          <dl className="facts">
            <dt>Id</dt>
            <dd>{asset.id}</dd>
            <dt>Kind</dt>
            <dd>{asset.kind}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(asset.sizeBytes)}</dd>
            {asset.width && (
              <>
                <dt>Dimensions</dt>
                <dd>
                  {asset.width}×{asset.height}
                </dd>
              </>
            )}
            {asset.durationSec && (
              <>
                <dt>Duration</dt>
                <dd>{formatDuration(asset.durationSec)}</dd>
              </>
            )}
            <dt>Owner</dt>
            <dd>{asset.owner.name}</dd>
            <dt>Updated</dt>
            <dd>{formatDate(asset.updatedAt)}</dd>
            <dt>Version</dt>
            <dd>{asset.version}</dd>
          </dl>

          {asset.tags.length > 0 && (
            <ul className="tags">
              {asset.tags.map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
          )}

          <p className="muted">Status</p>
          <div className="row">
            {STATUSES.map((status) => (
              <button
                key={status}
                disabled={saving || status === asset.status}
                onClick={() => setStatus(status)}
              >
                {statusLabel(status)}
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}