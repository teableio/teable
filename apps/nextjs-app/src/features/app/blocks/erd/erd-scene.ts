/* eslint-disable sonarjs/cognitive-complexity */
import { Relationship, RelationshipRevert } from '@teable/core';
import type { ErdGraph, IErdField, IErdGroup, IErdLink, IErdPair, IErdWalk } from './erd-graph';
import { EMPTY_WALK, ErdDirection, ErdFieldKind, getFieldKind } from './erd-graph';
import type { IErdBaseLayout, IErdPoint } from './erd-layout';
import { CARD_HEIGHT, CARD_WIDTH, EXPANDED_WIDTH, placeCards } from './erd-layout';

const HEAD_HEIGHT = 52;
const ROW_HEIGHT = 28;
const SUB_ROW_HEIGHT = 22;
export const MINI_ROW_HEIGHT = 22;
const MAX_MINI_ROWS = 8;

export enum ErdRowKind {
  Link = 'link',
  Via = 'via',
  Incoming = 'incoming',
  RestHead = 'restHead',
  Rest = 'rest',
}

export interface IErdRow {
  kind: ErdRowKind;
  y: number;
  height: number;
  field?: IErdField;
  group?: IErdGroup;
  link?: IErdLink;
  rest?: IErdField[];
}

interface IErdMiniRow {
  id: string;
  direction: ErdDirection;
  kind: ErdFieldKind;
}

export interface IErdCard {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  expanded: boolean;
  rows: IErdRow[];
  mini: IErdMiniRow[];
  miniMore: number;
  dim: boolean;
  /** fields reached in this table, direct or not */
  up: number;
  down: number;
}

export enum ErdEdgeKind {
  Table = 'table',
  Field = 'field',
  Relation = 'relation',
  Route = 'route',
}

export enum ErdAction {
  SelectField = 'selectField',
  JumpField = 'jumpField',
  FocusTable = 'focusTable',
}

export enum ErdCardinality {
  One = 'one',
  Many = 'many',
}

/** which way lookups and rollups carry data along a table line, relative to its path */
export enum ErdFlow {
  Forward = 'forward',
  Backward = 'backward',
  Both = 'both',
}

export interface IErdArrow {
  x: number;
  y: number;
  angle: number;
}

export interface IErdSceneEdge {
  id: string;
  source: string;
  target: string;
  path: string;
  kind: ErdEdgeKind;
  direction?: ErdDirection;
  strokeWidth: number;
  dim: boolean;
  action?: { type: ErdAction; id: string };
  /** table lines: index into `graph.pairs` */
  pairIndex?: number;
  /** table lines: cardinality at the path's start and end, none without a link */
  ends?: [ErdCardinality, ErdCardinality];
  flow?: ErdFlow;
  /** table lines: the tables at the path's start and end, and the flow arrows on the path */
  tables?: [string, string];
  arrows?: IErdArrow[];
  /** the kind of relation the line stands for, which sets its colour */
  fieldKind?: ErdFieldKind;
}

export type IErdRoute =
  | { direction: ErdDirection.Down; tableId: string }
  | { direction: ErdDirection.Up; fieldId: string };

export interface IErdSceneState {
  focus: string | null;
  selected: string | null;
  openGroups: ReadonlySet<string>;
  restOpen: boolean;
  /** whole-table reach highlighted from the table panel */
  reach: ErdDirection | null;
}

export interface IErdScene {
  cards: IErdCard[];
  edges: IErdSceneEdge[];
  /** `t:<tableId>`, `f:<fieldId>` and `rest`, in flow coordinates */
  anchors: Record<string, IErdPoint>;
  positions: Record<string, IErdPoint>;
  width: number;
  height: number;
}

type IXY = [number, number];
type ICubic = [IXY, IXY, IXY, IXY];

const curve = (x1: number, y1: number, x2: number, y2: number): ICubic => {
  const c = Math.max(40, Math.abs(x2 - x1) / 2);
  const s = x2 >= x1 ? 1 : -1;
  return [
    [x1, y1],
    [x1 + c * s, y1],
    [x2 - c * s, y2],
    [x2, y2],
  ];
};
const cubicPath = ([p0, p1, p2, p3]: ICubic) =>
  `M${p0[0]},${p0[1]} C${p1[0]},${p1[1]} ${p2[0]},${p2[1]} ${p3[0]},${p3[1]}`;

