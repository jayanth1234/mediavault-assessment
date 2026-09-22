import { useCallback, useRef, useState } from 'react';

// click / shift-click range extension
export function useSelection(orderedIds: string[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const anchorId = useRef<string | null>(null);

  const toggle = useCallback((id: string, opts?: { shiftKey?: boolean }) => {
    if (opts?.shiftKey && anchorId.current) {
      const from = orderedIds.indexOf(anchorId.current);
      const to = orderedIds.indexOf(id);
      if (from !== -1 && to !== -1) {
        const [start, end] = from <= to ? [from, to] : [to, from];
        const range = orderedIds.slice(start, end + 1);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const rangeId of range) next.add(rangeId);
          return next;
        });
        return;
      }
    }

    anchorId.current = id;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [orderedIds]);

  const selectAllLoaded = useCallback(() => {
    setSelectedIds(new Set(orderedIds));
  }, [orderedIds]);

  const clear = useCallback(() => {
    setSelectedIds(new Set());
    anchorId.current = null;
  }, []);

  return { selectedIds, toggle, selectAllLoaded, clear };
}