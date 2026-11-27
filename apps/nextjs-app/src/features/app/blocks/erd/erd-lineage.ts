import type { ErdGraph } from './erd-graph';
import { ErdDirection } from './erd-graph';

export enum ErdLineageNodeKind {
  Field = 'field',
  Table = 'table',
  More = 'more',
}

/** in layers with more fields than this, tables with several fields start collapsed */
const MERGE_AT = 12;
const MAX_TABLES = 14;
const COLUMN_GAP = 40;
const CARD_GAP = 8;
const LINEAGE_HEADER_HEIGHT = 36;

export interface IErdLineageNode {
  index: number;
  kind: ErdLineageNodeKind;
  id?: string;
  tableId?: string;
  /** fields the node stands for: a row's own field, or every field of a collapsed card */
  members: string[];
  /** key the node toggles when clicked */
  expandKey?: string;
  /** key whose toggle produced the node, to keep it in place */
  from?: string;
  /** the card the node belongs to */
  card: string;
  /** a card's header with its rows shown below it */
  open?: boolean;
  /** fields of the table in this layer, on its header */
  fields?: number;
  self?: boolean;
  /** tables folded into a "more" node */
  tables?: number;
  x: number;
  y: number;
  h: number;
  column: IErdLineageColumn;
  parents: IErdLineageNode[];
}

export interface IErdLineageColumn {
  key: string;
  direction?: ErdDirection;
  depth: number;
  self?: boolean;
  count: number;
  nodes: IErdLineageNode[];
}

export interface IErdLineageEdge {
  from: IErdLineageNode;
  to: IErdLineageNode;
  direction: ErdDirection;
}

/** a table of one layer: a header, and its fields as rows while open */
export interface IErdLineageCard {
  key: string;
  x: number;
  y: number;
  height: number;
  more?: boolean;
}

export interface IErdLineageLayout {
  columns: IErdLineageColumn[];
  nodes: IErdLineageNode[];
  cards: IErdLineageCard[];
  /** drawn: each node to its parents in the previous layer */
  edges: IErdLineageEdge[];
  /** every dependency between two nodes as [from, to] indexes, also within a layer */
  links: [number, number][];
  nodeWidth: number;
  width: number;
  height: number;
  headerHeight: number;
}

/** every dependency between two nodes as [from, to] indexes, also within a layer */
const linksOf = (graph: ErdGraph, nodes: IErdLineageNode[]) => {
  const owner = new Map<string, IErdLineageNode>();
  nodes.forEach((n) => n.members.forEach((m) => owner.set(m, n)));
  const seen = new Set<string>();
  const links: [number, number][] = [];
  for (const n of nodes) {
    for (const m of n.members) {
      for (const ref of graph.upOf(m)) {
        const p = owner.get(ref.id);
        if (!p || p === n || seen.has(`${p.index}>${n.index}`)) continue;
        seen.add(`${p.index}>${n.index}`);
        links.push([p.index, n.index]);
      }
    }
  }
  return links;
};

interface ICardSpec {
  key: string;
  tableId?: string;
  ids: string[];
  open: boolean;
  toggle: boolean;
  from?: string;
  more?: number;
}

const average = (values: number[]) =>
  values.length ? values.reduce((s, v) => s + v, 0) / values.length : 1e9;

/**
 * A layer's tables as cards, ordered by where their fields' parents sit in the previous layer.
 * The order depends only on the previous layer's order, never on which cards are open, so
 * opening or closing a card leaves the others where they are.
 */
