import { useCallback, useState } from 'react';
import { ApiError, bulkSetStatus } from '@/api/client';
import { chunk, runWithConcurrency } from '@/lib/concurrency';
import type { Asset, AssetStatus, BulkResult } from '@/lib/types';

const CONCURRENCY_LIMIT = 4;
const CHUNK_SIZE = 50;

interface Failure {
  id: string;
  code: string;
  message: string;
  /** `conflict` (the ~7% random failure) can succeed on retry. `legal_hold`
   *  and `not_found` are deterministic — retrying changes nothing. A whole
   *  chunk request that failed outright (network/503/429) is retryable too. */
  retryable: boolean;
}

interface State {
  running: boolean;
  lastStatus: AssetStatus | null;
  lastSummary: { applied: number; failed: Failure[] } | null;
}

function describeFailure(code: string): string {
  switch (code) {
    case 'legal_hold':
      return 'on legal hold';
    case 'not_found':
      return 'no longer exists';
    case 'conflict':
      return 'a temporary conflict';
    default:
      return code;
  }
}

/**
 * optimistic apply, chunked + bounded-concurrency requests, 
 * partial-success reconciliation, and a retry path
 * for the subset of failures that are actually worth retrying.
 */
export function useBulkStatusAction(opts: {
  items: Asset[];
  patchItemsOptimistically: (ids: string[], patch: Partial<Asset>) => void;
  replaceItems: (assets: Asset[]) => void;
}) {
  const { items, patchItemsOptimistically, replaceItems } = opts;
  const [state, setState] = useState<State>({ running: false, lastStatus: null, lastSummary: null });

  const run = useCallback(
    async (ids: string[], status: AssetStatus) => {
      if (ids.length === 0) return;
      setState({ running: true, lastStatus: status, lastSummary: null });

      // Snapshot originals BEFORE the optimistic patch — this is what lets a
      // failure be reverted to exactly what it was, not just "some other
      // status", and lets a partially-applied batch keep its successes.
      const originalsById = new Map(items.filter((a) => ids.includes(a.id)).map((a) => [a.id, a]));

      patchItemsOptimistically(ids, { status });

      // Each chunk task catches its own failure rather than letting one
      // chunk's transient error (503/429/network) take down chunks that
      // would otherwise have succeeded — those still get to apply.
      const tasks = chunk(ids, CHUNK_SIZE).map((idsChunk) => async (): Promise<BulkResult> => {
        try {
          return await bulkSetStatus(idsChunk, status);
        } catch (err) {
          const apiErr = err instanceof ApiError ? err : null;
          return {
            applied: 0,
            failed: idsChunk.length,
            results: idsChunk.map((id) => ({
              id,
              ok: false as const,
              code: apiErr?.code ?? 'request_failed',
              message: apiErr?.message ?? 'Request failed',
            })),
          };
        }
      });

      const chunkResults = await runWithConcurrency(tasks, CONCURRENCY_LIMIT);

      const succeededAssets: Asset[] = [];
      const failures: Failure[] = [];
      for (const result of chunkResults) {
        for (const item of result.results) {
          if (item.ok) {
            succeededAssets.push(item.asset);
          } else {
            failures.push({
              id: item.id,
              code: item.code,
              message: item.message ?? describeFailure(item.code),
              retryable: item.code === 'conflict' || item.code === 'request_failed',
            });
          }
        }
      }

      // Commit successes with the server's real object (syncs the bumped
      // version — required so a later single-asset edit on that item
      // doesn't incorrectly 409 against a version we never updated).
      replaceItems(succeededAssets);
      // Revert only the failures, back to their exact original snapshot.
      const revertTargets = failures
        .map((f) => originalsById.get(f.id))
        .filter((a): a is Asset => !!a);
      replaceItems(revertTargets);

      setState({ running: false, lastStatus: status, lastSummary: { applied: succeededAssets.length, failed: failures } });
    },
    [items, patchItemsOptimistically, replaceItems],
  );

  const retryFailed = useCallback(() => {
    if (!state.lastSummary || !state.lastStatus) return;
    const retryableIds = state.lastSummary.failed.filter((f) => f.retryable).map((f) => f.id);
    if (retryableIds.length === 0) return;
    run(retryableIds, state.lastStatus);
  }, [state.lastSummary, state.lastStatus, run]);

  const dismiss = useCallback(() => {
    setState((s) => ({ ...s, lastSummary: null }));
  }, []);

  return { running: state.running, lastSummary: state.lastSummary, run, retryFailed, dismiss };
}