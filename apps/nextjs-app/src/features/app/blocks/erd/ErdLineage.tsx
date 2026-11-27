import { ArrowLeft, ChevronDown, ChevronRight, Maximize2, Minimize2, X } from '@teable/icons';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ControlButton } from 'reactflow';
import { tableConfig } from '@/features/i18n/table.config';
import { TableIcon } from './BaseErdTableNode';
import { ErdDirection, ErdFieldKind, getFieldKind } from './erd-graph';
import type {
  IErdLineageCard,
  IErdLineageEdge,
  IErdLineageLayout,
  IErdLineageNode,
} from './erd-lineage';
import { ErdLineageNodeKind, buildLineage, lineageReach } from './erd-lineage';
import { KIND_STROKE, LINK_DASH, pressable, useErd, useFieldIcon } from './ErdContext';

const MIN_HEIGHT = 160;
const READABLE_ZOOM = 0.6;

interface IView {
  k: number;
  x: number;
  y: number;
}

export interface IErdLineageHandle {
  /** clears the pinned node; false when nothing was pinned */
  clearPin: () => boolean;
}

interface IErdLineageProps {
  fieldId: string;
  maximized: boolean;
  height: number | null;
  backLabel: string | null;
  onBack: () => void;
  onMaximize: (maximized: boolean) => void;
  onHeight: (height: number) => void;
  onClose: () => void;
  onLocate: (fieldId: string) => void;
}