/** a point on the cubic and the direction it runs there, in degrees */
const cubicAt = ([p0, p1, p2, p3]: ICubic, t: number): IErdArrow => {
  const u = 1 - t;
  const at = (i: 0 | 1) =>
    u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i];
  const slope = (i: 0 | 1) =>
    3 * u * u * (p1[i] - p0[i]) + 6 * u * t * (p2[i] - p1[i]) + 3 * t * t * (p3[i] - p2[i]);
  return { x: at(0), y: at(1), angle: (Math.atan2(slope(1), slope(0)) * 180) / Math.PI };
};

/** one arrow in the middle, or two spread apart pointing away from each other when data goes both ways */
const flowArrows = (cubic: ICubic, flow?: ErdFlow): IErdArrow[] => {
  const turn = (a: IErdArrow) => ({ ...a, angle: a.angle + 180 });
  if (flow === ErdFlow.Forward) return [cubicAt(cubic, 0.5)];
  if (flow === ErdFlow.Backward) return [turn(cubicAt(cubic, 0.5))];
  if (flow !== ErdFlow.Both) return [];
  // spread out until the two arrows read as two on a short line
  let pair: [IErdArrow, IErdArrow] = [cubicAt(cubic, 0.4), cubicAt(cubic, 0.6)];
  for (const t of [0.3, 0.2]) {
    if (Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y) >= 18) break;
    pair = [cubicAt(cubic, t), cubicAt(cubic, 1 - t)];
  }
  return [turn(pair[0]), pair[1]];
};

/** crow's foot: many records of `tableId` can point at one record on the other side */
export const cardinalityAt = (pair: IErdPair, tableId: string) =>
  pair.links.some((link) => {
    const r = link.tableA === tableId ? link.relationship : RelationshipRevert[link.relationship];
    return r === Relationship.ManyOne || r === Relationship.ManyMany;
  })
    ? ErdCardinality.Many
    : ErdCardinality.One;

export const flowAlong = (pair: IErdPair, startTable: string) => {
  const forward = startTable === pair.a ? pair.flowAB : pair.flowBA;
  const backward = startTable === pair.a ? pair.flowBA : pair.flowAB;
  if (forward && backward) return ErdFlow.Both;
  if (forward) return ErdFlow.Forward;
  if (backward) return ErdFlow.Backward;
  return undefined;
};

interface IBox {
  x: number;
  w: number;
  y: number;
}

/** a line between the sides of two cards; cards in the same column loop out to the right */
const betweenCubic = (a: IBox, b: IBox): ICubic => {
  if (a.x === b.x) {
    const bx = a.x + Math.max(a.w, b.w) + 60;
    return [
      [a.x + a.w, a.y],
      [bx, a.y],
      [bx, b.y],
      [b.x + b.w, b.y],
    ];
  }
  return a.x < b.x ? curve(a.x + a.w, a.y, b.x, b.y) : curve(a.x, a.y, b.x + b.w, b.y);
};
export const between = (a: IBox, b: IBox) => cubicPath(betweenCubic(a, b));

/** what a link row's line carries, like a table line: the lookups and rollups through the link */
const linkRowFlow = (graph: ErdGraph, link: IErdLink, ownField?: string) => {
  // data comes in through the focused table's own field, and goes out through the other side's
  const into = ownField ? graph.viaOf(ownField) : [];
  const otherField =
    ownField === undefined ? link.fieldA : ownField === link.fieldA ? link.fieldB : link.fieldA;
  const out = otherField ? graph.viaOf(otherField) : [];
  const kinds = [...into, ...out].map(getFieldKind);
  const kind = kinds.includes(ErdFieldKind.Rollup)
    ? ErdFieldKind.Rollup
    : kinds.length
      ? ErdFieldKind.Lookup
      : ErdFieldKind.Link;
  const flow =
    into.length && out.length
      ? ErdFlow.Both
      : out.length
        ? ErdFlow.Forward
        : into.length
          ? ErdFlow.Backward
          : undefined;
  return { kind, flow };
};

