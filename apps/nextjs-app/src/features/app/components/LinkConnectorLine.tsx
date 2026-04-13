import { useCallback, useEffect, useRef, useState } from 'react';
import { useGridSearchStore } from '../blocks/view/grid/useGridSearchStore';

interface IPoint {
  x: number;
  y: number;
}

interface ILinePoints {
  source: IPoint;
  target: IPoint;
  mode: 'side' | 'top';
}

const pointsEqual = (a: ILinePoints | null, b: ILinePoints | null) => {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.source.x === b.source.x &&
    a.source.y === b.source.y &&
    a.target.x === b.target.x &&
    a.target.y === b.target.y &&
    a.mode === b.mode
  );
};

const clearPoints = (
  prevRef: React.MutableRefObject<ILinePoints | null>,
  setPoints: (p: ILinePoints | null) => void
) => {
  if (prevRef.current !== null) {
    prevRef.current = null;
    setPoints(null);
  }
};

const computePoints = (sourceEl: HTMLElement, targetEl: HTMLElement): ILinePoints | null => {
  const sourceRect = sourceEl.getBoundingClientRect();
  if (sourceRect.width === 0) return null;

  const dialogEl = targetEl.closest('[role="dialog"]');
  const dialogRect = dialogEl?.getBoundingClientRect();
  if (!dialogRect) return null;

  const sourceMidX = sourceRect.left + sourceRect.width / 2;
  if (dialogRect.left < sourceMidX) return null;

  const targetRect = targetEl.getBoundingClientRect();
  const headerMidY = targetRect.top + targetRect.height / 2;
  const target = { x: dialogRect.left - 1.5, y: headerMidY };
  const gap = dialogRect.left - sourceRect.right;

  if (gap < 60) {
    return {
      source: { x: sourceMidX, y: sourceRect.top - 0.5 },
      target,
      mode: 'top',
    };
  }
  return {
    source: { x: sourceRect.right, y: sourceRect.top + sourceRect.height / 2 },
    target,
    mode: 'side',
  };
};

export const LinkConnectorLine = () => {
  const { setHighlightedTableId } = useGridSearchStore();
  const stackRef = useRef<string[]>([]);
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [points, setPoints] = useState<ILinePoints | null>(null);
  const rafRef = useRef(0);
  const prevPointsRef = useRef<ILinePoints | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const { tableId, action } = (e as CustomEvent).detail;
      if (action === 'push' && tableId) {
        stackRef.current = [...stackRef.current, tableId];
      } else if (action === 'pop' && tableId) {
        const idx = stackRef.current.lastIndexOf(tableId);
        if (idx !== -1) {
          stackRef.current = [
            ...stackRef.current.slice(0, idx),
            ...stackRef.current.slice(idx + 1),
          ];
        }
      }
      const top = stackRef.current[stackRef.current.length - 1] || null;
      setActiveTableId(top);
      setHighlightedTableId(top);
    };
    window.addEventListener('teable:highlight-table', handler);
    return () => window.removeEventListener('teable:highlight-table', handler);
  }, [setHighlightedTableId]);

  const update = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const targets = document.querySelectorAll<HTMLElement>('[data-link-highlight-target]');
      const targetEl = targets[targets.length - 1] || null;
      if (!targetEl) return clearPoints(prevPointsRef, setPoints);

      const tableId = targetEl.getAttribute('data-link-highlight-target');
      const source = tableId
        ? document.querySelector<HTMLElement>(`[data-table-id="${tableId}"]`)
        : null;
      const sourceEl = source || document.querySelector<HTMLElement>('[data-sidebar-toggle]');
      if (!sourceEl) return clearPoints(prevPointsRef, setPoints);

      const next = computePoints(sourceEl, targetEl);
      if (!next) return clearPoints(prevPointsRef, setPoints);

      if (!pointsEqual(prevPointsRef.current, next)) {
        prevPointsRef.current = next;
        setPoints(next);
      }
    });
  }, []);

  useEffect(() => {
    if (!activeTableId) {
      setPoints(null);
      return;
    }

    const timeout = setTimeout(update, 100);

    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);

    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });

    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      observer.disconnect();
    };
  }, [activeTableId, update]);

  if (!points) return null;

  const { source, target, mode } = points;

  let path: string;
  if (mode === 'top') {
    // Overlapping: curve exits upward from source, arrives from left at target
    const dy = Math.abs(source.y - target.y);
    const dx = Math.abs(target.x - source.x);
    const c1x = source.x + dx * 0.55;
    const c1y = source.y - dy * 0.1;
    const c2x = target.x - dx * 0.5;
    const c2y = target.y;
    path = `M ${source.x} ${source.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${target.x} ${target.y}`;
  } else {
    // Side: horizontal S-curve
    const midX = (source.x + target.x) / 2;
    path = `M ${source.x} ${source.y} C ${midX} ${source.y}, ${midX} ${target.y}, ${target.x} ${target.y}`;
  }

  return (
    <svg className="pointer-events-none fixed inset-0 z-[999]" width="100%" height="100%">
      <path d={path} fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" />
      <circle cx={source.x} cy={source.y} r={4} fill="white" />
      <circle cx={target.x} cy={target.y} r={4} fill="white" />
    </svg>
  );
};
