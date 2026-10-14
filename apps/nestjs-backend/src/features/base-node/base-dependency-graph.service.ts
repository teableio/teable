import { Injectable } from '@nestjs/common';
import { FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { BaseNodeResourceType } from '@teable/openapi';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';

/** `${resourceType}_${resourceId}` — stable across every edge source. */
export type INodeKey = string;

export const nodeKey = (resourceType: BaseNodeResourceType, resourceId: string): INodeKey =>
  `${resourceType}_${resourceId}`;

export const parseNodeKey = (key: INodeKey) => {
  const separator = key.indexOf('_');
  return {
    resourceType: key.slice(0, separator) as BaseNodeResourceType,
    resourceId: key.slice(separator + 1),
  };
};

/**
 * 'reference': one side names the other by id, so pulling them apart can break
 * it at run time. 'link': a link field joins two tables and keeps working
 * across projects — the connection survives, it just stops being local.
 *
 * A table never names anything, so it is only ever the far end of a reference:
 * whatever breaks when a pair is split is the automation, app or dashboard on
 * the near end, never the table itself.
 */
export type IDependencyKind = 'reference' | 'link';

/**
 * Which side of a reference a node sits on, seen from whatever reached it.
 * 'dependent' names the other by id, so it is the one that stops working;
 * 'dependency' is merely named, and is itself unharmed by the separation.
 */
export type IDependencyRole = 'dependent' | 'dependency';

/** `from` names `to` by id: the arrow points from the one that breaks. */
export interface IDependencyEdge {
  from: INodeKey;
  to: INodeKey;
  kind: IDependencyKind;
  /** the reference was inferred rather than read from a column */
  uncertain?: boolean;
}

/** An edge as stored on one endpoint, keeping which way the original ran. */
interface IStoredEdge extends IDependencyEdge {
  /** what the far side is to the near one */
  role: IDependencyRole;
}

export interface IDependencyNeighbour {
  key: INodeKey;
  kind: IDependencyKind;
  /**
   * What this node is to the ones that reached it. Separating a pair always
   * breaks the dependent and never the dependency, so this decides who a
   * warning is actually about.
   */
  role: IDependencyRole;
  uncertain: boolean;
  /** hops from the starting set; 1 is an immediate neighbour */
  depth: number;
  /** keys on the near side of the edge that reached it */
  reachedFrom: INodeKey[];
}

/**
 * Everything in one project that depends on anything else in it.
 *
 * Built once and then walked in memory. That split is the point: working out
 * which nodes a move disturbs is graph traversal, and doing it against the
 * database one ring at a time means a round trip per ring and a different
 * query for every kind of edge. Here the edges are collected by a fixed set of
 * indexed queries — the count does not grow with the graph — and every
 * question after that is answered by a BFS.
 */
export class BaseDependencyGraph {
  /** walked both ways, but each copy remembers which way the reference ran */
  private readonly adjacency = new Map<INodeKey, IStoredEdge[]>();

  constructor(edges: IDependencyEdge[]) {
    for (const edge of edges) {
      if (edge.from === edge.to) continue;
      // standing on the dependent, the far side is what it depends on
      this.connect(edge.from, { ...edge, role: 'dependency' });
      this.connect(edge.to, { ...edge, from: edge.to, to: edge.from, role: 'dependent' });
    }
  }

  private connect(key: INodeKey, edge: IStoredEdge) {
    const list = this.adjacency.get(key);
    if (list) {
      // a pair joined twice keeps the stronger claim
      const existing = list.find((item) => item.to === edge.to);
      if (existing) {
        // A link says nothing about direction or certainty — it is symmetric,
        // and a two-way link field is stored as a row on each side, so both
        // directions arrive here for every ordinary link. Letting that count as
        // "they name each other" would mark every linked table as the thing
        // that breaks, which a table never is.
        if (edge.kind !== 'reference') return;
        const wasReference = existing.kind === 'reference';
        existing.kind = 'reference';
        if (!wasReference) {
          existing.role = edge.role;
          existing.uncertain = Boolean(edge.uncertain);
          return;
        }
        if (!edge.uncertain) existing.uncertain = false;
        // named by each other: the near side breaks too, and that is the
        // stronger thing to say about the far one
        if (edge.role === 'dependent') existing.role = 'dependent';
        return;
      }
      list.push({ ...edge });
      return;
    }
    this.adjacency.set(key, [{ ...edge }]);
  }

  /**
   * Nodes connected to `start` but not in it.
   *
   * `referenceDepth` is how far to follow edges that break: the whole chain is
   * worth showing, because every hop along it is something that stops working.
   *
   * Link edges bound the walk instead of extending it. One is followed out of
   * anything that travels — the starting set and every reference reached from
   * it — and there it stops. A linked table is never moved, so nothing behind
   * it can be orphaned and nothing behind it is worth walking; and its closure
   * in a well-modelled project is the entire project anyway.
   */
  search(start: Iterable<INodeKey>, options?: { referenceDepth?: number }): IDependencyNeighbour[] {
    const maxReferenceDepth = options?.referenceDepth ?? Number.POSITIVE_INFINITY;
    const inStart = new Set(start);
    const found = new Map<INodeKey, IDependencyNeighbour>();
    let frontier = [...inStart];
    let depth = 0;

    while (frontier.length > 0) {
      depth += 1;
      frontier = this.expand({ frontier, inStart, found, depth, maxReferenceDepth });
    }
    return [...found.values()].sort(
      (a, b) => a.depth - b.depth || Number(b.kind === 'reference') - Number(a.kind === 'reference')
    );
  }

  /** One ring outwards; returns the keys whose own edges are still worth walking. */
  private expand(input: {
    frontier: INodeKey[];
    inStart: Set<INodeKey>;
    found: Map<INodeKey, IDependencyNeighbour>;
    depth: number;
    maxReferenceDepth: number;
  }): INodeKey[] {
    const { frontier, inStart, found, depth, maxReferenceDepth } = input;
    const next: INodeKey[] = [];
    for (const key of frontier) {
      for (const edge of this.adjacency.get(key) ?? []) {
        if (inStart.has(edge.to)) continue;
        if (this.record(found, edge, key, depth) && depth < maxReferenceDepth) {
          next.push(edge.to);
        }
      }
    }
    return next;
  }

  /** Notes the edge's far side; true when the chain is worth following further. */
  private record(
    found: Map<INodeKey, IDependencyNeighbour>,
    edge: IStoredEdge,
    from: INodeKey,
    depth: number
  ): boolean {
    const seen = found.get(edge.to);
    if (!seen) {
      found.set(edge.to, {
        key: edge.to,
        kind: edge.kind,
        // a link is symmetric, so the far side is nobody's dependent
        role: edge.kind === 'reference' ? edge.role : 'dependency',
        uncertain: Boolean(edge.uncertain),
        depth,
        reachedFrom: [from],
      });
      // only a breaking chain keeps going
      return edge.kind === 'reference';
    }
    return this.merge(seen, edge, from, depth);
  }

  /**
   * Folds another way of reaching an already-found node into what is known
   * about it. Returns true only for the one case that is genuinely new: it was
   * thought merely linked and turns out to be named outright, so its own chain
   * has to be walked after all.
   */
  private merge(
    seen: IDependencyNeighbour,
    edge: IStoredEdge,
    from: INodeKey,
    depth: number
  ): boolean {
    // reaching it again over a link adds nothing: a link decides neither who
    // breaks nor how sure we are, so it must not touch what a reference said
    if (edge.kind !== 'reference') {
      if (!seen.reachedFrom.includes(from)) seen.reachedFrom.push(from);
      return false;
    }
    if (seen.kind !== 'reference') {
      // the link's evidence is discarded wholesale — depth included, so this
      // node's own children are numbered from where the reference found it
      seen.kind = 'reference';
      seen.role = edge.role;
      seen.uncertain = Boolean(edge.uncertain);
      seen.depth = depth;
      seen.reachedFrom = [from];
      return true;
    }
    // A later ring reaching it again is a back edge: it runs away from the
    // move, not towards it, so it explains nothing about why this node is
    // affected. Merging it would relabel the node on unrelated evidence — a
    // workflow found through a guess in its script would be called certain
    // because it also names some other table outright.
    if (depth > seen.depth) return false;
    if (!edge.uncertain) seen.uncertain = false;
    if (edge.role === 'dependent') seen.role = 'dependent';
    if (!seen.reachedFrom.includes(from)) seen.reachedFrom.push(from);
    return false;
  }
}

/**
 * Table ids appearing anywhere in a blob of text, deduplicated.
 *
 * Shared because three kinds of dependency exist only as text — a dashboard
 * plugin's stored settings, a workflow script's source, a routine's prompt —
 * and they must all agree on what an id looks like.
 */
export const TABLE_ID_PATTERN = /tbl[A-Za-z0-9]{16}/g;

export const extractTableIds = (text: string | null | undefined): Set<string> => {
  const found = new Set<string>();
  if (!text) return found;
  for (const match of text.matchAll(TABLE_ID_PATTERN)) found.add(match[0]);
  return found;
};

type ILinkFieldRow = {
  tableId: string;
  foreignTableId: string | null;
  lookupForeignTableId: string | null;
};

/**
 * Collects the edges of one project. Community knows about tables joined by
 * link fields and about dashboards whose plugins name a table; the enterprise
 * edition adds workflows, apps and routines through {@link collectExtraEdges}.
 */
@Injectable()
export class BaseDependencyGraphService {
  constructor(
    protected readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') protected readonly knex: Knex
  ) {}

  async build(baseId: string): Promise<BaseDependencyGraph> {
    const tableIds = await this.getTableIds(baseId);
    const [linkEdges, dashboardEdges, extraEdges] = await Promise.all([
      this.collectLinkEdges(tableIds),
      this.collectDashboardEdges(baseId, tableIds),
      this.collectExtraEdges(baseId, tableIds),
    ]);
    return new BaseDependencyGraph([...linkEdges, ...dashboardEdges, ...extraEdges]);
  }

  protected async getTableIds(baseId: string): Promise<string[]> {
    const tables = await this.prismaService.txClient().tableMeta.findMany({
      where: { baseId, deletedTime: null },
      select: { id: true },
    });
    return tables.map((table) => table.id);
  }

  /** Table-to-table joins, both directions, restricted to this project. */
  protected async collectLinkEdges(tableIds: string[]): Promise<IDependencyEdge[]> {
    if (tableIds.length === 0) return [];
    const rows = await this.prismaService.txClient().$queryRawUnsafe<ILinkFieldRow[]>(
      this.knex('field')
        .select({
          tableId: 'table_id',
          foreignTableId: this.knex.raw(`options::json->>'foreignTableId'`),
          lookupForeignTableId: this.knex.raw(`lookup_options::json->>'foreignTableId'`),
        })
        .whereNull('deleted_time')
        .whereIn('table_id', tableIds)
        // only these two kinds can name a foreign table; without this every
        // field of the base is materialised and JSON-parsed to find a handful
        .where((qb) => qb.where('type', FieldType.Link).orWhere('is_lookup', true))
        .toQuery()
    );
    const known = new Set(tableIds);
    const edges: IDependencyEdge[] = [];
    for (const row of rows) {
      const foreign = row.lookupForeignTableId ?? row.foreignTableId;
      // links leaving the project are already cross-project; they change nothing
      if (!foreign || !known.has(foreign)) continue;
      edges.push({
        from: nodeKey(BaseNodeResourceType.Table, row.tableId),
        to: nodeKey(BaseNodeResourceType.Table, foreign),
        kind: 'link',
      });
    }
    return edges;
  }

  /**
   * A dashboard's plugins keep table ids inside opaque storage, so the only way
   * to find them is to read the ids out of the text. That makes every edge here
   * a guess: a stale id left behind by a removed filter reads exactly like a
   * live one, hence `uncertain`.
   */
  protected async collectDashboardEdges(
    baseId: string,
    tableIds: string[]
  ): Promise<IDependencyEdge[]> {
    if (tableIds.length === 0) return [];
    const prisma = this.prismaService.txClient();
    const dashboards = await prisma.dashboard.findMany({
      where: { baseId },
      select: { id: true },
    });
    if (dashboards.length === 0) return [];
    const installs = await prisma.pluginInstall.findMany({
      // only dashboard panels; view plugins name their table elsewhere
      where: { baseId, storage: { not: null }, positionId: { in: dashboards.map((d) => d.id) } },
      select: { positionId: true, storage: true },
    });
    const known = new Set(tableIds);
    const edges: IDependencyEdge[] = [];
    for (const install of installs) {
      // one pass over the storage rather than one substring search per table
      for (const found of extractTableIds(JSON.stringify(install.storage))) {
        if (!known.has(found)) continue;
        edges.push({
          from: nodeKey(BaseNodeResourceType.Dashboard, install.positionId),
          to: nodeKey(BaseNodeResourceType.Table, found),
          kind: 'reference',
          uncertain: true,
        });
      }
    }
    return edges;
  }

  /** Edition hook: workflows and apps live in the enterprise edition. */
  protected async collectExtraEdges(
    _baseId: string,
    _tableIds: string[]
  ): Promise<IDependencyEdge[]> {
    return [];
  }
}