const buildRows = (
  graph: ErdGraph,
  tableId: string,
  openGroups: ReadonlySet<string>,
  restOpen: boolean
) => {
  const { groups, rest, incoming } = graph.groupsOf(tableId);
  const rows: IErdRow[] = [];
  let y = HEAD_HEIGHT;
  for (const group of groups) {
    rows.push({ kind: ErdRowKind.Link, y, height: ROW_HEIGHT, group, field: group.field });
    y += ROW_HEIGHT;
    if (openGroups.has(group.field.id)) {
      for (const field of group.via) {
        rows.push({ kind: ErdRowKind.Via, y, height: SUB_ROW_HEIGHT, field });
        y += SUB_ROW_HEIGHT;
      }
    }
  }
  for (const link of incoming) {
    rows.push({ kind: ErdRowKind.Incoming, y, height: ROW_HEIGHT, link });
    y += ROW_HEIGHT;
  }
  if (rest.length) {
    rows.push({ kind: ErdRowKind.RestHead, y, height: ROW_HEIGHT, rest });
    y += ROW_HEIGHT;
    if (restOpen) {
      for (const field of rest) {
        rows.push({ kind: ErdRowKind.Rest, y, height: SUB_ROW_HEIGHT, field });
        y += SUB_ROW_HEIGHT;
      }
    }
  }
  return { rows, height: y + 8 };
};

/** groups and the rest section to open so these fields have a row on the expanded card */
export const rowsToReveal = (graph: ErdGraph, tableId: string, fieldIds: string[]) => {
  const { groups, rest } = graph.groupsOf(tableId);
  const openGroups: string[] = [];
  let restOpen = false;
  for (const id of fieldIds) {
    const group = groups.find((g) => g.via.some((f) => f.id === id));
    if (group) openGroups.push(group.field.id);
    else if (rest.some((f) => f.id === id)) restOpen = true;
  }
  return { openGroups, restOpen };
};

const deepFor = (graph: ErdGraph, state: IErdSceneState): Record<ErdDirection, IErdWalk> | null => {
  if (state.selected) return graph.deepOf(state.selected);
  if (state.focus && state.reach) {
    return {
      [ErdDirection.Up]: EMPTY_WALK,
      [ErdDirection.Down]: EMPTY_WALK,
      [state.reach]: graph.tableDeepOf(state.focus)[state.reach],
    };
  }
  return null;
};

