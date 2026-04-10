import { useCallback, useEffect, useRef, useState } from 'react';
import { useGridSearchStore } from '../blocks/view/grid/useGridSearchStore';

interface IPoint {
  x: number;
  y: number;
}

interface ILinePoints {
  source: IPoint;
  target: IPoint;
  cardLeft: number;
  cardTop: number;
}

const pointsEqual = (a: ILinePoints | null, b: ILinePoints | null) => {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.source.x === b.source.x &&
    a.source.y === b.source.y &&
    a.target.x === b.target.x &&
    a.target.y === b.target.y &&
    a.cardLeft === b.cardLeft &&
    a.cardTop === b.cardTop
  );
};

export const LinkConnectorLine = () => {
  const { setHighlightedTableId } = useGridSearchStore();
  const stackRef = useRef<string[]>([]);
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [points, setPoints] = useState<ILinePoints | null>(null);
  const rafRef = useRef(0);
  const prevPointsRef = useRef<ILinePoints | null>(null);

  // Listen for highlight events with stack management
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
      // Take the last (topmost in modal stack) target element
      const targets = document.querySelectorAll<HTMLElement>('[data-link-highlight-target]');
      const target = targets[targets.length - 1] || null;
      const tableId = target?.getAttribute('data-link-highlight-target');
      const source = tableId
        ? document.querySelector<HTMLElement>(`[data-table-id="${tableId}"]`)
        : null;

      if (!source || !target) {
        if (prevPointsRef.current !== null) {
          prevPointsRef.current = null;
          setPoints(null);
        }
        return;
      }

      const sourceRect = source.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();

      // Hide line when sidebar is collapsed (source not visible)
      if (sourceRect.width === 0 || sourceRect.right <= 0) {
        if (prevPointsRef.current !== null) {
          prevPointsRef.current = null;
          setPoints(null);
        }
        return;
      }

      const next: ILinePoints = {
        source: {
          x: sourceRect.right,
          y: sourceRect.top + sourceRect.height / 2,
        },
        target: {
          x: targetRect.left + Math.min(targetRect.width * 0.1, 40),
          y: targetRect.top - 8,
        },
        cardLeft: targetRect.left,
        cardTop: targetRect.top,
      };
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

  const { source, target, cardLeft, cardTop } = points;

  // Two-segment cubic bezier with C1 continuity at waypoint.
  // Waypoint sits above-left of card corner. Both segments share a horizontal
  // tangent at the waypoint so the junction is perfectly smooth.
  const margin = 30;
  const wp = { x: cardLeft - margin, y: cardTop - margin };

  // Segment 1: source → waypoint
  // Exits source horizontally, arrives at waypoint horizontally from left.
  const t1 = Math.max(Math.abs(source.y - wp.y) * 0.55, 60);
  const c1x = Math.min(source.x + t1, wp.x - 20);
  const c1y = source.y;
  const c2x = wp.x - t1;
  const c2y = wp.y;

  // Segment 2: waypoint → target
  // Exits waypoint horizontally to right (C1 continuous with segment 1),
  // arrives at target vertically from above.
  const dx2 = Math.abs(target.x - wp.x);
  const dy2 = Math.abs(target.y - wp.y);
  const t2h = Math.max(dx2 * 0.4, 30);
  const t2v = Math.max(dy2 * 0.6, 20);
  const c3x = wp.x + t2h;
  const c3y = wp.y;
  const c4x = target.x;
  const c4y = target.y - t2v;

  const path = [
    `M ${source.x} ${source.y}`,
    `C ${c1x} ${c1y}, ${c2x} ${c2y}, ${wp.x} ${wp.y}`,
    `C ${c3x} ${c3y}, ${c4x} ${c4y}, ${target.x} ${target.y}`,
  ].join(' ');

  return (
    <svg className="pointer-events-none fixed inset-0 z-[49]" width="100%" height="100%">
      <path
        d={path}
        fill="none"
        stroke="hsl(var(--primary) / 0.5)"
        strokeWidth={2.5}
        strokeLinecap="round"
      />
    </svg>
  );
};
