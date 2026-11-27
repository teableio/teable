import { ArrowLeft } from '@teable/icons';
import { getBaseErd } from '@teable/openapi';
import type { IBaseErdVo } from '@teable/openapi';
import { LocalStorageKeys } from '@teable/sdk/config';
import { useFieldStaticGetter } from '@teable/sdk/hooks';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocalStorage } from 'react-use';
import type { CoordinateExtent, Edge, Node } from 'reactflow';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
} from 'reactflow';
import { tableConfig } from '@/features/i18n/table.config';
import { BaseErdTableNode } from './BaseErdTableNode';
import type { IErdRelation } from './erd-graph';
import { ErdDirection, ErdFieldKind, ErdGraph } from './erd-graph';
import { CARD_HEIGHT, CARD_WIDTH, EXPANDED_WIDTH, computeBaseLayout } from './erd-layout';
import type { IErdPoint } from './erd-layout';
import type { IErdRoute, IErdSceneEdge } from './erd-scene';
import {
  ErdAction,
  ErdEdgeKind,
  ErdFlow,
  buildRouteEdges,
  buildScene,
  routeEdges,
  rowsToReveal,
} from './erd-scene';
import type { IErdActions, IErdContext } from './ErdContext';
import { ErdContext, KIND_PALETTE, RELATIONSHIP_LABEL } from './ErdContext';
import { ErdLegend } from './ErdLegend';
import type { IErdLineageHandle } from './ErdLineage';
import { ErdLineage } from './ErdLineage';
import { ErdFieldPanel, ErdTablePanel } from './ErdPanel';
import type { IErdEdgeData } from './ErdPathEdge';
import { ErdMarkers, ErdPathEdge } from './ErdPathEdge';

interface ILineLabel {
  title: string;
  lines: string[];
}
/** what a hovered table line stands for, next to the pointer and the same size at any zoom */
const LineLabel = ({ data, at, flip }: { data: ILineLabel; at: IErdPoint; flip: boolean }) => (
  <div
    className="pointer-events-none absolute z-20 whitespace-nowrap rounded-md border bg-background px-2.5 py-1.5 text-xs shadow-md"
    style={{
      left: at.x,
      top: at.y,
      transform: flip ? 'translate(calc(-100% - 14px), 14px)' : 'translate(14px, 14px)',
    }}
    data-erd-line-label
  >
    <div className="font-semibold">{data.title}</div>
    {data.lines.map((line, i) => (
      <div key={i} className="text-muted-foreground">
        {line}
      </div>
    ))}
  </div>
);
const nodeTypes = { tableNode: BaseErdTableNode };
const edgeTypes = { erdPath: ErdPathEdge };
const MOVE_MS = 300;

const openTableInNewTab = (baseId: string, tableId: string) => {
  const url = new URL(`/base/${baseId}/table/${tableId}`, window.location.origin);
  window.open(url.toString(), '_blank');
};

interface IHistoryEntry {
  focus: string;
  selected: string | null;
  openGroups: Set<string>;
  restOpen: boolean;
  viewport: { x: number; y: number; zoom: number };
  /** the scene offset the viewport was saved under */
  offset: IErdPoint;
}