export const buildScene = (
  graph: ErdGraph,
  base: IErdBaseLayout,
  state: IErdSceneState
): IErdScene => {
  const { focus, selected } = state;
  const card = focus ? buildRows(graph, focus, state.openGroups, state.restOpen) : null;
  const direct = selected ? graph.directOf(selected) : null;
  const deep = deepFor(graph, state);

  const heights: Record<string, number> = {};
  if (focus && card) heights[focus] = card.height;
  if (direct) {
    for (const tableId of Object.keys(direct.cross)) {
      const n = direct.cross[tableId].length;
      heights[tableId] =
        CARD_HEIGHT + (n > MAX_MINI_ROWS ? MAX_MINI_ROWS + 1 : n) * MINI_ROW_HEIGHT + 8;
    }
  }
  const placed = placeCards(base, heights, focus);
  const P = placed.positions;
  const widthOf = (id: string) => (id === focus ? EXPANDED_WIDTH : CARD_WIDTH);

  const keep = focus && !deep ? graph.neighborTables(focus) : new Set(focus ? [focus] : []);
  if (deep) {
    for (const d of [ErdDirection.Up, ErdDirection.Down])
      Object.keys(deep[d].byTable).forEach((k) => keep.add(k));
  }

  const anchors: Record<string, IErdPoint> = {};
  const rowCenter: Record<string, number> = {};
  const edges: IErdSceneEdge[] = [];

  graph.pairs.forEach((pair, i) => {
    const touchesFocus = Boolean(focus) && (pair.a === focus || pair.b === focus);
    // the focused card draws its links row by row; conditional-only relations keep the table line
    if (touchesFocus && pair.links.length) return;
    const A = P[pair.a];
    const B = P[pair.b];
    if (!A || !B) return;
    let cubic: ICubic;
    let start: string;
    let end: string;
    if (Math.abs(B.x - A.x) > CARD_WIDTH / 2) {
      [start, end] = A.x <= B.x ? [pair.a, pair.b] : [pair.b, pair.a];
      const [s, t] = [P[start], P[end]];
      const [x1, y1, x2, y2] = [
        s.x + widthOf(start),
        s.y + CARD_HEIGHT / 2,
        t.x,
        t.y + CARD_HEIGHT / 2,
      ];
      const c = Math.max(40, Math.abs(x2 - x1) / 2);
      cubic = [
        [x1, y1],
        [x1 + c, y1],
        [x2 - c, y2],
        [x2, y2],
      ];
    } else {
      [start, end] = A.y <= B.y ? [pair.a, pair.b] : [pair.b, pair.a];
      const [u, v] = [P[start], P[end]];
      const bottom = u.y + (heights[start] ?? CARD_HEIGHT);
      const c = Math.max(30, (v.y - bottom) / 2);
      const ux = u.x + widthOf(start) / 2;
      const vx = v.x + widthOf(end) / 2;
      cubic = [
        [ux, bottom],
        [ux, bottom + c],
        [vx, v.y - c],
        [vx, v.y],
      ];
    }
    const flow = flowAlong(pair, start);
    edges.push({
      id: `pair:${i}`,
      source: pair.a,
      target: pair.b,
      path: cubicPath(cubic),
      kind: ErdEdgeKind.Table,
      strokeWidth: 1.3 + pair.links.length * 0.6,
      dim: Boolean(focus) && !touchesFocus,
      pairIndex: i,
      ends: pair.links.length ? [cardinalityAt(pair, start), cardinalityAt(pair, end)] : undefined,
      flow,
      tables: [start, end],
      arrows: flowArrows(cubic, flow),
      fieldKind: pair.flowKind ?? ErdFieldKind.Link,
    });
  });

  const cards: IErdCard[] = graph.tables.map((table) => {
    const p = P[table.id];
    const isFocus = table.id === focus;
    anchors[`t:${table.id}`] = { x: p.x, y: p.y };
    const up = deep && !isFocus ? (deep[ErdDirection.Up].byTable[table.id] ?? 0) : 0;
    const down = deep && !isFocus ? (deep[ErdDirection.Down].byTable[table.id] ?? 0) : 0;
    const rows = isFocus && card ? card.rows : [];
    for (const row of rows) {
      const id = row.field?.id;
      const cy = p.y + row.y + row.height / 2;
      if (id) {
        rowCenter[id] = cy;
        anchors[`f:${id}`] = { x: p.x + 24, y: cy };
      }
      if (row.kind === ErdRowKind.RestHead) anchors.rest = { x: p.x + 24, y: cy };
    }
    const crossList = direct?.cross[table.id] ?? [];
    const mini = isFocus
      ? []
      : crossList
          .slice()
          .sort((a, b) =>
            a.direction === b.direction ? 0 : a.direction === ErdDirection.Up ? -1 : 1
          )
          .slice(0, MAX_MINI_ROWS)
          .map(({ id, direction, kind }) => ({ id, direction, kind }));
    mini.forEach((row, i) => {
      anchors[`f:${row.id}`] = {
        x: p.x + 10,
        y: p.y + CARD_HEIGHT + 4 + i * MINI_ROW_HEIGHT + MINI_ROW_HEIGHT / 2,
      };
    });
    return {
      id: table.id,
      x: p.x,
      y: p.y,
      width: widthOf(table.id),
      height: heights[table.id] ?? CARD_HEIGHT,
      expanded: isFocus,
      rows,
      mini,
      miniMore: isFocus ? 0 : Math.max(0, crossList.length - MAX_MINI_ROWS),
      dim: Boolean(focus) && !keep.has(table.id),
      up,
      down,
    };
  });

  if (focus && card) {
    const me = P[focus];
    for (const row of card.rows) {
      const y = me.y + row.y + row.height / 2;
      let other: string | undefined;
      let action: IErdSceneEdge['action'];
      let carried: ReturnType<typeof linkRowFlow> | undefined;
      if (row.kind === ErdRowKind.Link && row.group?.link) {
        other = graph.otherTable(focus, row.group.link);
        action = { type: ErdAction.SelectField, id: row.group.field.id };
        carried = linkRowFlow(graph, row.group.link, row.group.field.id);
      } else if (row.kind === ErdRowKind.Incoming && row.link) {
        other = row.link.tableA;
        action = { type: ErdAction.FocusTable, id: row.link.tableA };
        carried = linkRowFlow(graph, row.link);
      }
      if (!other || !P[other] || !carried) continue;
      const cubic = betweenCubic(
        { x: me.x, w: EXPANDED_WIDTH, y },
        { x: P[other].x, w: widthOf(other), y: P[other].y + CARD_HEIGHT / 2 }
      );
      edges.push({
        id: `row:${row.kind}:${row.field?.id ?? row.link?.fieldA}`,
        source: focus,
        target: other,
        path: cubicPath(cubic),
        kind: ErdEdgeKind.Field,
        fieldKind: carried.kind,
        flow: carried.flow,
        arrows: flowArrows(cubic, carried.flow),
        strokeWidth: 1.4,
        dim: Boolean(direct),
        action,
      });
    }
  }

  if (focus && selected && direct && rowCenter[selected] !== undefined) {
    const me = P[focus];
    const sy = rowCenter[selected];
    direct.same.forEach(({ direction, kind }, id) => {
      const ry = rowCenter[id];
      if (ry === undefined) return;
      const k = Math.min(70, 24 + Math.abs(ry - sy) / 6);
      const [y1, y2] = direction === ErdDirection.Up ? [ry, sy] : [sy, ry];
      edges.push({
        id: `rel:${id}`,
        source: focus,
        target: focus,
        path: `M${me.x},${y1} C${me.x - k},${y1} ${me.x - k},${y2} ${me.x},${y2}`,
        kind: ErdEdgeKind.Relation,
        direction,
        fieldKind: kind,
        strokeWidth: 1.6,
        dim: false,
        action: { type: ErdAction.JumpField, id },
      });
    });
    for (const c of cards) {
      c.mini.forEach((row) => {
        const a = { x: me.x, w: EXPANDED_WIDTH, y: sy };
        const b = { x: c.x, w: CARD_WIDTH, y: anchors[`f:${row.id}`].y };
        edges.push({
          id: `rel:${row.id}`,
          source: focus,
          target: c.id,
          path: row.direction === ErdDirection.Up ? between(b, a) : between(a, b),
          kind: ErdEdgeKind.Relation,
          direction: row.direction,
          fieldKind: row.kind,
          strokeWidth: 1.6,
          dim: false,
          action: { type: ErdAction.JumpField, id: row.id },
        });
      });
    }
  }

  return {
    cards,
    edges,
    anchors,
    positions: P,
    width: placed.width,
    height: placed.height,
  };
};

