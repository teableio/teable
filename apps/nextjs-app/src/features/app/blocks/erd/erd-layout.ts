/* eslint-disable sonarjs/cognitive-complexity */
import dagre from '@dagrejs/dagre';
import type { ErdGraph } from './erd-graph';

export const CARD_WIDTH = 184;
export const CARD_HEIGHT = 52;
export const EXPANDED_WIDTH = 320;
const GAP = 14;
const RANK_SEP = 80;
const MARGIN = 20;
const ISOLATED_GAP = 50;

export interface IErdPoint {
  x: number;
  y: number;
}

export interface IErdBaseLayout {
  /** top-left corner of every table card in the collapsed layout */
  positions: Record<string, IErdPoint>;
  /** tables without links, in rows below the linked ones */
  isolated: string[];
  isolatedColumns: number;
  mainHeight: number;
  width: number;
}

/**
 * dagre ranks the linked tables from left to right; each rank is then stacked tightly,
 * keeping dagre's order, because long edges would otherwise leave tall gaps.
 */
export const computeBaseLayout = (graph: ErdGraph): IErdBaseLayout => {
  const linked = new Set(graph.pairs.flatMap((pair) => [pair.a, pair.b]));
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: GAP, ranksep: RANK_SEP, ranker: 'network-simplex' });
  g.setDefaultEdgeLabel(() => ({}));
  for (const table of graph.tables) {
    if (linked.has(table.id)) g.setNode(table.id, { width: CARD_WIDTH, height: CARD_HEIGHT });
  }
  for (const pair of graph.pairs) g.setEdge(pair.a, pair.b);
  dagre.layout(g);

  const ranks = new Map<number, [string, number][]>();
  for (const id of g.nodes()) {
    const node = g.node(id);
    if (!ranks.has(node.x)) ranks.set(node.x, []);
    ranks.get(node.x)!.push([id, node.y]);
  }
  const xs = [...ranks.keys()].sort((a, b) => a - b);
  const tallest = Math.max(0, ...[...ranks.values()].map((rank) => rank.length));
  const mainHeight = tallest ? tallest * (CARD_HEIGHT + GAP) - GAP : 0;
  const positions: Record<string, IErdPoint> = {};
  xs.forEach((x, rankIndex) => {
    const rank = ranks.get(x)!.sort((a, b) => a[1] - b[1]);
    const top = (mainHeight - (rank.length * (CARD_HEIGHT + GAP) - GAP)) / 2;
    rank.forEach(([id], i) => {
      positions[id] = {
        x: MARGIN + rankIndex * (CARD_WIDTH + RANK_SEP),
        y: Math.round(MARGIN + top + i * (CARD_HEIGHT + GAP)),
      };
    });
  });
  const mainWidth = xs.length ? xs.length * (CARD_WIDTH + RANK_SEP) - RANK_SEP : 0;
  const isolated = graph.tables.filter((t) => !linked.has(t.id)).map((t) => t.id);
  const isolatedColumns = Math.max(6, Math.floor((mainWidth + GAP) / (CARD_WIDTH + GAP)));
  return {
    positions,
    isolated,
    isolatedColumns,
    mainHeight: tallest ? MARGIN + mainHeight : 0,
    width:
      MARGIN * 2 +
      Math.max(mainWidth, Math.min(isolated.length, isolatedColumns) * (CARD_WIDTH + GAP)),
  };
};

interface IErdPlacement {
  positions: Record<string, IErdPoint>;
  width: number;
  height: number;
}

/**
 * Cards that grow push the tables below them in the same column down;
 * the expanded card is wider, so the columns to its right move right.
 */
export const placeCards = (
  base: IErdBaseLayout,
  heights: Record<string, number>,
  focus: string | null
): IErdPlacement => {
  const positions: Record<string, IErdPoint> = {};
  const extraWidth = EXPANDED_WIDTH - CARD_WIDTH;
  const focusPoint = focus ? base.positions[focus] : undefined;
  const columns = new Map<number, string[]>();
  for (const id of Object.keys(base.positions)) {
    const x = base.positions[id].x;
    if (!columns.has(x)) columns.set(x, []);
    columns.get(x)!.push(id);
  }
  let bottom = 0;
  let right = 0;
  for (const ids of columns.values()) {
    ids.sort((a, b) => base.positions[a].y - base.positions[b].y);
    let extra = 0;
    for (const id of ids) {
      const p = base.positions[id];
      const x = p.x + (focusPoint && p.x > focusPoint.x ? extraWidth : 0);
      positions[id] = { x, y: p.y + extra };
      const h = heights[id] ?? CARD_HEIGHT;
      extra += h - CARD_HEIGHT;
      bottom = Math.max(bottom, positions[id].y + h);
      right = Math.max(right, x + (id === focus ? EXPANDED_WIDTH : CARD_WIDTH));
    }
  }

  const isolatedTop = base.mainHeight ? Math.max(base.mainHeight, bottom) + ISOLATED_GAP : MARGIN;
  let rowTop = isolatedTop;
  for (let start = 0; start < base.isolated.length; start += base.isolatedColumns) {
    const row = base.isolated.slice(start, start + base.isolatedColumns);
    const focusIndex = focus ? row.indexOf(focus) : -1;
    let rowHeight = CARD_HEIGHT;
    row.forEach((id, i) => {
      const x =
        MARGIN + i * (CARD_WIDTH + GAP) + (focusIndex >= 0 && i > focusIndex ? extraWidth : 0);
      positions[id] = { x, y: rowTop };
      rowHeight = Math.max(rowHeight, heights[id] ?? CARD_HEIGHT);
      right = Math.max(right, x + (id === focus ? EXPANDED_WIDTH : CARD_WIDTH));
    });
    rowTop += rowHeight + GAP;
    bottom = Math.max(bottom, rowTop - GAP);
  }
  return { positions, width: right + MARGIN, height: bottom + MARGIN };
};