/** how the view follows a change: keep an anchor still, bring a target into view, or move on purpose */
interface ICommit {
  anchor?: string;
  fallback?: string;
  reveal?: string;
  viewport?: IHistoryEntry['viewport'];
  fit?: string[];
}

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// eslint-disable-next-line sonarjs/cognitive-complexity
const ErdCanvas = ({ baseId, vo }: { baseId: string; vo: IBaseErdVo }) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const fieldStaticGetter = useFieldStaticGetter();
  const flow = useReactFlow();
  const paneWidth = useStore((s) => s.width);
  // line ends are drawn once they are big enough to read
  const detail = useStore((s) => s.transform[2] >= 0.8);
  const paneHeight = useStore((s) => s.height);
  const canvasRef = useRef<HTMLDivElement>(null);
  const lineageRef = useRef<IErdLineageHandle>(null);
  const graph = useMemo(() => new ErdGraph(vo), [vo]);
  const base = useMemo(() => computeBaseLayout(graph), [graph]);

  const [focus, setFocusState] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [restOpen, setRestOpen] = useState(false);
  const [reach, setReach] = useState<ErdDirection | null>(null);
  const [route, setRoute] = useState<IErdRoute | null>(null);
  const [routeHover, setRouteHover] = useState<IErdRoute | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [hoveredLine, setHoveredLine] = useState<string | null>(null);
  const [linePointer, setLinePointer] = useState<IErdPoint | null>(null);
  const trackLinePointer = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current?.getBoundingClientRect();
    if (r) setLinePointer({ x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const [history, setHistory] = useState<IHistoryEntry[]>([]);
  const [settling, setSettling] = useState(false);
  const [lineageOpen, setLineageOpen] = useState(false);
  const [maximized = false, setMaximized] = useLocalStorage(
    LocalStorageKeys.ErdLineageMaximized,
    false
  );
  const [lineageHeight = null, setLineageHeight] = useLocalStorage<number | null>(
    LocalStorageKeys.ErdLineageHeight,
    null
  );
  const [tick, setTick] = useState(0);

  // every position is shifted by `offset` so the anchor of a change keeps its flow position
  const offsetRef = useRef<IErdPoint>({ x: 0, y: 0 });
  const pendingRef = useRef<ICommit | null>(null);
  const prevAnchorsRef = useRef<Record<string, IErdPoint>>({});

  const rawScene = useMemo(
    () =>
      buildScene(graph, base, {
        focus,
        selected,
        openGroups,
        restOpen,
        reach,
      }),
    [graph, base, focus, selected, openGroups, restOpen, reach]
  );
  // a route only adds lines, so hovering one does not rebuild the scene
  const routeLines = useMemo(() => {
    const current = routeHover ?? route;
    return selected && current ? buildRouteEdges(graph, rawScene, focus, selected, current) : [];
  }, [graph, rawScene, focus, selected, route, routeHover]);
  const openTableRoute = route?.direction === ErdDirection.Down ? route.tableId : null;

  const pending = pendingRef.current;
  if (pending) {
    const before = prevAnchorsRef.current;
    const key = [pending.anchor, pending.fallback].find(
      (k) => k && before[k] && rawScene.anchors[k]
    );
    if (key) {
      offsetRef.current = {
        x: before[key].x - rawScene.anchors[key].x,
        y: before[key].y - rawScene.anchors[key].y,
      };
    }
  }
  const offset = offsetRef.current;
  const shift = (p: IErdPoint) => ({ x: p.x + offset.x, y: p.y + offset.y });
  const anchors = useMemo(() => {
    const result: Record<string, IErdPoint> = {};
    for (const key of Object.keys(rawScene.anchors)) result[key] = shift(rawScene.anchors[key]);
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawScene, offset.x, offset.y]);

  const hoverNeighbors = useMemo(() => {
    if (!hovered || focus) return null;
    return {
      tables: graph.neighborTables(hovered),
      pairs: new Set(graph.neighbors[hovered] ?? []),
    };
  }, [graph, hovered, focus]);

  const lineLabel = useMemo(() => {
    const edge = hoveredLine ? rawScene.edges.find((e) => e.id === hoveredLine) : undefined;
    if (!edge?.tables || edge.pairIndex === undefined) return null;
    const pair = graph.pairs[edge.pairIndex];
    const [start, end] = edge.tables;
    const tableName = (id: string) => graph.tableMap[id]?.name ?? id;
    // relationships read from the start of the line, the way its ends are drawn
    const links = pair.links.map((link) => {
      const fieldId = link.tableA === start ? link.fieldA : (link.fieldB ?? link.fieldA);
      const relation = t(RELATIONSHIP_LABEL[graph.relationshipFrom(start, link)]);
      const oneWay = link.fieldB ? '' : ` (${t('table:erd.panel.oneWay')})`;
      return `${graph.fieldMap[fieldId]?.name ?? fieldId} · ${relation}${oneWay}`;
    });
    const carried = [
      pair.lookups && `${t(`table:erd.kind.${ErdFieldKind.Lookup}`)} ${pair.lookups}`,
      pair.rollups && `${t(`table:erd.kind.${ErdFieldKind.Rollup}`)} ${pair.rollups}`,
    ].filter(Boolean) as string[];
    const flow =
      edge.flow === ErdFlow.Both
        ? t('table:erd.line.flowBoth')
        : edge.flow &&
          t('table:erd.line.flow', {
            from: tableName(edge.flow === ErdFlow.Forward ? start : end),
            to: tableName(edge.flow === ErdFlow.Forward ? end : start),
          });
    const label: ILineLabel = {
      title: `${tableName(start)} — ${tableName(end)}`,
      lines: [
        ...(links.length ? links : [t('table:erd.line.conditionalOnly')]),
        carried.length ? carried.join(' · ') : t('table:erd.line.linkOnly'),
        ...(flow ? [flow] : []),
      ],
    };
    return label;
  }, [hoveredLine, rawScene, graph, t]);
  // sizes come from the scene: React Flow keeps a node hidden until it knows its size, and
  // new node objects without one can get stuck hidden when they arrive mid-measurement
  const nodes: Node[] = useMemo(() => {
    const cards: Node[] = rawScene.cards.map((card) => ({
      id: card.id,
      type: 'tableNode',
      position: shift(card),
      width: card.width,
      height: card.height,
      data: {
        ...card,
        dim: card.dim || Boolean(hoverNeighbors && !hoverNeighbors.tables.has(card.id)),
      },
      draggable: false,
      selectable: false,
      connectable: false,
    }));
    return cards;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawScene, hoverNeighbors, offset.x, offset.y]);

  const edges: Edge[] = useMemo(
    () =>
      [...rawScene.edges, ...routeLines].map((edge) => {
        const hot =
          edge.id === hoveredLine ||
          (edge.pairIndex !== undefined && Boolean(hoverNeighbors?.pairs.has(edge.pairIndex)));
        const data: IErdEdgeData = {
          ...edge,
          baseId,
          hot,
          detail,
          dim: hoverNeighbors ? !hot : edge.dim,
          offset,
        };
        return { id: edge.id, source: edge.source, target: edge.target, type: 'erdPath', data };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawScene, routeLines, hoverNeighbors, hoveredLine, baseId, offset.x, offset.y, detail]
  );

  // panning stops a quarter canvas beyond the tables, so scrolling never loses them
  const translateExtent = useMemo<CoordinateExtent>(
    () => [
      [offset.x - paneWidth / 4, offset.y - paneHeight / 4],
      [offset.x + rawScene.width + paneWidth / 4, offset.y + rawScene.height + paneHeight / 4],
    ],
    [offset.x, offset.y, rawScene.width, rawScene.height, paneWidth, paneHeight]
  );

  const viewportSize = () => {
    const r = canvasRef.current?.getBoundingClientRect();
    return { width: r?.width ?? 800, height: r?.height ?? 600 };
  };
  const duration = () => (reducedMotion() ? 0 : MOVE_MS);

  const reveal = useCallback(
    (point: IErdPoint, width: number) => {
      const { x, y, zoom } = flow.getViewport();
      const { width: W, height: H } = viewportSize();
      const margin = 40;
      const top = 56;
      const sx = point.x * zoom + x;
      const sy = point.y * zoom + y;
      const sw = width * zoom;
      let nx = x;
      let ny = y;
      if (sx < margin) nx += margin - sx;
      else if (sx + sw > W - margin) nx -= Math.min(sx - margin, sx + sw - (W - margin));
      if (sy < top) ny += top - sy;
      else if (sy > H - 80) ny -= sy - (H - 80);
      if (nx !== x || ny !== y) flow.setViewport({ x: nx, y: ny, zoom }, { duration: duration() });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flow]
  );

  const fitBoxes = useCallback(
    (boxes: { x: number; y: number; w: number; h: number }[]) => {
      if (!boxes.length) return;
      const x0 = Math.min(...boxes.map((b) => b.x));
      const y0 = Math.min(...boxes.map((b) => b.y));
      const x1 = Math.max(...boxes.map((b) => b.x + b.w));
      const y1 = Math.max(...boxes.map((b) => b.y + b.h));
      const { width: W, height: H } = viewportSize();
      const m = 48;
      const top = 64;
      const { zoom: current } = flow.getViewport();
      const zoom = Math.max(
        0.2,
        Math.min(current, (W - 2 * m) / (x1 - x0), (H - top - m) / (y1 - y0))
      );
      flow.setViewport(
        {
          zoom,
          x: (W - (x1 - x0) * zoom) / 2 - x0 * zoom,
          y: top + (H - top - m - (y1 - y0) * zoom) / 2 - y0 * zoom,
        },
        { duration: duration() }
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flow]
  );

  useLayoutEffect(() => {
    prevAnchorsRef.current = anchors;
  }, [anchors]);

  useEffect(() => {
    const spec = pendingRef.current;
    pendingRef.current = null;
    if (!spec) return;
    if (!reducedMotion()) {
      setSettling(true);
      setTimeout(() => setSettling(false), MOVE_MS);
    }
    const widthOf = (key: string) =>
      key.startsWith('f:') || key === 'rest'
        ? EXPANDED_WIDTH - 24
        : key.slice(2) === focus
          ? EXPANDED_WIDTH
          : CARD_WIDTH;
    if (spec.viewport) {
      flow.setViewport(spec.viewport, { duration: duration() });
    } else if (spec.fit) {
      fitBoxes(
        spec.fit
          .filter((id) => anchors[`t:${id}`])
          .map((id) => ({
            ...anchors[`t:${id}`],
            w: id === focus ? EXPANDED_WIDTH : CARD_WIDTH,
            h: CARD_HEIGHT,
          }))
      );
    } else {
      const target = spec.reveal ?? spec.anchor;
      if (target && anchors[target]) reveal(anchors[target], widthOf(target));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const commit = (spec: ICommit) => {
    pendingRef.current = spec;
    setTick((n) => n + 1);
  };

  const pushHistory = () => {
    if (!focus) return;
    setHistory((h) => [
      ...h.slice(-49),
      {
        focus,
        selected,
        openGroups: new Set(openGroups),
        restOpen,
        viewport: flow.getViewport(),
        offset: offsetRef.current,
      },
    ]);
  };

  const resetTableState = () => {
    setOpenGroups(new Set());
    setRestOpen(false);
    setSelected(null);
    setReach(null);
    setRoute(null);
  };

  const setFocus = (id: string | null, spec?: ICommit) => {
    if (id && focus && id !== focus) pushHistory();
    if (!id) {
      setHistory([]);
      setLineageOpen(false);
    }
    if (id !== focus) resetTableState();
    setFocusState(id);
    setHovered(null);
    commit(spec ?? { anchor: `t:${id ?? focus}` });
  };

  const revealRows = (tableId: string, ids: string[], keep: boolean) => {
    const { openGroups: groups, restOpen: rest } = rowsToReveal(graph, tableId, ids);
    setOpenGroups((prev) => new Set([...(keep ? prev : []), ...groups]));
    if (rest) setRestOpen(true);
    else if (!keep) setRestOpen(false);
  };

  const selectField = (id: string) => {
    const tableId = graph.tableOf(id);
    if (!tableId) return;
    setSelected(id);
    setRoute(null);
    setRouteHover(null);
    setReach(null);
    revealRows(tableId, [id, ...graph.directOf(id).same.keys()], true);
    commit({ anchor: `f:${id}` });
  };

  const goField = (id: string) => {
    const tableId = graph.tableOf(id);
    if (!tableId) return;
    pushHistory();
    const sameTable = tableId === focus;
    setFocusState(tableId);
    setSelected(id);
    setRoute(null);
    setRouteHover(null);
    setReach(null);
    revealRows(tableId, [id, ...graph.directOf(id).same.keys()], sameTable);
    commit({ anchor: `f:${id}`, fallback: `t:${tableId}`, reveal: `f:${id}` });
  };

  const goBack = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    setFocusState(last.focus);
    setSelected(last.selected);
    setOpenGroups(last.openGroups);
    setRestOpen(last.restOpen);
    setReach(null);
    setRoute(null);
    offsetRef.current = last.offset;
    commit({ viewport: last.viewport });
  };

  const actions: IErdActions = {
    focusTable: (id) => setFocus(id, { anchor: `t:${id}`, reveal: `t:${id}` }),
    selectField,
    jumpToField: goField,
    toggleGroup: (id) => {
      setOpenGroups((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      commit({ anchor: `f:${id}` });
    },
    toggleRest: () => {
      setRestOpen((v) => !v);
      commit({ anchor: 'rest' });
    },
    openTable: (id) => openTableInNewTab(graph.tableMap[id]?.crossBaseId ?? baseId, id),
    hoverTable: setHovered,
  };

  // handlers change every render; the context hands out stable wrappers so cards don't re-render
  const latestActions = useRef(actions);
  useLayoutEffect(() => {
    latestActions.current = actions;
  });
  const stableActions = useMemo<IErdActions>(
    () => ({
      focusTable: (id) => latestActions.current.focusTable(id),
      selectField: (id) => latestActions.current.selectField(id),
      jumpToField: (id) => latestActions.current.jumpToField(id),
      toggleGroup: (id) => latestActions.current.toggleGroup(id),
      toggleRest: () => latestActions.current.toggleRest(),
      openTable: (id) => latestActions.current.openTable(id),
      hoverTable: (id) => latestActions.current.hoverTable(id),
    }),
    []
  );

  const deselect = () => {
    setSelected(null);
    setLineageOpen(false);
    setRoute(null);
    commit({ anchor: `t:${focus}` });
  };

  const onNodeClick = (_: unknown, node: Node) => {
    if (node.type !== 'tableNode') return;
    if (node.id !== focus) setFocus(node.id);
    else if (selected) deselect();
  };

  const onEdgeClick = (_: unknown, edge: Edge<IErdSceneEdge>) => {
    const action = edge.data?.action;
    if (!action) return;
    if (action.type === ErdAction.SelectField) selectField(action.id);
    else if (action.type === ErdAction.JumpField) goField(action.id);
    else actions.focusTable(action.id);
  };

  const toggleReach = (direction: ErdDirection) => {
    if (!focus) return;
    const next = reach === direction ? null : direction;
    setReach(next);
    commit(
      next
        ? { fit: [focus, ...Object.keys(graph.tableDeepOf(focus)[next].byTable)] }
        : { anchor: `t:${focus}` }
    );
  };

  const toggleTableRoute = (tableId: string) => {
    if (!selected) return;
    const open = openTableRoute === tableId ? null : tableId;
    const next = open ? ({ direction: ErdDirection.Down, tableId: open } as const) : null;
    setRoute(next);
    setRouteHover(null);
    if (next) {
      const tables = new Set([tableId]);
      routeEdges(graph, selected, next).forEach(({ a, b }) => {
        tables.add(a);
        tables.add(b);
      });
      commit({ fit: [...tables] });
    } else commit({});
  };

  const setLineage = (open: boolean) => {
    setLineageOpen(open);
    if (open && selected && !maximized) commit({ reveal: `f:${selected}` });
  };

  const locate = (id: string) => {
    if (maximized) setMaximized(false);
    if (id !== selected) goField(id);
    else commit({ reveal: `f:${id}` });
  };

  useEffect(() => {
    // eslint-disable-next-line sonarjs/cognitive-complexity
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT';
      if (e.key === 'Escape') {
        if (!lineageOpen && (!focus || typing)) return;
        // handled here, so the dialog around the ERD does not close as well
        e.preventDefault();
        e.stopPropagation();
        if (lineageOpen) {
          if (!lineageRef.current?.clearPin()) setLineageOpen(false);
        } else if (selected) deselect();
        else setFocus(null);
      } else if (e.key === 'ArrowLeft' && (e.altKey || e.metaKey) && history.length && !typing) {
        e.preventDefault();
        goBack();
      }
    };
    // capture on window runs before the dialog's own Escape listener on the document
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const last = history[history.length - 1];
  const backLabel = last
    ? last.selected && graph.fieldMap[last.selected]
      ? `${graph.tableMap[last.focus]?.name} · ${graph.fieldMap[last.selected].name}`
      : (graph.tableMap[last.focus]?.name ?? '')
    : null;
  const lineageVisible = lineageOpen && Boolean(selected && graph.fieldMap[selected]);
  const related = useMemo(
    () => (selected ? graph.directOf(selected).same : new Map<string, IErdRelation>()),
    [graph, selected]
  );
  const context = useMemo<IErdContext>(
    () => ({
      graph,
      selected,
      openGroups,
      restOpen,
      related,
      actions: stableActions,
      fieldStaticGetter,
    }),
    [graph, selected, openGroups, restOpen, related, stableActions, fieldStaticGetter]
  );

  return (
    <ErdContext.Provider value={context}>
      <div
        className={cn('flex size-full min-h-0 overflow-hidden rounded-[inherit]', KIND_PALETTE)}
        data-erd
      >
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div
              ref={canvasRef}
              className={cn(
                'relative min-h-0 flex-1',
                '[&_.react-flow__node]:transition-transform [&_.react-flow__node]:duration-300 [&_.react-flow__node]:ease-[cubic-bezier(.2,.7,.2,1)] motion-reduce:[&_.react-flow__node]:transition-none',
                '[&_.react-flow__edges]:transition-opacity [&_.react-flow__edges]:delay-200 [&_.react-flow__edges]:duration-150',
                settling &&
                  '[&_.react-flow__edges]:opacity-0 [&_.react-flow__edges]:delay-0 [&_.react-flow__edges]:duration-0'
              )}
              data-erd-canvas
            >
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodeClick={onNodeClick}
                onEdgeClick={onEdgeClick}
                onEdgeMouseEnter={(e, edge: Edge<IErdEdgeData>) => {
                  if (edge.data?.kind !== ErdEdgeKind.Table) return;
                  setHoveredLine(edge.id);
                  trackLinePointer(e);
                }}
                onEdgeMouseMove={trackLinePointer}
                onEdgeMouseLeave={() => setHoveredLine(null)}
                onPaneClick={() => focus && setFocus(null)}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                zoomOnDoubleClick={false}
                panOnScroll
                translateExtent={translateExtent}
                fitView
                fitViewOptions={{ padding: 0.05, maxZoom: 1.2 }}
                minZoom={0.2}
                maxZoom={2}
                proOptions={{ hideAttribution: true }}
              >
                <ErdMarkers baseId={baseId} />
                <Background variant={BackgroundVariant.Dots} className="bg-secondary" />
                <Controls
                  showInteractive={false}
                  fitViewOptions={{ duration: 500, padding: 0.05 }}
                />
                {vo.edges.length > 0 && !lineageVisible && <ErdLegend baseId={baseId} />}
              </ReactFlow>
              {lineLabel && linePointer && (
                <LineLabel
                  data={lineLabel}
                  at={linePointer}
                  flip={linePointer.x > (canvasRef.current?.clientWidth ?? 0) - 360}
                />
              )}
              {last && !(lineageVisible && maximized) && (
                <Button
                  variant="outline"
                  className="absolute bottom-5 left-1/2 z-20 max-w-[calc(100%-32px)] -translate-x-1/2 rounded-full border-primary px-4 font-semibold text-primary shadow-md"
                  onClick={goBack}
                  title={`${t('table:erd.back', { name: backLabel })} · ${t('table:erd.backShortcut')}`}
                  data-erd-back
                >
                  <ArrowLeft className="size-4" />
                  <span className="truncate">{t('table:erd.back', { name: backLabel })}</span>
                </Button>
              )}
            </div>
            {lineageVisible && selected && (
              <ErdLineage
                ref={lineageRef}
                fieldId={selected}
                maximized={maximized}
                height={lineageHeight}
                backLabel={backLabel}
                onBack={goBack}
                onMaximize={(m) => {
                  setMaximized(m);
                  if (!m && selected) commit({ reveal: `f:${selected}` });
                }}
                onHeight={setLineageHeight}
                onClose={() => setLineage(false)}
                onLocate={locate}
              />
            )}
          </div>
        </div>
        {focus && (
          <aside className="w-80 shrink-0 overflow-y-auto border-s bg-background" data-erd-panel>
            {selected && graph.fieldMap[selected] ? (
              <ErdFieldPanel
                key={selected}
                fieldId={selected}
                lineageOpen={lineageVisible}
                openTableRoute={openTableRoute}
                onLineage={() => setLineage(!lineageOpen)}
                onBack={deselect}
                onRouteHover={setRouteHover}
                onToggleTableRoute={toggleTableRoute}
              />
            ) : (
              <ErdTablePanel key={focus} tableId={focus} reach={reach} onReach={toggleReach} />
            )}
          </aside>
        )}
      </div>
    </ErdContext.Provider>
  );
};

export const BaseErd = ({ baseId }: { baseId: string }) => {
  const [vo, setVo] = useState<IBaseErdVo | null>(null);

  useEffect(() => {
    let cancelled = false;
    getBaseErd(baseId).then((res) => !cancelled && setVo(res.data));
    return () => {
      cancelled = true;
    };
  }, [baseId]);

  if (!vo) return null;
  return (
    <ReactFlowProvider>
      <ErdCanvas baseId={baseId} vo={vo} />
    </ReactFlowProvider>
  );
};