const layerCards = (
  graph: ErdGraph,
  key: string,
  ids: string[],
  toggled: ReadonlySet<string>,
  rankOf: (id: string) => number
): ICardSpec[] => {
  const rankByParents = (fields: string[]) =>
    average(
      [...new Set(fields.flatMap((id) => graph.upOf(id).map((ref) => rankOf(ref.id))))].filter(
        (r) => r < 1e9
      )
    );
  const byTable = new Map<string, string[]>();
  ids.forEach((id) => {
    const tableId = graph.tableOf(id)!;
    byTable.set(tableId, [...(byTable.get(tableId) ?? []), id]);
  });
  const collapse = ids.length > MERGE_AT;
  const tables = [...byTable.entries()]
    .map(([tableId, fields]) => {
      const tableKey = `${key}|${tableId}`;
      const toggle = fields.length > 1;
      const sorted = fields
        .map((id) => [id, rankByParents([id])] as const)
        .sort((a, b) => a[1] - b[1])
        .map(([id]) => id);
      return {
        spec: {
          key: tableKey,
          tableId,
          ids: sorted,
          toggle,
          open: !toggle || collapse === toggled.has(tableKey),
        } as ICardSpec,
        order: rankByParents(fields),
      };
    })
    // the largest tables stay in view; past MAX_TABLES the rest fold into one card
    .sort((a, b) => b.spec.ids.length - a.spec.ids.length);
  const byOrder = (list: typeof tables) =>
    list.sort((a, b) => a.order - b.order).map((t) => t.spec);
  if (!collapse || tables.length <= MAX_TABLES) return byOrder(tables);
  const moreKey = `${key}|more`;
  const head = byOrder(tables.slice(0, MAX_TABLES - 1));
  const rest = byOrder(tables.slice(MAX_TABLES - 1));
  if (toggled.has(moreKey)) {
    // revealed tables take the place of the card that folded them
    rest[0].from = moreKey;
    return [...head, ...rest];
  }
  const members = rest.flatMap((c) => c.ids);
  return [...head, { key: moreKey, ids: members, open: false, toggle: true, more: rest.length }];
};