/** lines between the tables data passes through on a route, drawn over a built scene */
export const buildRouteEdges = (
  graph: ErdGraph,
  scene: IErdScene,
  focus: string | null,
  selected: string,
  route: IErdRoute
): IErdSceneEdge[] => {
  const P = scene.positions;
  const box = (t: string) => ({
    x: P[t].x,
    w: t === focus ? EXPANDED_WIDTH : CARD_WIDTH,
    y: P[t].y + HEAD_HEIGHT / 2,
  });
  return routeEdges(graph, selected, route)
    .filter(({ a, b }) => P[a] && P[b])
    .map(({ a, b, n }) => ({
      id: `route:${a}:${b}`,
      source: a,
      target: b,
      path: between(box(a), box(b)),
      kind: ErdEdgeKind.Route,
      direction: route.direction,
      strokeWidth: 1.6 + Math.log2(n + 1),
      dim: false,
    }));
};

/**
 * The tables data passes through on its way to one affected table, or up the
 * longest chain from one dependency; `n` counts the fields reached in `b`.
 */
export const routeEdges = (graph: ErdGraph, selected: string, route: IErdRoute) => {
  const deep = graph.deepOf(selected);
  const fieldEdges: [string, string][] = [];
  if (route.direction === ErdDirection.Down) {
    const levels = deep[ErdDirection.Down].levels;
    const seen = new Set<string>();
    const queue: string[] = [];
    levels.forEach((_, id) => {
      if (graph.tableOf(id) === route.tableId) {
        seen.add(id);
        queue.push(id);
      }
    });
    while (queue.length) {
      const id = queue.shift()!;
      // every path from the selected field, not only the shortest ones
      for (const ref of graph.upOf(id)) {
        if (ref.id !== selected && !levels.has(ref.id)) continue;
        fieldEdges.push([ref.id, id]);
        if (ref.id !== selected && !seen.has(ref.id)) {
          seen.add(ref.id);
          queue.push(ref.id);
        }
      }
    }
  } else {
    const path = graph.sourcePath(route.fieldId).concat(selected);
    for (let i = 0; i + 1 < path.length; i++) fieldEdges.push([path[i], path[i + 1]]);
  }
  const acc = new Map<string, { a: string; b: string; fields: Set<string> }>();
  for (const [from, to] of fieldEdges) {
    const a = graph.tableOf(from)!;
    const b = graph.tableOf(to)!;
    if (a === b) continue;
    const key = `${a}|${b}`;
    if (!acc.has(key)) acc.set(key, { a, b, fields: new Set() });
    acc.get(key)!.fields.add(to);
  }
  return [...acc.values()].map((x) => ({ a: x.a, b: x.b, n: x.fields.size }));
};
