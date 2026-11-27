/* eslint-disable sonarjs/cognitive-complexity */
import { FieldType, RelationshipRevert } from '@teable/core';
import type { Relationship } from '@teable/core';
import type { IBaseErdTableNode, IBaseErdVo } from '@teable/openapi';

export enum ErdFieldKind {
  Link = 'link',
  Lookup = 'lookup',
  Rollup = 'rollup',
  Formula = 'formula',
  Other = 'other',
}

export enum ErdDirection {
  Up = 'up',
  Down = 'down',
}

export const ERD_FIELD_KINDS = [
  ErdFieldKind.Link,
  ErdFieldKind.Lookup,
  ErdFieldKind.Rollup,
  ErdFieldKind.Formula,
  ErdFieldKind.Other,
];

export type IErdField = IBaseErdTableNode['fields'][number] & { tableId: string };

export interface IErdTable {
  id: string;
  name: string;
  icon?: string;
  crossBaseId?: string;
  crossBaseName?: string;
  fields: IErdField[];
}

export interface IErdLink {
  /** table that owns `fieldA` */
  tableA: string;
  fieldA: string;
  tableB: string;
  /** symmetric link field in `tableB`; missing for one-way links */
  fieldB?: string;
  /** relationship seen from `tableA` */
  relationship: Relationship;
}

export interface IErdPair {
  a: string;
  b: string;
  /** empty when the tables only meet through conditional lookups or rollups */
  links: IErdLink[];
  /** `b` looks up or rolls up fields of `a` */
  flowAB: boolean;
  /** `a` looks up or rolls up fields of `b` */
  flowBA: boolean;
  /** rollup when any field rolls up across the pair, else lookup; none for a plain link */
  flowKind?: ErdFieldKind;
  /** fields of either table that look up or roll up the other one, conditional ones included */
  lookups: number;
  rollups: number;
}

interface IErdRef {
  id: string;
  kind: ErdFieldKind;
}

export interface IErdRelation {
  direction: ErdDirection;
  kind: ErdFieldKind;
}

export interface IErdWalk {
  /** field id -> depth (1 = direct) and how it is reached */
  levels: Map<string, { depth: number; kind: ErdFieldKind }>;
  /** table id -> number of fields reached in that table */
  byTable: Record<string, number>;
  depth: number;
}

interface IErdFieldStat {
  count: number;
  tables: number;
  depth: number;
}

export interface IErdGroup {
  field: IErdField;
  link?: IErdLink;
  via: IErdField[];
}

interface IErdGroups {
  groups: IErdGroup[];
  rest: IErdField[];
  incoming: IErdLink[];
}

export const getFieldKind = (field: Pick<IErdField, 'type' | 'isLookup'>): ErdFieldKind => {
  if (field.isLookup) return ErdFieldKind.Lookup;
  switch (field.type) {
    case FieldType.Link:
      return ErdFieldKind.Link;
    case FieldType.Rollup:
    case FieldType.ConditionalRollup:
      return ErdFieldKind.Rollup;
    case FieldType.Formula:
      return ErdFieldKind.Formula;
    default:
      return ErdFieldKind.Other;
  }
};

const refKindOf = (type: string, target?: IErdField): ErdFieldKind => {
  if (type === 'lookup') return ErdFieldKind.Lookup;
  if (target) return getFieldKind(target);
  return ErdFieldKind.Other;
};

const isLinkField = (field: IErdField) => field.type === FieldType.Link && !field.isLookup;

const usesLinkField = (field: IErdField) =>
  Boolean(field.lookupLinkedFieldId) && (field.isLookup || field.type === FieldType.Rollup);