export const buildLineage = (
  graph: ErdGraph,
  fieldId: string,
  toggled: ReadonlySet<string>,
  availableWidth: number
): IErdLineageLayout => {
  const deep = graph.deepOf(fieldId);
  const layersOf = (direction: ErdDirection) => {
    const layers: string[][] = [];
    deep[direction].levels.forEach((level, id) => (layers[level.depth] ??= []).push(id));
    return layers;
  };
  const up = layersOf(ErdDirection.Up);
  const down = layersOf(ErdDirection.Down);
  const specs: { key: string; direction?: ErdDirection; depth: number; ids: string[] }[] = [];
  for (let d = up.length - 1; d >= 1; d--)
    if (up[d])
      specs.push({
        key: `${ErdDirection.Up}:${d}`,
        direction: ErdDirection.Up,
        depth: d,
        ids: up[d],
      });
  specs.push({ key: 'self', depth: 0, ids: [fieldId] });
  for (let d = 1; d < down.length; d++)
    if (down[d])
      specs.push({
        key: `${ErdDirection.Down}:${d}`,
        direction: ErdDirection.Down,
        depth: d,
        ids: down[d],
      });

  // each field's place in its layer: card index, then row within the card
  let rank = new Map<string, number>();
  const layerSpecs = specs.map((spec) => {
    const previous = rank;
    const cards =
      spec.key === 'self'
        ? [
            {
              key: `self|${graph.tableOf(fieldId)}`,
              tableId: graph.tableOf(fieldId),
              ids: [fieldId],
              open: true,
              toggle: false,
            },
          ]
        : layerCards(graph, spec.key, spec.ids, toggled, (id) => previous.get(id) ?? 1e9);
    rank = new Map();
    cards.forEach((c, i) => c.ids.forEach((id, j) => rank.set(id, i + j / 1000)));
    return { spec, cards };
  });

  const bodyWidth = Math.max(400, availableWidth - 40);
  // the layers share the width
  const across = layerSpecs.length;
  const nodeWidth = Math.round(
    Math.max(124, Math.min(184, (bodyWidth - 40 - (across - 1) * COLUMN_GAP) / across))
  );
  const rowHeight = 28;
  const headHeight = rowHeight;

  const nodes: IErdLineageNode[] = [];
  const edges: IErdLineageEdge[] = [];
  const cardBoxes: IErdLineageCard[] = [];
  let previous: IErdLineageColumn | null = null;
  const layerTop = 12;
  let bottom = 0;
  const columns = layerSpecs.map(({ spec, cards }, ci) => {
    const column: IErdLineageColumn = {
      key: spec.key,
      direction: spec.direction,
      depth: spec.depth,
      self: spec.key === 'self' || undefined,
      count: spec.ids.length,
      nodes: [],
    };
    const where = new Map<string, IErdLineageNode>();
    previous?.nodes.forEach((n) => n.members.forEach((m) => where.set(m, n)));
    const x = 20 + ci * (nodeWidth + COLUMN_GAP);
    let y = layerTop;
    cards.forEach((c) => {
      const top = y;
      const add = (
        n: Omit<IErdLineageNode, 'index' | 'x' | 'y' | 'column' | 'parents' | 'card'>
      ) => {
        const node = {
          ...n,
          card: c.key,
          index: nodes.length,
          x,
          y,
          column,
          parents: [],
        } as IErdLineageNode;
        const parents = new Set<IErdLineageNode>();
        node.members.forEach((m) =>
          graph.upOf(m).forEach((ref) => {
            const p = where.get(ref.id);
            if (p) parents.add(p);
          })
        );
        node.parents = [...parents];
        const direction = column.self ? ErdDirection.Up : column.direction!;
        node.parents.forEach((p) => edges.push({ from: p, to: node, direction }));
        nodes.push(node);
        column.nodes.push(node);
        y += node.h;
      };
      if (c.more !== undefined) {
        add({
          kind: ErdLineageNodeKind.More,
          members: c.ids,
          expandKey: c.key,
          tables: c.more,
          h: headHeight,
        });
      } else {
        add({
          kind: ErdLineageNodeKind.Table,
          tableId: c.tableId,
          members: c.open ? [] : c.ids,
          expandKey: c.toggle ? c.key : undefined,
          from: c.from ?? c.key,
          open: c.open || undefined,
          fields: c.ids.length,
          h: headHeight,
        });
        if (c.open)
          c.ids.forEach((id) =>
            add({
              kind: ErdLineageNodeKind.Field,
              id,
              members: [id],
              from: c.from ?? c.key,
              self: column.self && id === fieldId,
              h: rowHeight,
            })
          );
      }
      cardBoxes.push({
        key: c.key,
        x,
        y: top,
        height: y - top,
        more: c.more !== undefined || undefined,
      });
      bottom = Math.max(bottom, y);
      y += CARD_GAP;
    });
    previous = column;
    return column;
  });

  return {
    columns,
    nodes,
    cards: cardBoxes,
    edges,
    links: linksOf(graph, nodes),
    nodeWidth,
    width: 20 + across * (nodeWidth + COLUMN_GAP) - COLUMN_GAP + 20,
    height: bottom + 20,
    headerHeight: LINEAGE_HEADER_HEIGHT,
  };
};

/** a node, everything upstream of it and everything downstream of it; sibling branches are left out */
export const lineageReach = (layout: IErdLineageLayout, index: number) => {
  const parents = layout.nodes.map(() => [] as number[]);
  const children = layout.nodes.map(() => [] as number[]);
  layout.links.forEach(([from, to]) => {
    parents[to].push(from);
    children[from].push(to);
  });
  const spread = (next: number[][]) => {
    const seen = new Set([index]);
    const queue = [index];
    while (queue.length) {
      for (const j of next[queue.shift()!]) {
        if (!seen.has(j)) {
          seen.add(j);
          queue.push(j);
        }
      }
    }
    return seen;
  };
  const up = spread(parents);
  const down = spread(children);
  const edgeOn = (e: IErdLineageEdge) =>
    (up.has(e.from.index) && up.has(e.to.index)) ||
    (down.has(e.from.index) && down.has(e.to.index));
  return { nodes: new Set([...up, ...down]), edgeOn };
};