const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const c = Math.max(40, Math.abs(x2 - x1) / 2);
  return `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// eslint-disable-next-line sonarjs/cognitive-complexity
export const ErdLineage = forwardRef<IErdLineageHandle, IErdLineageProps>((props, ref) => {
  const { fieldId, maximized, height } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { graph, actions } = useErd();
  const iconOf = useFieldIcon();
  const paneRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [paneWidth, setPaneWidth] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [hovered, setHovered] = useState<IErdLineageNode | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [view, setView] = useState<IView | null>(null);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const anchorRef = useRef<{ key: string; x: number; y: number } | null>(null);

  useEffect(() => {
    setExpanded(new Set());
    setPinned(null);
    setView(null);
  }, [fieldId]);
  useEffect(() => setView(null), [maximized, height]);

  useLayoutEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setPaneWidth(el.clientWidth));
    observer.observe(el);
    setPaneWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  const layout: IErdLineageLayout | null = useMemo(
    () => (paneWidth ? buildLineage(graph, fieldId, expanded, paneWidth) : null),
    [graph, fieldId, expanded, paneWidth]
  );

  const fit = useCallback((l: IErdLineageLayout, keepReadable: boolean): IView | null => {
    const body = bodyRef.current;
    if (!body) return null;
    const W0 = body.clientWidth;
    const H0 = body.clientHeight - l.headerHeight;
    let k = Math.min(1, (W0 - 40) / l.width, (H0 - 20) / l.height);
    if (!keepReadable || k >= READABLE_ZOOM) {
      return {
        k,
        x: (W0 - l.width * k) / 2,
        y: l.headerHeight + Math.max(0, (H0 - l.height * k) / 2),
      };
    }
    // otherwise stay readable and centre the current field, without empty space past the edges
    k = READABLE_ZOOM;
    const self = l.nodes.find((n) => n.self)!;
    const x =
      l.width * k <= W0
        ? (W0 - l.width * k) / 2
        : clamp(W0 / 2 - (self.x + l.nodeWidth / 2) * k, W0 - l.width * k - 20, 20);
    const y =
      l.headerHeight +
      (l.height * k <= H0
        ? (H0 - l.height * k) / 2
        : clamp(H0 / 2 - (self.y + self.h / 2) * k, H0 - l.height * k - 20, 0));
    return { k, x, y };
  }, []);

  useLayoutEffect(() => {
    if (!layout) return;
    const anchor = anchorRef.current;
    if (anchor && view) {
      // keep the expanded node's first field where the clicked node was
      const first =
        layout.nodes.find((n) => n.from === anchor.key) ??
        layout.nodes.find((n) => n.column.key === anchor.key);
      anchorRef.current = null;
      if (first)
        setView({ ...view, x: anchor.x - first.x * view.k, y: anchor.y - first.y * view.k });
      return;
    }
    if (!view) setView(fit(layout, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, view === null]);

  const pinnedNode = layout && pinned ? layout.nodes.find((n) => n.id === pinned) : undefined;
  // a hover from an earlier layout no longer points at a node of this one
  const hoveredIndex = hovered && layout?.nodes[hovered.index] === hovered ? hovered.index : null;
  const active = pinnedNode?.index ?? hoveredIndex;
  // panning re-renders on every frame, so the reach is only recomputed when the path changes
  const reach = useMemo(
    () => (layout && active !== null && active !== undefined ? lineageReach(layout, active) : null),
    [layout, active]
  );

  useImperativeHandle(ref, () => ({
    clearPin: () => {
      if (!pinned) return false;
      setPinned(null);
      return true;
    },
  }));

  const zoomAt = (factor: number, cx: number, cy: number) =>
    setView((v) => {
      if (!v) return v;
      const k = clamp(v.k * factor, 0.3, 2);
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
    });

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = body.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey)
        zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      else
        setView(
          (v) =>
            v && {
              ...v,
              x: v.x - (e.shiftKey ? e.deltaY : e.deltaX),
              y: v.y - (e.shiftKey ? 0 : e.deltaY),
            }
        );
    };
    body.addEventListener('wheel', onWheel, { passive: false });
    return () => body.removeEventListener('wheel', onWheel);
  }, []);

  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(
    null
  );
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || !view) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      d.moved = true;
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    }
    if (d.moved) setView((v) => v && { ...v, x: d.vx + dx, y: d.vy + dy });
  };
  const moved = () => Boolean(drag.current?.moved);
  const onPointerUp = () => {
    setTimeout(() => (drag.current = null));
  };

  const toggleExpand = (key: string, node?: IErdLineageNode) => {
    if (moved()) return;
    if (node && view)
      anchorRef.current = { key, x: node.x * view.k + view.x, y: node.y * view.k + view.y };
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const onGripDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const pane = paneRef.current;
    const parent = pane?.parentElement;
    if (!pane || !parent) return;
    const y0 = e.clientY;
    const h0 = pane.offsetHeight;
    const H = parent.clientHeight;
    let h = h0;
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      h = clamp(h0 - (ev.clientY - y0), MIN_HEIGHT, H - 40);
      setDragHeight(h);
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      setDragHeight(null);
      if (h === h0) return;
      // dragging to the top maximizes; restoring goes back to the height before the drag
      if (h > H - 100) props.onMaximize(true);
      else props.onHeight(Math.round(h));
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  };

  const deep = graph.deepOf(fieldId);
  const field = graph.fieldMap[fieldId];
  const kindIn = (id: string) => {
    if (id === fieldId) return t(`table:erd.kind.${getFieldKind(field)}`);
    const level = deep[ErdDirection.Up].levels.get(id) ?? deep[ErdDirection.Down].levels.get(id);
    return t(`table:erd.kind.${level?.kind ?? ErdFieldKind.Other}`);
  };
  // the kind of a lineage edge is how its dependent end uses the other end
  const edgeKind = (e: IErdLineageEdge) => {
    const end = e.direction === ErdDirection.Up ? e.from : e.to;
    return (
      (end.kind === ErdLineageNodeKind.Field && end.id
        ? deep[e.direction].levels.get(end.id)?.kind
        : undefined) ?? ErdFieldKind.Other
    );
  };
  const deepSummary = (direction: ErdDirection) => {
    const w = deep[direction];
    if (!w.levels.size)
      return direction === ErdDirection.Up
        ? t('table:erd.lineage.noUp')
        : t('table:erd.lineage.noDown');
    return t(
      direction === ErdDirection.Up
        ? 'table:erd.lineage.upSummary'
        : 'table:erd.lineage.downSummary',
      {
        count: w.levels.size,
        depth: w.depth,
      }
    );
  };

  // a card's header stays lit while any of its rows is on the path
  const litCards = useMemo(
    () =>
      layout && reach
        ? new Set(layout.nodes.filter((n) => reach.nodes.has(n.index)).map((n) => n.card))
        : null,
    [layout, reach]
  );

  const rowLabel = (n: IErdLineageNode) => {
    const f = graph.fieldMap[n.id!];
    const Icon = iconOf(f);
    return {
      title: f.name,
      side: kindIn(f.id),
      tip: t('table:erd.lineage.nodeTip', {
        table: graph.tableMap[f.tableId]?.name,
        field: f.name,
      }),
      icon: <Icon className="size-3 shrink-0 text-muted-foreground" />,
    };
  };
  const headerTip = (n: IErdLineageNode, title: string) => {
    if (n.kind === ErdLineageNodeKind.More) return t('table:erd.lineage.moreTip');
    if (!n.expandKey) return title;
    return n.open
      ? t('table:erd.lineage.openedTip', { table: title })
      : t('table:erd.lineage.mergedTip', { table: title, count: n.fields });
  };
  const headerLabel = (n: IErdLineageNode, narrow: boolean) => {
    const more = n.kind === ErdLineageNodeKind.More;
    const table = n.tableId ? graph.tableMap[n.tableId] : undefined;
    const title = more
      ? t('table:erd.lineage.moreTables', { count: n.tables })
      : (table?.name ?? '');
    const Chevron = n.open ? ChevronDown : ChevronRight;
    return {
      title,
      // narrow columns keep the room for the table name
      side: narrow
        ? String(more ? n.members.length : n.fields)
        : t('table:erd.card.summary', { count: more ? n.members.length : n.fields }),
      tip: headerTip(n, title),
      icon: (
        <>
          {n.expandKey && <Chevron className="size-3 shrink-0 text-muted-foreground" />}
          {!more && <TableIcon icon={table?.icon} className="size-3" />}
        </>
      ),
    };
  };

  const nodesByCard = useMemo(() => {
    const map = new Map<string, IErdLineageNode[]>();
    layout?.nodes.forEach((n) => map.set(n.card, [...(map.get(n.card) ?? []), n]));
    return map;
  }, [layout]);

  const renderNode = (n: IErdLineageNode, l: IErdLineageLayout, card: IErdLineageCard) => {
    const isRow = n.kind === ErdLineageNodeKind.Field;
    const on = isRow ? reach?.nodes.has(n.index) : litCards?.has(n.card);
    const {
      title,
      side,
      tip,
      icon,
    }: { title: string; side: string; tip?: string; icon: ReactNode } = isRow
      ? rowLabel(n)
      : headerLabel(n, l.nodeWidth < 160);
    return (
      <div
        key={`${n.column.key}:${n.kind}:${n.id ?? n.tableId ?? 'more'}`}
        title={tip}
        data-node={n.id ?? n.expandKey}
        data-kind={n.kind}
        data-open={n.open || undefined}
        data-self={n.self || undefined}
        className={cn(
          'absolute flex items-center gap-1 px-2 text-start text-xs transition-opacity',
          // rows sit indented under their table's grey header, as on a canvas card
          isRow ? 'cursor-pointer border-t ps-5 hover:bg-accent' : 'bg-muted font-semibold',
          !isRow && n.expandKey && 'cursor-pointer hover:bg-accent',
          n.self && 'rounded-sm ring-2 ring-inset ring-primary',
          reach && !on && 'opacity-25',
          pinned && n.id === pinned && 'rounded-sm ring-2 ring-inset ring-primary'
        )}
        style={{ left: 0, right: 0, top: n.y - card.y, height: n.h }}
        onMouseEnter={() => isRow && !pinned && setHovered(n)}
        onMouseLeave={() => isRow && !pinned && setHovered(null)}
        {...pressable((e) => {
          e.stopPropagation();
          if (moved()) return;
          if (isRow) {
            setPinned(n.id!);
            setHovered(null);
          } else if (n.expandKey) toggleExpand(n.expandKey, n);
        })}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="shrink-0 text-[11px] font-normal text-muted-foreground">{side}</span>
      </div>
    );
  };

  const pick = pinnedNode && pinnedNode.id ? pinnedNode.id : null;
  const pickField = pick ? graph.fieldMap[pick] : null;

  return (
    <div
      ref={paneRef}
      data-lineage
      className={cn(
        'z-10 flex flex-col border-t bg-background',
        maximized
          ? 'absolute inset-0 border-t-0'
          : 'relative flex-none shadow-[0_-6px_18px_rgba(0,0,0,0.06)]'
      )}
      style={
        maximized
          ? undefined
          : {
              height: dragHeight ?? height ?? '50%',
              minHeight: MIN_HEIGHT,
              maxHeight: 'calc(100% - 40px)',
            }
      }
    >
      {!maximized && (
        <div
          className="absolute inset-x-0 -top-1.5 z-20 flex h-3 cursor-row-resize items-center justify-center"
          title={t('table:erd.lineage.grip')}
          onPointerDown={onGripDown}
          onDoubleClick={() => props.onMaximize(true)}
          data-lineage-grip
        >
          <i className="h-1 w-10 rounded-full bg-border" />
        </div>
      )}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        {props.backLabel && (
          <button
            type="button"
            className="flex min-w-0 max-w-[30%] items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            title={t('table:erd.back', { name: props.backLabel })}
            onClick={props.onBack}
          >
            <ArrowLeft className="size-4 shrink-0" />
            <span className="truncate">{t('table:erd.back', { name: props.backLabel })}</span>
          </button>
        )}
        <div
          className="min-w-0 flex-1 truncate text-sm"
          title={`${field.name} · ${graph.tableMap[field.tableId]?.name ?? ''}`}
          data-lineage-title
        >
          <b>{t('table:erd.lineage.title', { field: field.name })}</b>{' '}
          <span className="text-xs text-muted-foreground">
            {graph.tableMap[field.tableId]?.name} · {deepSummary(ErdDirection.Up)} ·{' '}
            {deepSummary(ErdDirection.Down)}
          </span>
        </div>
        <Button
          variant="ghost"
          size="xs"
          className="size-7 p-0"
          aria-pressed={maximized}
          aria-label={maximized ? t('table:erd.lineage.restore') : t('table:erd.lineage.maximize')}
          title={maximized ? t('table:erd.lineage.restoreTip') : t('table:erd.lineage.maximizeTip')}
          onClick={() => props.onMaximize(!maximized)}
          data-lineage-max
        >
          {maximized ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          className="size-7 p-0"
          aria-label={t('table:erd.lineage.close')}
          title={t('table:erd.lineage.close')}
          onClick={props.onClose}
          data-lineage-close
        >
          <X className="size-4" />
        </Button>
      </div>
      {/* clicking the empty background clears the highlight, like the canvas does */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        ref={bodyRef}
        className="relative min-h-0 flex-1 cursor-grab overflow-hidden bg-secondary/40"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={() => !moved() && setPinned(null)}
        data-lineage-body
      >
        {layout && view && (
          <>
            <div
              className="absolute origin-top-left"
              style={{
                left: 0,
                top: 0,
                transform: `translate(${view.x}px,${view.y}px) scale(${view.k})`,
              }}
            >
              <svg
                className="pointer-events-none absolute overflow-visible"
                style={{ left: 0, top: 0 }}
                width={layout.width}
                height={layout.height}
              >
                {layout.edges.map((e) => {
                  const NW = layout.nodeWidth;
                  const d = curve(
                    e.from.x + NW,
                    e.from.y + e.from.h / 2,
                    e.to.x,
                    e.to.y + e.to.h / 2
                  );
                  const on = reach?.edgeOn(e);
                  const kind = edgeKind(e);
                  return (
                    <path
                      key={`${e.from.index}-${e.to.index}`}
                      d={d}
                      fill="none"
                      stroke={KIND_STROKE[kind]}
                      strokeDasharray={kind === ErdFieldKind.Link ? LINK_DASH : undefined}
                      strokeWidth={on ? 1.8 : 1.2}
                      strokeOpacity={reach ? (on ? 1 : 0.08) : 0.55}
                    />
                  );
                })}
              </svg>
              {/* opaque cards hide the lines running behind them, so a line meets its own row */}
              {layout.cards.map((c) => (
                <div
                  key={c.key}
                  className={cn(
                    'absolute overflow-hidden rounded-md border bg-background',
                    c.more && 'border-dashed'
                  )}
                  // the border sits outside the layout box, so rows keep the coordinates lines use
                  style={{
                    left: c.x - 1,
                    top: c.y - 1,
                    width: layout.nodeWidth + 2,
                    height: c.height + 2,
                  }}
                >
                  {nodesByCard.get(c.key)?.map((n) => renderNode(n, layout, c))}
                </div>
              ))}
            </div>
            <div
              className="pointer-events-none absolute inset-x-0 top-0 z-[2] border-b bg-background"
              style={{ height: layout.headerHeight }}
              data-lineage-header
            >
              {layout.columns.map((c) => (
                <div
                  key={c.key}
                  className="absolute top-0 flex h-full -translate-x-1/2 flex-col items-center justify-center whitespace-nowrap text-xs leading-4"
                  style={{ left: view.x + (c.nodes[0].x + layout.nodeWidth / 2) * view.k }}
                >
                  <ColumnLabel column={c} full={layout.nodeWidth >= 160} />
                </div>
              ))}
            </div>
            {/* the canvas's own zoom controls, so both panes look the same */}
            <div className="react-flow__controls absolute bottom-[15px] start-[15px] z-[3]">
              {(
                [
                  ['in', ZOOM_ICONS.in, t('table:erd.zoomIn')],
                  ['out', ZOOM_ICONS.out, t('table:erd.zoomOut')],
                  ['fit', ZOOM_ICONS.fit, t('table:erd.fitView')],
                ] as const
              ).map(([key, icon, tip]) => (
                <ControlButton
                  key={key}
                  aria-label={tip}
                  title={tip}
                  onClick={(e) => {
                    e.stopPropagation();
                    const body = bodyRef.current!;
                    if (key === 'fit') setView(fit(layout, false));
                    else
                      zoomAt(
                        key === 'in' ? 1.25 : 0.8,
                        body.clientWidth / 2,
                        body.clientHeight / 2
                      );
                  }}
                >
                  {icon}
                </ControlButton>
              ))}
            </div>
          </>
        )}
      </div>
      {pickField && (
        <div
          className="flex shrink-0 flex-wrap items-center gap-2 border-t px-3 py-2 text-sm"
          data-lineage-pick
        >
          <b className="min-w-0 max-w-[40%] truncate" title={pickField.name}>
            {pickField.name}
          </b>
          <span className="text-xs text-muted-foreground">
            {t('table:erd.lineage.pickSummary', {
              table: graph.tableMap[pickField.tableId]?.name,
              kind: kindIn(pickField.id),
              up: graph.upOf(pickField.id).length,
              down: graph.downOf(pickField.id).length,
              count: (reach?.nodes.size ?? 1) - 1,
            })}
          </span>
          <span className="flex-1" />
          {pickField.id !== fieldId && (
            <Button size="xs" onClick={() => actions.jumpToField(pickField.id)} data-lineage-center>
              {t('table:erd.lineage.center')}
            </Button>
          )}
          <Button
            size="xs"
            variant="outline"
            onClick={() => props.onLocate(pickField.id)}
            data-lineage-locate
          >
            {t('table:erd.lineage.locate')}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setPinned(null)}>
            {t('table:erd.lineage.unpin')}
          </Button>
        </div>
      )}
    </div>
  );
});

ErdLineage.displayName = 'ErdLineage';

// React Flow's control icons, which it does not export
const ZOOM_ICONS = {
  in: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
      <path d="M32 18.133H18.133V32h-4.266V18.133H0v-4.266h13.867V0h4.266v13.867H32z" />
    </svg>
  ),
  out: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 5">
      <path d="M0 0h32v4.2H0z" />
    </svg>
  ),
  fit: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 30">
      <path d="M3.692 4.63c0-.53.4-.938.939-.938h5.215V0H4.708C2.13 0 0 2.054 0 4.63v5.216h3.692V4.631zM27.354 0h-5.2v3.692h5.17c.53 0 .984.4.984.939v5.215H32V4.631A4.624 4.624 0 0027.354 0zm.954 24.83c0 .532-.4.94-.939.94h-5.215v3.768h5.215c2.577 0 4.631-2.13 4.631-4.707v-5.139h-3.692v5.139zm-23.677.94c-.531 0-.939-.4-.939-.94v-5.138H0v5.139c0 2.577 2.13 4.707 4.708 4.707h5.138V25.77H4.631z" />
    </svg>
  ),
};

const ColumnLabel = ({
  column,
  full,
}: {
  column: IErdLineageLayout['columns'][number];
  full: boolean;
}) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  if (column.self) return <span className="font-semibold">{t('table:erd.lineage.current')}</span>;
  const direction = column.direction!;
  const layer = t('table:erd.lineage.layer', { depth: column.depth, count: column.count });
  return (
    <span className="font-semibold">
      {full
        ? `${direction === ErdDirection.Up ? t('table:erd.panel.dependsOn') : t('table:erd.panel.affects')} · ${layer}`
        : layer}
    </span>
  );
};