export const countKinds = (fields: IErdField[]) => {
  const counts = {} as Record<ErdFieldKind, number>;
  for (const field of fields) {
    const kind = getFieldKind(field);
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return counts;
};

const emptyWalk = (): IErdWalk => ({ levels: new Map(), byTable: {}, depth: 0 });

export class ErdGraph {
  readonly tables: IErdTable[];
  readonly tableMap: Record<string, IErdTable> = {};
  readonly fieldMap: Record<string, IErdField> = {};
  readonly links: IErdLink[] = [];
  readonly pairs: IErdPair[] = [];
  /** table id -> indexes into `pairs` */
  readonly neighbors: Record<string, number[]> = {};
  /** tables linked to this one by a link field */
  linkedCount(tableId: string) {
    return (this.neighbors[tableId] ?? []).filter((i) => this.pairs[i].links.length).length;
  }
  private readonly linkByField: Record<string, IErdLink> = {};
  private readonly up: Record<string, IErdRef[]> = {};
  private readonly down: Record<string, IErdRef[]> = {};
  private readonly walkCache = new Map<string, IErdWalk>();
  private readonly statCache = new Map<string, Record<ErdDirection, IErdFieldStat>>();
  private readonly tableWalkCache = new Map<string, Record<ErdDirection, IErdWalk>>();
  private readonly heightMemo = new Map<string, { height: number; next?: string }>();
  private readonly groupsCache = new Map<string, IErdGroups>();

  constructor(vo: IBaseErdVo) {
    this.tables = vo.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      icon: node.icon,
      crossBaseId: node.crossBaseId,
      crossBaseName: node.crossBaseName,
      fields: node.fields.map((field) => ({ ...field, tableId: node.id })),
    }));
    for (const table of this.tables) {
      this.tableMap[table.id] = table;
      for (const field of table.fields) this.fieldMap[field.id] = field;
    }

    const addRef = (from: string, to: string, kind: ErdFieldKind) => {
      if (from === to || !this.fieldMap[from] || !this.fieldMap[to]) return;
      const ups = (this.up[to] ??= []);
      if (ups.some((ref) => ref.id === from)) return;
      ups.push({ id: from, kind });
      (this.down[from] ??= []).push({ id: to, kind });
    };

    for (const edge of vo.edges) {
      const { source, target } = edge;
      if (edge.relationship) {
        const link: IErdLink = {
          tableA: target.tableId,
          fieldA: target.fieldId,
          tableB: source.tableId,
          fieldB: edge.isOneWay ? undefined : source.fieldId,
          relationship: edge.relationship,
        };
        this.links.push(link);
        this.linkByField[link.fieldA] = link;
        if (link.fieldB) this.linkByField[link.fieldB] = link;
        // a one-way link edge starts at the foreign field it displays
        if (edge.isOneWay) addRef(source.fieldId, target.fieldId, ErdFieldKind.Link);
        continue;
      }
      addRef(source.fieldId, target.fieldId, refKindOf(edge.type, this.fieldMap[target.fieldId]));
    }
    // lookups and rollups also depend on the link field they go through
    for (const field of Object.values(this.fieldMap)) {
      if (usesLinkField(field)) addRef(field.lookupLinkedFieldId!, field.id, ErdFieldKind.Link);
    }

    const pairMap = new Map<string, IErdPair>();
    const pairOf = (x: string, y: string) => {
      const [a, b] = [x, y].sort();
      const key = `${a}|${b}`;
      if (!pairMap.has(key))
        pairMap.set(key, { a, b, links: [], flowAB: false, flowBA: false, lookups: 0, rollups: 0 });
      return pairMap.get(key)!;
    };
    for (const link of this.links) {
      if (link.tableA !== link.tableB) pairOf(link.tableA, link.tableB).links.push(link);
    }
    for (const [to, refs] of Object.entries(this.up)) {
      const toTable = this.tableOf(to);
      const counted = new Set<IErdPair>();
      for (const ref of refs) {
        if (ref.kind !== ErdFieldKind.Lookup && ref.kind !== ErdFieldKind.Rollup) continue;
        const fromTable = this.tableOf(ref.id);
        if (!fromTable || !toTable || fromTable === toTable) continue;
        const pair = pairOf(fromTable, toTable);
        if (pair.a === fromTable) pair.flowAB = true;
        else pair.flowBA = true;
        if (pair.flowKind !== ErdFieldKind.Rollup) pair.flowKind = ref.kind;
        if (!counted.has(pair)) {
          counted.add(pair);
          if (ref.kind === ErdFieldKind.Rollup) pair.rollups++;
          else pair.lookups++;
        }
      }
    }
    this.pairs.push(...pairMap.values());
    this.pairs.forEach((pair, i) => {
      (this.neighbors[pair.a] ??= []).push(i);
      (this.neighbors[pair.b] ??= []).push(i);
    });
  }

  tableOf(fieldId: string) {
    return this.fieldMap[fieldId]?.tableId;
  }

  linkOf(fieldId: string): IErdLink | undefined {
    return this.linkByField[fieldId];
  }

  otherTable(tableId: string, link: IErdLink) {
    return link.tableA === tableId ? link.tableB : link.tableA;
  }

  /** `fieldId` is this side's link field; it tells the two ends of a link to the same table apart */
  relationshipFrom(tableId: string, link: IErdLink, fieldId?: string) {
    const fromA = fieldId ? link.fieldA === fieldId : link.tableA === tableId;
    return fromA ? link.relationship : RelationshipRevert[link.relationship];
  }

  upOf(fieldId: string): IErdRef[] {
    return this.up[fieldId] ?? [];
  }

  downOf(fieldId: string): IErdRef[] {
    return this.down[fieldId] ?? [];
  }

  refsOf(fieldId: string, direction: ErdDirection) {
    return direction === ErdDirection.Up ? this.upOf(fieldId) : this.downOf(fieldId);
  }

  /** the foreign field a lookup or rollup reads, and the table it lives in */
  lookupSource(fieldId: string) {
    const sourceId = this.fieldMap[fieldId]?.lookupFieldId;
    const tableId = sourceId ? this.tableOf(sourceId) : undefined;
    return sourceId && tableId ? { fieldId: sourceId, tableId } : undefined;
  }

  /** a table and the tables it is paired with */
  neighborTables(tableId: string) {
    const tables = new Set([tableId]);
    for (const i of this.neighbors[tableId] ?? []) {
      tables.add(this.pairs[i].a);
      tables.add(this.pairs[i].b);
    }
    return tables;
  }

  /** link fields with the lookups and rollups that go through them; the rest are other fields */
  groupsOf(tableId: string) {
    if (!this.groupsCache.has(tableId)) this.groupsCache.set(tableId, this.buildGroups(tableId));
    return this.groupsCache.get(tableId)!;
  }

  /** lookups and rollups that take data through this link field into its table */
  viaOf(linkFieldId: string) {
    const tableId = this.tableOf(linkFieldId);
    if (!tableId) return [];
    return this.groupsOf(tableId).groups.find((g) => g.field.id === linkFieldId)?.via ?? [];
  }

  private buildGroups(tableId: string): IErdGroups {
    const table = this.tableMap[tableId];
    const linkFields = table.fields.filter(isLinkField);
    const own = new Set(linkFields.map((f) => f.id));
    const byForeign: Record<string, string[]> = {};
    for (const field of linkFields) {
      const link = this.linkOf(field.id);
      if (link) (byForeign[this.otherTable(tableId, link)] ??= []).push(field.id);
    }
    const via: Record<string, IErdField[]> = {};
    const rest: IErdField[] = [];
    for (const field of table.fields) {
      if (isLinkField(field)) continue;
      if (field.isLookup || field.type === FieldType.Rollup) {
        let linkId =
          field.lookupLinkedFieldId && own.has(field.lookupLinkedFieldId)
            ? field.lookupLinkedFieldId
            : undefined;
        // the stored link field can point outside this table (e.g. after a table copy):
        // fall back to the only link field that reaches the same foreign table.
        // A conditional lookup has no link field and picks records by its filter.
        if (!linkId && field.lookupLinkedFieldId) {
          const foreign = this.lookupSource(field.id)?.tableId;
          const candidates = foreign ? byForeign[foreign] : undefined;
          if (candidates?.length === 1) linkId = candidates[0];
        }
        if (linkId) {
          (via[linkId] ??= []).push(field);
          continue;
        }
      }
      rest.push(field);
    }
    const groups: IErdGroup[] = linkFields.map((field) => ({
      field,
      link: this.linkOf(field.id),
      via: via[field.id] ?? [],
    }));
    const incoming = this.links.filter(
      (link) => link.tableB === tableId && !link.fieldB && link.tableA !== tableId
    );
    return { groups, rest, incoming };
  }

  /** the selected field's direct relations: same-table fields, and other tables' fields */
  directOf(fieldId: string) {
    const tableId = this.tableOf(fieldId);
    const same = new Map<string, IErdRelation>();
    const cross: Record<string, ({ id: string } & IErdRelation)[]> = {};
    const add = (id: string, direction: ErdDirection, kind: ErdFieldKind) => {
      if (id === fieldId) return;
      const other = this.tableOf(id)!;
      if (other === tableId) {
        if (!same.has(id)) same.set(id, { direction, kind });
        return;
      }
      const list = (cross[other] ??= []);
      if (!list.some((r) => r.id === id)) list.push({ id, direction, kind });
    };
    this.upOf(fieldId).forEach((r) => add(r.id, ErdDirection.Up, r.kind));
    this.downOf(fieldId).forEach((r) => add(r.id, ErdDirection.Down, r.kind));
    return { same, cross };
  }

  /** breadth-first walk to the end; fields of `skipTable` are walked through but not counted */
  walk(seeds: string[], direction: ErdDirection, skipTable?: string): IErdWalk {
    const result = emptyWalk();
    const seen = new Set(seeds);
    let frontier = seeds;
    let depth = 0;
    while (frontier.length) {
      depth++;
      const next: string[] = [];
      for (const id of frontier) {
        for (const ref of this.refsOf(id, direction)) {
          if (seen.has(ref.id)) continue;
          seen.add(ref.id);
          next.push(ref.id);
          if (this.tableOf(ref.id) !== skipTable)
            result.levels.set(ref.id, { depth, kind: ref.kind });
        }
      }
      frontier = next;
    }
    result.levels.forEach((level, id) => {
      const tableId = this.tableOf(id)!;
      result.byTable[tableId] = (result.byTable[tableId] ?? 0) + 1;
      result.depth = Math.max(result.depth, level.depth);
    });
    return result;
  }

  deepOf(fieldId: string): Record<ErdDirection, IErdWalk> {
    const get = (direction: ErdDirection) => {
      const key = `${direction}:${fieldId}`;
      if (!this.walkCache.has(key)) this.walkCache.set(key, this.walk([fieldId], direction));
      return this.walkCache.get(key)!;
    };
    return { [ErdDirection.Up]: get(ErdDirection.Up), [ErdDirection.Down]: get(ErdDirection.Down) };
  }

  fieldStat(fieldId: string): Record<ErdDirection, IErdFieldStat> {
    if (!this.statCache.has(fieldId)) {
      const deep = this.deepOf(fieldId);
      const stat = (w: IErdWalk) => ({
        count: w.levels.size,
        tables: Object.keys(w.byTable).length,
        depth: w.depth,
      });
      this.statCache.set(fieldId, {
        [ErdDirection.Up]: stat(deep[ErdDirection.Up]),
        [ErdDirection.Down]: stat(deep[ErdDirection.Down]),
      });
    }
    return this.statCache.get(fieldId)!;
  }

  /** a whole table: start from all its fields, count only other tables' fields */
  tableDeepOf(tableId: string): Record<ErdDirection, IErdWalk> {
    if (!this.tableWalkCache.has(tableId)) {
      const own = this.tableMap[tableId].fields.map((f) => f.id);
      const result = {} as Record<ErdDirection, IErdWalk>;
      for (const direction of [ErdDirection.Up, ErdDirection.Down]) {
        const w = this.walk(own, direction, tableId);
        // the deepest level is per field, so it matches the key fields and the field panel
        w.depth = Math.max(0, ...own.map((id) => this.fieldStat(id)[direction].depth));
        result[direction] = w;
      }
      this.tableWalkCache.set(tableId, result);
    }
    return this.tableWalkCache.get(tableId)!;
  }

  private height(id: string, stack: Set<string>): number {
    const memo = this.heightMemo.get(id);
    if (memo) return memo.height;
    if (stack.has(id)) return 0;
    stack.add(id);
    let best = 0;
    let next: string | undefined;
    for (const ref of this.upOf(id)) {
      const h = 1 + this.height(ref.id, stack);
      if (h > best) {
        best = h;
        next = ref.id;
      }
    }
    stack.delete(id);
    this.heightMemo.set(id, { height: best, next });
    return best;
  }

  /** the longest dependency chain above a field, from its source down to the field */
  sourcePath(fieldId: string) {
    this.height(fieldId, new Set());
    const path = [fieldId];
    let current = fieldId;
    while (this.heightMemo.get(current)?.next && path.length < 30) {
      current = this.heightMemo.get(current)!.next!;
      path.push(current);
    }
    return path.reverse();
  }
}

export const EMPTY_WALK = emptyWalk();
