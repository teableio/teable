/* eslint-disable sonarjs/no-identical-functions */
/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable, Logger } from '@nestjs/common';
import type {
  IFilter,
  IFilterItem,
  ILinkFieldOptions,
  IConditionalRollupFieldOptions,
  IConditionalLookupOptions,
  FieldCore,
  TableDomain,
} from '@teable/core';
import { DbFieldType, DriverClient, FieldType, isFieldReferenceValue } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { InjectDbProvider } from '../../../../db-provider/db.provider';
import { IDbProvider } from '../../../../db-provider/db.provider.interface';
import type { ICellContext } from '../../../calculation/utils/changes';
import { TableDomainQueryService } from '../../../table-domain/table-domain-query.service';
import {
  LinkCascadeResolver,
  type IAllTableLinkSeed,
  type IExplicitLinkSeed,
  type ILinkEdge,
} from './link-cascade-resolver';

export interface ICellBasicContext {
  recordId: string;
  fieldId: string;
}

interface IComputedImpactGroup {
  fieldIds: Set<string>;
  recordIds: Set<string>;
  preferAutoNumberPaging?: boolean;
}

export interface IComputedImpactByTable {
  [tableId: string]: IComputedImpactGroup;
}

export interface IComputedCollectResult {
  impact: IComputedImpactByTable;
  tableDomains: Map<string, TableDomain>;
}

export interface IFieldChangeSource {
  tableId: string;
  fieldIds: string[];
}

interface IConditionalRollupAdjacencyEdge {
  tableId: string;
  fieldId: string;
  foreignTableId: string;
  filter?: IFilter | null;
}

interface ICollectorExecutionContext {
  getTableDomain(tableId: string): Promise<TableDomain>;
}

const ALL_RECORDS = Symbol('ALL_RECORDS');
const MAX_CONDITIONAL_ROLLUP_SAMPLE = 10_000;

@Injectable()
export class ComputedDependencyCollectorService {
  private logger = new Logger(ComputedDependencyCollectorService.name);
  private readonly linkCascadeResolver: LinkCascadeResolver;
  constructor(
    private readonly prismaService: PrismaService,
    private readonly tableDomainQueryService: TableDomainQueryService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectDbProvider() private readonly dbProvider: IDbProvider
  ) {
    this.linkCascadeResolver = new LinkCascadeResolver(this.prismaService);
  }

  private createExecutionContext(
    seed?: ReadonlyMap<string, TableDomain>
  ): ICollectorExecutionContext {
    const cache = new Map<string, Promise<TableDomain>>();
    if (seed) {
      for (const [tableId, domain] of seed) {
        cache.set(tableId, Promise.resolve(domain));
      }
    }
    return {
      getTableDomain: (tableId: string) => {
        let promise = cache.get(tableId);
        if (!promise) {
          promise = this.tableDomainQueryService.getTableDomainById(tableId);
          cache.set(tableId, promise);
        }
        return promise;
      },
    };
  }

  private async getTableDomain(
    tableId: string,
    ctx?: ICollectorExecutionContext
  ): Promise<TableDomain> {
    if (ctx) {
      return ctx.getTableDomain(tableId);
    }
    return this.tableDomainQueryService.getTableDomainById(tableId);
  }

  private buildSortFieldAccessor(column: string): Knex.Raw {
    if (this.dbProvider.driver === DriverClient.Pg) {
      return this.knex.raw(`??::json->'sort'->>'fieldId'`, [column]);
    }
    return this.knex.raw(`json_extract(??, '$.sort.fieldId')`, [column]);
  }

  private applySortFieldFilter(
    qb: Knex.QueryBuilder,
    column: string,
    values: readonly string[]
  ): void {
    if (!values.length) return;
    const accessor = this.buildSortFieldAccessor(column);
    const { sql, bindings } = accessor.toSQL();
    const placeholders = values.map(() => '?').join(', ');
    qb.whereRaw(`${sql} in (${placeholders})`, [...bindings, ...values]);
  }

  private async getDbTableName(tableId: string, ctx?: ICollectorExecutionContext): Promise<string> {
    const tableDomain = await this.getTableDomain(tableId, ctx);
    return tableDomain.dbTableName;
  }

  private async getAllRecordIds(
    tableId: string,
    ctx?: ICollectorExecutionContext
  ): Promise<string[]> {
    const dbTable = await this.getDbTableName(tableId, ctx);
    const { schema, table } = this.splitDbTableName(dbTable);
    const qb = (schema ? this.knex.withSchema(schema) : this.knex).select('__id').from(table);
    const rows = await this.prismaService
      .txClient()
      .$queryRawUnsafe<Array<{ __id: string }>>(qb.toQuery());
    return rows.map((r) => r.__id).filter(Boolean);
  }

  private splitDbTableName(qualified: string): { schema?: string; table: string } {
    const parts = qualified.split('.');
    if (parts.length === 2) return { schema: parts[0], table: parts[1] };
    return { table: qualified };
  }

  private buildValuesTable(alias: string, columnName: string, values: readonly string[]): Knex.Raw {
    if (!values.length) {
      throw new Error('buildValuesTable requires at least one value');
    }
    const placeholders = values.map(() => '(?)').join(', ');
    const quotedColumn = `"${columnName.replace(/"/g, '""')}"`;
    return this.knex.raw(`(values ${placeholders}) as ${alias} (${quotedColumn})`, values);
  }

  // Minimal link options needed for join table lookups
  private parseLinkOptions(
    raw: unknown
  ): Pick<
    ILinkFieldOptions,
    'foreignTableId' | 'fkHostTableName' | 'selfKeyName' | 'foreignKeyName'
  > | null {
    let value: unknown = raw;
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        return null;
      }
    }
    if (!value || typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    const foreignTableId = obj['foreignTableId'];
    const fkHostTableName = obj['fkHostTableName'];
    const selfKeyName = obj['selfKeyName'];
    const foreignKeyName = obj['foreignKeyName'];
    if (
      typeof foreignTableId === 'string' &&
      typeof fkHostTableName === 'string' &&
      typeof selfKeyName === 'string' &&
      typeof foreignKeyName === 'string'
    ) {
      return { foreignTableId, fkHostTableName, selfKeyName, foreignKeyName };
    }
    return null;
  }

  private parseOptionsLoose<T = unknown>(raw: unknown): T | null {
    if (!raw) return null;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    }
    if (typeof raw === 'object') return raw as T;
    return null;
  }

  private async materializeAllRecordIds(
    tableId: string,
    cache: Map<string, string[]>,
    ctx?: ICollectorExecutionContext
  ): Promise<string[]> {
    let ids = cache.get(tableId);
    if (ids) {
      return ids;
    }
    ids = await this.getAllRecordIds(tableId, ctx);
    cache.set(tableId, ids);
    return ids;
  }

  private async buildLinkEdgesForTables(
    tables: Iterable<string>,
    tableDomains?: ReadonlyMap<string, TableDomain>,
    ctx?: ICollectorExecutionContext
  ): Promise<ILinkEdge[]> {
    const edges: ILinkEdge[] = [];
    const visited = new Set<string>();
    for (const tableId of tables) {
      if (!tableId || visited.has(tableId)) {
        continue;
      }
      visited.add(tableId);
      const tableDomain = tableDomains?.get(tableId) ?? (await this.getTableDomain(tableId, ctx));
      if (!tableDomain) continue;
      for (const field of tableDomain.fieldList) {
        if (field.type !== FieldType.Link || field.isLookup) continue;
        const opts = this.parseLinkOptions(field.options);
        if (!opts) continue;
        edges.push({
          foreignTableId: opts.foreignTableId,
          hostTableId: tableId,
          fkTableName: opts.fkHostTableName,
          selfKeyName: opts.selfKeyName,
          foreignKeyName: opts.foreignKeyName,
        });
      }
    }
    return edges;
  }

  private addExplicitSeed(
    seedMap: Map<string, Set<string>>,
    tableId: string,
    ids: Iterable<string>
  ): boolean {
    const normalized = Array.from(ids).filter(Boolean);
    if (!normalized.length) {
      return false;
    }
    let set = seedMap.get(tableId);
    if (!set) {
      set = new Set<string>();
      seedMap.set(tableId, set);
    }
    let added = false;
    for (const id of normalized) {
      if (!set.has(id)) {
        set.add(id);
        added = true;
      }
    }
    return added;
  }

  private markAllSeed(target: Set<string>, tableId: string): boolean {
    if (target.has(tableId)) {
      return false;
    }
    target.add(tableId);
    return true;
  }

  private findRecordSetGrowth(
    previous: Record<string, Set<string> | typeof ALL_RECORDS | undefined>,
    next: Record<string, Set<string> | typeof ALL_RECORDS>
  ): string[] {
    const changed: string[] = [];
    const tableIds = new Set([...Object.keys(previous), ...Object.keys(next)]);
    for (const tableId of tableIds) {
      const prevSet = previous[tableId];
      const nextSet = next[tableId];
      if (!nextSet) continue;
      if (!prevSet) {
        changed.push(tableId);
        continue;
      }
      if (prevSet === ALL_RECORDS && nextSet === ALL_RECORDS) {
        continue;
      }
      if (prevSet !== ALL_RECORDS && nextSet === ALL_RECORDS) {
        changed.push(tableId);
        continue;
      }
      if (prevSet === ALL_RECORDS && nextSet !== ALL_RECORDS) {
        // This should not happen; treat as unchanged.
        continue;
      }
      if (prevSet instanceof Set && nextSet instanceof Set) {
        if (nextSet.size > prevSet.size) {
          changed.push(tableId);
          continue;
        }
        let hasNew = false;
        for (const id of nextSet) {
          if (!prevSet.has(id)) {
            hasNew = true;
            break;
          }
        }
        if (hasNew) {
          changed.push(tableId);
        }
      }
    }
    return changed;
  }

  private async computeLinkClosure(params: {
    impactedTables: ReadonlySet<string>;
    explicitSeeds: ReadonlyMap<string, Set<string>>;
    tablesWithAllRecords: ReadonlySet<string>;
    linkEdges: ILinkEdge[];
    tableDomains?: ReadonlyMap<string, TableDomain>;
    ctx?: ICollectorExecutionContext;
  }): Promise<Record<string, Set<string> | typeof ALL_RECORDS>> {
    const { impactedTables, explicitSeeds, tablesWithAllRecords, linkEdges, tableDomains, ctx } =
      params;

    const explicitSeedList: IExplicitLinkSeed[] = [];
    for (const [tableId, ids] of explicitSeeds) {
      if (!ids.size) continue;
      explicitSeedList.push({ tableId, recordIds: Array.from(ids) });
    }

    const allSeedList: IAllTableLinkSeed[] = [];
    for (const tableId of tablesWithAllRecords) {
      const domain = tableDomains?.get(tableId) ?? (await this.getTableDomain(tableId, ctx));
      if (!domain) continue;
      allSeedList.push({ tableId, dbTableName: domain.dbTableName });
    }

    if (!explicitSeedList.length && !allSeedList.length) {
      return {};
    }

    if (!linkEdges.length) {
      const fallback: Record<string, Set<string> | typeof ALL_RECORDS> = {};
      for (const [tableId, ids] of explicitSeeds) {
        if (!ids.size || !impactedTables.has(tableId)) continue;
        fallback[tableId] = new Set(ids);
      }
      for (const tableId of tablesWithAllRecords) {
        if (!impactedTables.has(tableId)) continue;
        fallback[tableId] = ALL_RECORDS;
      }
      return fallback;
    }

    const rows = await this.linkCascadeResolver.resolve({
      explicitSeeds: explicitSeedList,
      allTableSeeds: allSeedList,
      edges: linkEdges,
    });

    const aggregated = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!impactedTables.has(row.tableId)) {
        continue;
      }
      let set = aggregated.get(row.tableId);
      if (!set) {
        set = new Set<string>();
        aggregated.set(row.tableId, set);
      }
      set.add(row.recordId);
    }

    const closure: Record<string, Set<string> | typeof ALL_RECORDS> = {};
    for (const [tableId, set] of aggregated) {
      closure[tableId] = set;
    }

    for (const [tableId, ids] of explicitSeeds) {
      if (!ids.size || !impactedTables.has(tableId)) continue;
      const existing = closure[tableId];
      if (!existing) {
        closure[tableId] = new Set(ids);
        continue;
      }
      if (existing === ALL_RECORDS) {
        continue;
      }
      ids.forEach((id) => existing.add(id));
    }

    for (const tableId of tablesWithAllRecords) {
      if (!impactedTables.has(tableId)) continue;
      closure[tableId] = ALL_RECORDS;
    }

    return closure;
  }

  private collectFilterFieldReferences(filter?: IFilter | null): {
    hostFieldRefs: Array<{ fieldId: string; tableId?: string }>;
    foreignFieldIds: Set<string>;
  } {
    const hostFieldRefs: Array<{ fieldId: string; tableId?: string }> = [];
    const foreignFieldIds = new Set<string>();
    if (!filter?.filterSet?.length) {
      return { hostFieldRefs, foreignFieldIds };
    }

    const visitValue = (value: unknown) => {
      if (!value) return;
      if (Array.isArray(value)) {
        value.forEach(visitValue);
        return;
      }
      if (isFieldReferenceValue(value)) {
        hostFieldRefs.push({ fieldId: value.fieldId, tableId: value.tableId });
      }
    };

    const traverse = (current: IFilter) => {
      if (!current?.filterSet?.length) return;
      for (const entry of current.filterSet as Array<IFilter | IFilterItem>) {
        if (entry && 'fieldId' in entry) {
          const item = entry as IFilterItem;
          foreignFieldIds.add(item.fieldId);
          visitValue(item.value);
        } else if (entry && 'filterSet' in entry) {
          traverse(entry as IFilter);
        }
      }
    };

    traverse(filter);
    return { hostFieldRefs, foreignFieldIds };
  }

  private async loadFieldInstances(
    tableId: string,
    fieldIds: Iterable<string>,
    ctx?: ICollectorExecutionContext
  ): Promise<Map<string, FieldCore>> {
    const ids = Array.from(new Set(Array.from(fieldIds).filter(Boolean)));
    if (!ids.length) {
      return new Map();
    }

    const tableDomain = await this.getTableDomain(tableId, ctx);
    const map = new Map<string, FieldCore>();
    for (const id of ids) {
      const field = tableDomain.getField(id);
      if (field) {
        map.set(field.id, field);
      }
    }
    return map;
  }

  private async resolveConditionalSortDependents(
    sortFieldIds: readonly string[]
  ): Promise<Array<{ tableId: string; fieldId: string; sortFieldId: string }>> {
    if (!sortFieldIds.length) return [];

    const prisma = this.prismaService.txClient();
    const conditionalQuery = this.knex('field')
      .select({
        tableId: 'table_id',
        fieldId: 'id',
        sortFieldId: this.buildSortFieldAccessor('options'),
      })
      .whereNull('deleted_time')
      .where('type', FieldType.ConditionalRollup)
      .modify((qb) => this.applySortFieldFilter(qb, 'options', sortFieldIds));
    const lookupQuery = this.knex('field')
      .select({
        tableId: 'table_id',
        fieldId: 'id',
        sortFieldId: this.buildSortFieldAccessor('lookup_options'),
      })
      .whereNull('deleted_time')
      .where('is_conditional_lookup', true)
      .modify((qb) => this.applySortFieldFilter(qb, 'lookup_options', sortFieldIds));

    const [conditionalRollups, conditionalLookups] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ tableId: string; fieldId: string; sortFieldId: string }>>(
        conditionalQuery.toQuery()
      ),
      prisma.$queryRawUnsafe<Array<{ tableId: string; fieldId: string; sortFieldId: string }>>(
        lookupQuery.toQuery()
      ),
    ]);

    const results: Array<{ tableId: string; fieldId: string; sortFieldId: string }> = [];
    for (const row of conditionalRollups) {
      if (row.sortFieldId) {
        results.push(row);
      }
    }
    for (const row of conditionalLookups) {
      if (row.sortFieldId) {
        results.push(row);
      }
    }

    return results;
  }

  async getConditionalSortDependents(
    sortFieldIds: readonly string[]
  ): Promise<Array<{ tableId: string; fieldId: string; sortFieldId: string }>> {
    return this.resolveConditionalSortDependents(sortFieldIds);
  }

  /**
   * Resolve link field IDs among the provided field IDs and include their symmetric counterparts.
   */
  private async resolveRelatedLinkFieldIds(
    fieldIds: string[],
    fieldToTableMap?: Map<string, string>,
    ctx?: ICollectorExecutionContext
  ): Promise<string[]> {
    if (!fieldIds.length) return [];
    const groupedByTable = new Map<string, string[]>();
    for (const fieldId of fieldIds) {
      const tableId = fieldToTableMap?.get(fieldId);
      if (!tableId) continue;
      const bucket = groupedByTable.get(tableId);
      if (bucket) {
        bucket.push(fieldId);
      } else {
        groupedByTable.set(tableId, [fieldId]);
      }
    }

    const result = new Set<string>();
    for (const [tableId, ids] of groupedByTable) {
      const tableDomain = await this.getTableDomain(tableId, ctx);
      for (const id of ids) {
        const field = tableDomain.getField(id);
        if (!field || field.type !== FieldType.Link || field.isLookup) continue;
        result.add(field.id);
        const opts = this.parseOptionsLoose<{ symmetricFieldId?: string }>(field.options);
        if (opts?.symmetricFieldId) result.add(opts.symmetricFieldId);
      }
    }
    return Array.from(result);
  }

  /**
   * Find lookup/rollup fields whose lookupOptions.linkFieldId equals any of the provided link IDs.
   * Returns a map: tableId -> Set<fieldId>
   */
  private async findLookupsByLinkIds(linkFieldIds: string[]): Promise<Record<string, Set<string>>> {
    const acc: Record<string, Set<string>> = {};
    if (!linkFieldIds.length) return acc;
    for (const linkId of linkFieldIds) {
      const sql = this.dbProvider.lookupOptionsQuery('linkFieldId', linkId);
      const rows = await this.prismaService
        .txClient()
        .$queryRawUnsafe<Array<{ tableId: string; id: string }>>(sql);
      for (const r of rows) {
        if (!r.tableId || !r.id) continue;
        (acc[r.tableId] ||= new Set<string>()).add(r.id);
      }
    }
    return acc;
  }

  /**
   * Same as collectDependentFieldIds but groups by table id directly in SQL.
   * Returns a map: tableId -> Set<fieldId>
   */
  private async collectDependentFieldsByTable(
    startFieldIds: string[],
    excludeFieldIds?: string[]
  ): Promise<Record<string, Set<string>>> {
    if (!startFieldIds.length) return {};

    const nonRecursive = this.knex
      .select('from_field_id', 'to_field_id')
      .from('reference')
      .whereIn('from_field_id', startFieldIds);

    const recursive = this.knex
      .select('r.from_field_id', 'r.to_field_id')
      .from({ r: 'reference' })
      .join({ d: 'dep_graph' }, 'r.from_field_id', 'd.to_field_id');

    const depBuilder = this.knex
      .withRecursive('dep_graph', ['from_field_id', 'to_field_id'], nonRecursive.union(recursive))
      .distinct({ to_field_id: 'dep_graph.to_field_id', table_id: 'f.table_id' })
      .from('dep_graph')
      .join({ f: 'field' }, 'f.id', 'dep_graph.to_field_id')
      .whereNull('f.deleted_time')
      .andWhere((qb) => {
        qb.where('f.is_lookup', true)
          .orWhere('f.is_computed', true)
          .orWhere('f.type', FieldType.Link)
          .orWhere('f.type', FieldType.Formula)
          .orWhere('f.type', FieldType.Rollup)
          .orWhere('f.type', FieldType.ConditionalRollup);
      });
    if (excludeFieldIds?.length) {
      depBuilder.whereNotIn('dep_graph.to_field_id', excludeFieldIds);
    }

    // Also consider the changed Link fields themselves as impacted via UNION at SQL level.
    const linkSelf = this.knex
      .select({ to_field_id: 'f.id', table_id: 'f.table_id' })
      .from({ f: 'field' })
      .whereIn('f.id', startFieldIds)
      .andWhere('f.type', FieldType.Link)
      .whereNull('f.deleted_time');
    // Note: we intentionally do NOT exclude starting link fields even if they
    // are part of the changedFieldIds. We still want to include them in the
    // impacted set so that their display columns are persisted via
    // updateFromSelect. The computed orchestrator will independently avoid
    // publishing ops for base-changed fields (including links).

    const unionBuilder = this.knex
      .select('*')
      .from(depBuilder.as('dep'))
      .union(function () {
        this.select('*').from(linkSelf.as('link_self'));
      });

    const rows = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ to_field_id: string; table_id: string }[]>(unionBuilder.toQuery());

    const result: Record<string, Set<string>> = {};
    for (const r of rows) {
      if (!r.table_id || !r.to_field_id) continue;
      (result[r.table_id] ||= new Set<string>()).add(r.to_field_id);
    }
    return result;
  }

  private async getConditionalRollupImpactedRecordIds(
    edge: IConditionalRollupAdjacencyEdge,
    foreignRecordIds: string[],
    changeContextMap?: Map<string, ICellContext[]>,
    ctx?: ICollectorExecutionContext
  ): Promise<string[] | typeof ALL_RECORDS> {
    if (!foreignRecordIds.length) {
      return [];
    }
    const uniqueForeignIds = Array.from(new Set(foreignRecordIds.filter(Boolean)));
    if (uniqueForeignIds.length > MAX_CONDITIONAL_ROLLUP_SAMPLE) {
      return ALL_RECORDS;
    }
    if (!uniqueForeignIds.length) {
      return [];
    }

    const filter = edge.filter;
    if (!filter) {
      return ALL_RECORDS;
    }

    const { hostFieldRefs, foreignFieldIds } = this.collectFilterFieldReferences(filter);
    if (!hostFieldRefs.length) {
      return ALL_RECORDS;
    }

    if (foreignFieldIds.size === 0) {
      return ALL_RECORDS;
    }

    if (hostFieldRefs.some((ref) => ref.tableId && ref.tableId !== edge.tableId)) {
      return ALL_RECORDS;
    }

    const uniqueHostFieldIds = Array.from(new Set(hostFieldRefs.map((ref) => ref.fieldId)));
    const hostFieldMap = await this.loadFieldInstances(edge.tableId, uniqueHostFieldIds, ctx);
    if (hostFieldMap.size !== uniqueHostFieldIds.length) {
      return ALL_RECORDS;
    }

    const foreignFieldMap = await this.loadFieldInstances(
      edge.foreignTableId,
      foreignFieldIds,
      ctx
    );
    if (foreignFieldMap.size !== foreignFieldIds.size) {
      return ALL_RECORDS;
    }

    // Note: when any foreign-side filter column is JSON, we bail out to ALL_RECORDS.
    // The values-based subquery we build below uses parameter binding which serialises JSON
    // as plain text. Postgres then attempts to cast that "text" into json/jsonb when evaluating
    // operators like `@>` or `?`. Without explicit casts (e.g. `::jsonb`) the parser errors out:
    //   ERROR: invalid input syntax for type json DETAIL: Expected ":", but found "}".
    // Rather than attempt to inline JSON literals with per-driver casting (and reimplement
    // Prisma's quoting rules), we fall back to the conservative ALL_RECORDS path. For now this
    // keeps correctness for complex filters (array_contains, field references, etc.) while
    // avoiding subtle type issues. If/when we add a typed VALUES helper we can revisit this.
    if (
      Array.from(foreignFieldMap.values()).some((field) => field.dbFieldType === DbFieldType.Json)
    ) {
      return ALL_RECORDS;
    }

    if (
      Array.from(foreignFieldMap.values()).some((field) => field.dbFieldType === DbFieldType.Json)
    ) {
      return ALL_RECORDS;
    }

    const hostTableName = await this.getDbTableName(edge.tableId, ctx);
    const foreignTableName = await this.getDbTableName(edge.foreignTableId, ctx);

    const hostAlias = '__host';
    const foreignAlias = '__foreign';
    const { schema: foreignSchema, table: foreignTable } = this.splitDbTableName(foreignTableName);
    const foreignFrom = () =>
      foreignSchema
        ? this.knex.raw('??.?? as ??', [foreignSchema, foreignTable, foreignAlias])
        : this.knex.raw('?? as ??', [foreignTable, foreignAlias]);

    const quoteIdentifier = (name: string) => name.replace(/"/g, '""');

    const selectionMap = new Map<string, string>();
    const foreignFieldObj: Record<string, FieldCore> = {};
    const foreignFieldByDbName = new Map<string, FieldCore>();
    for (const [id, field] of foreignFieldMap) {
      selectionMap.set(id, `"${foreignAlias}"."${quoteIdentifier(field.dbFieldName)}"`);
      foreignFieldObj[id] = field;
      if (field.dbFieldName) {
        foreignFieldByDbName.set(field.dbFieldName, field);
      }
    }

    const fieldReferenceSelectionMap = new Map<string, string>();
    const fieldReferenceFieldMap = new Map<string, FieldCore>();
    for (const [id, field] of hostFieldMap) {
      fieldReferenceSelectionMap.set(id, `"${hostAlias}"."${quoteIdentifier(field.dbFieldName)}"`);
      fieldReferenceFieldMap.set(id, field);
    }

    const existsIdAlias = '__foreign_ids';
    const existsSubquery = this.knex
      .select(this.knex.raw('1'))
      .from(foreignFrom())
      .join(
        this.buildValuesTable(existsIdAlias, '__id', uniqueForeignIds),
        `${foreignAlias}.__id`,
        `${existsIdAlias}.__id`
      );

    this.dbProvider
      .filterQuery(existsSubquery, foreignFieldObj, filter, undefined, {
        selectionMap,
        fieldReferenceSelectionMap,
        fieldReferenceFieldMap,
      })
      .appendQueryBuilder();

    const queryBuilder = this.knex
      .select(this.knex.raw(`"${hostAlias}"."__id" as id`))
      .from(`${hostTableName} as ${hostAlias}`)
      .whereExists(existsSubquery);

    const sql = queryBuilder.toQuery();
    this.logger.debug(`Conditional Rollup Impacted Records SQL: ${sql}`);

    const rows = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ id?: string; __id?: string }[]>(sql);

    const ids = new Set<string>();
    for (const row of rows) {
      const id = row.id || row.__id;
      if (id) {
        ids.add(id);
      }
    }

    if (!changeContextMap || !changeContextMap.size) {
      return Array.from(ids);
    }

    const foreignDbFieldNamesOrdered = Array.from(
      new Set(
        Array.from(foreignFieldIds)
          .map((fid) => foreignFieldMap.get(fid)?.dbFieldName)
          .filter((name): name is string => !!name)
      )
    );

    if (foreignDbFieldNamesOrdered.length !== foreignFieldIds.size) {
      return ALL_RECORDS;
    }

    const selectColumns = ['__id', ...foreignDbFieldNamesOrdered];
    const baseIdAlias = '__base_ids';
    const baseRowsQuery = this.knex
      .select(
        ...selectColumns.map((column) =>
          this.knex.raw(
            `"${foreignAlias}"."${quoteIdentifier(column)}" as "${quoteIdentifier(column)}"`
          )
        )
      )
      .from(foreignFrom())
      .join(
        this.buildValuesTable(baseIdAlias, '__id', uniqueForeignIds),
        `${foreignAlias}.__id`,
        `${baseIdAlias}.__id`
      );

    const baseRows = await this.prismaService
      .txClient()
      .$queryRawUnsafe<Record<string, unknown>[]>(baseRowsQuery.toQuery());
    const baseRowById = new Map<string, Record<string, unknown>>();
    for (const row of baseRows) {
      const id = row['__id'];
      if (typeof id === 'string') {
        baseRowById.set(id, row);
      }
    }

    const updatedRows: Record<string, unknown>[] = [];
    for (const recordId of uniqueForeignIds) {
      const base: Record<string, unknown> = {
        ...(baseRowById.get(recordId) ?? {}),
        __id: recordId,
      };
      const recordContexts = changeContextMap.get(recordId) ?? [];
      for (const ctx of recordContexts) {
        const field = foreignFieldMap.get(ctx.fieldId);
        if (!field) continue;
        const converter = (
          field as unknown as {
            convertCellValue2DBValue?: (value: unknown) => unknown;
          }
        ).convertCellValue2DBValue;
        const dbValue =
          typeof converter === 'function' ? converter.call(field, ctx.newValue) : ctx.newValue;
        base[field.dbFieldName] = dbValue;
      }

      let missing = false;
      for (const fieldId of foreignFieldIds) {
        const field = foreignFieldMap.get(fieldId);
        if (!field) {
          missing = true;
          break;
        }
        if (!(field.dbFieldName in base)) {
          missing = true;
          break;
        }
      }
      if (missing) {
        return ALL_RECORDS;
      }
      updatedRows.push(base);
    }

    if (!updatedRows.length) {
      return Array.from(ids);
    }

    const valueColumns = ['__id', ...foreignDbFieldNamesOrdered];
    const valuesMatrix = updatedRows.map((row) => {
      return valueColumns.map((column) => {
        if (!(column in row)) return undefined;
        return row[column];
      });
    });

    if (valuesMatrix.some((row) => row.some((value) => typeof value === 'undefined'))) {
      return ALL_RECORDS;
    }

    const bindings = valuesMatrix.flat();
    const columnsSql = valueColumns.map((col) => `"${quoteIdentifier(col)}"`).join(', ');

    const resolveColumnType = (column: string): string => {
      if (column === '__id') {
        return 'text';
      }
      const field = foreignFieldByDbName.get(column);
      switch (field?.dbFieldType) {
        case DbFieldType.Integer:
          return 'integer';
        case DbFieldType.Real:
          return 'double precision';
        case DbFieldType.Boolean:
          return 'boolean';
        case DbFieldType.DateTime:
          return 'timestamp';
        case DbFieldType.Blob:
          return 'bytea';
        case DbFieldType.Json:
          return 'jsonb';
        case DbFieldType.Text:
        default:
          return 'text';
      }
    };

    const columnTypeSql = valueColumns.map(resolveColumnType);
    const unionSelectSql = valuesMatrix
      .map((row) => {
        const columnAssignments = row
          .map((_, columnIndex) => {
            const typeSql = columnTypeSql[columnIndex];
            const columnAlias = `"${quoteIdentifier(valueColumns[columnIndex])}"`;
            return `CAST(? AS ${typeSql}) AS ${columnAlias}`;
          })
          .join(', ');
        return `select ${columnAssignments}`;
      })
      .join(' union all ');

    const derivedRaw = this.knex.raw(
      `(${unionSelectSql}) as ${foreignAlias} (${columnsSql})`,
      bindings
    );
    const postExistsSubquery = this.knex.select(this.knex.raw('1')).from(derivedRaw);

    this.dbProvider
      .filterQuery(postExistsSubquery, foreignFieldObj, filter, undefined, {
        selectionMap,
        fieldReferenceSelectionMap,
        fieldReferenceFieldMap,
      })
      .appendQueryBuilder();

    const postQueryBuilder = this.knex
      .select(this.knex.raw(`"${hostAlias}"."__id" as id`))
      .from(`${hostTableName} as ${hostAlias}`)
      .whereExists(postExistsSubquery);

    const postQuery = postQueryBuilder.toQuery();
    this.logger.debug('postQuery %s', postQuery);

    const postRows = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ id?: string; __id?: string }[]>(postQuery);

    for (const row of postRows) {
      const id = row.id || row.__id;
      if (id) {
        ids.add(id);
      }
    }

    return Array.from(ids);
  }

  /**
   * Build adjacency maps for link and conditional rollup relationships among the supplied tables.
   */
  private async getAdjacencyMaps(
    tables: string[],
    ctx?: ICollectorExecutionContext
  ): Promise<{
    link: Record<string, Set<string>>;
    conditionalRollup: Record<string, IConditionalRollupAdjacencyEdge[]>;
  }> {
    const linkAdj: Record<string, Set<string>> = {};
    const conditionalRollupAdj: Record<string, IConditionalRollupAdjacencyEdge[]> = {};

    if (!tables.length) {
      return { link: linkAdj, conditionalRollup: conditionalRollupAdj };
    }

    for (const tableId of tables) {
      const tableDomain = await this.getTableDomain(tableId, ctx);
      for (const field of tableDomain.fieldList) {
        if (field.type === FieldType.Link && !field.isLookup) {
          const opts = this.parseLinkOptions(field.options);
          const from = opts?.foreignTableId;
          if (from) {
            (linkAdj[from] ||= new Set<string>()).add(tableId);
          }
          continue;
        }

        if (field.type === FieldType.ConditionalRollup) {
          const opts = this.parseOptionsLoose<IConditionalRollupFieldOptions>(field.options);
          const foreignTableId = opts?.foreignTableId;
          if (!foreignTableId) continue;
          (conditionalRollupAdj[foreignTableId] ||= []).push({
            tableId,
            fieldId: field.id,
            foreignTableId,
            filter: opts?.filter ?? undefined,
          });
          continue;
        }

        if (field.isConditionalLookup) {
          const opts = this.parseOptionsLoose<IConditionalLookupOptions>(field.lookupOptions);
          const foreignTableId = opts?.foreignTableId;
          if (!foreignTableId) continue;
          (conditionalRollupAdj[foreignTableId] ||= []).push({
            tableId,
            fieldId: field.id,
            foreignTableId,
            filter: opts?.filter ?? undefined,
          });
        }
      }
    }

    return { link: linkAdj, conditionalRollup: conditionalRollupAdj };
  }

  /**
   * Collect impacted fields and records by starting from changed field definitions.
   * - Includes the starting fields themselves when they are computed/lookup/rollup/formula.
   * - Expands to dependent computed/lookup/link/rollup fields via reference graph (SQL CTE).
   * - Seeds recordIds with ALL records from tables owning the changed fields.
   * - Propagates recordIds across link relationships via junction tables.
   */
  async collectForFieldChanges(sources: IFieldChangeSource[]): Promise<IComputedImpactByTable> {
    const execCtx = this.createExecutionContext();
    const startFieldIds = Array.from(new Set(sources.flatMap((s) => s.fieldIds || [])));
    if (!startFieldIds.length) return {};

    // Group starting fields by table and fetch minimal metadata
    const fieldToTableMap = new Map<string, string>();
    const byTable: Record<string, string[]> = {};
    const startFields: Array<{
      id: string;
      tableId: string;
      isComputed?: boolean;
      isLookup?: boolean;
      type: FieldType;
    }> = [];

    for (const source of sources) {
      if (!source.fieldIds?.length) continue;
      const tableDomain = await this.getTableDomain(source.tableId, execCtx);
      for (const fieldId of source.fieldIds) {
        const field = tableDomain.getField(fieldId);
        if (!field) continue;
        startFields.push({
          id: field.id,
          tableId: source.tableId,
          isComputed: field.isComputed,
          isLookup: field.isLookup,
          type: field.type,
        });
        fieldToTableMap.set(field.id, source.tableId);
        (byTable[source.tableId] ||= []).push(field.id);
      }
    }

    // 1) Dependent fields grouped by table
    const depByTable = await this.collectDependentFieldsByTable(startFieldIds);

    // Initialize impact with dependent fields
    const impact: IComputedImpactByTable = Object.entries(depByTable).reduce((acc, [tid, fset]) => {
      acc[tid] = { fieldIds: new Set(fset), recordIds: new Set<string>() };
      return acc;
    }, {} as IComputedImpactByTable);

    // Ensure starting fields themselves are included so conversions can compare old/new values
    for (const f of startFields) {
      (impact[f.tableId] ||= {
        fieldIds: new Set<string>(),
        recordIds: new Set<string>(),
      }).fieldIds.add(f.id);
    }

    // Ensure conditional rollup/lookup fields that sort by the changed fields are always impacted,
    // even if historical references are missing.
    const sortDependents = await this.resolveConditionalSortDependents(startFieldIds);
    for (const { tableId, fieldId } of sortDependents) {
      (impact[tableId] ||= {
        fieldIds: new Set<string>(),
        recordIds: new Set<string>(),
      }).fieldIds.add(fieldId);
    }

    const relatedLinkIds = await this.resolveRelatedLinkFieldIds(
      startFieldIds,
      fieldToTableMap,
      execCtx
    );
    const fallbackLookupIds = new Set<string>();
    if (relatedLinkIds.length) {
      const byTable = await this.findLookupsByLinkIds(relatedLinkIds);
      for (const [tid, fset] of Object.entries(byTable)) {
        const group = (impact[tid] ||= {
          fieldIds: new Set<string>(),
          recordIds: new Set<string>(),
        });
        fset.forEach((fid) => {
          if (!group.fieldIds.has(fid)) {
            group.fieldIds.add(fid);
            fallbackLookupIds.add(fid);
          }
        });
      }
    }

    if (fallbackLookupIds.size) {
      // Legacy compatibility: pre-link reference rows created before lookupOptions.linkFieldId
      // existed do not include the link→lookup edge. We need to synthesize those missing
      // dependencies so downstream lookups/formulas still recompute.
      const extraDeps = await this.collectDependentFieldsByTable(Array.from(fallbackLookupIds));
      for (const [tid, fset] of Object.entries(extraDeps)) {
        const group = (impact[tid] ||= {
          fieldIds: new Set<string>(),
          recordIds: new Set<string>(),
        });
        fset.forEach((fid) => group.fieldIds.add(fid));
      }
    }

    if (!Object.keys(impact).length) return {};

    const originTableIds = Object.keys(byTable);
    const impactedTables = new Set([...Object.keys(impact), ...originTableIds]);
    if (!impactedTables.size) {
      return {};
    }

    for (const tid of originTableIds) {
      const group = impact[tid];
      if (group) group.preferAutoNumberPaging = true;
    }

    const linkEdges = await this.buildLinkEdgesForTables(impactedTables, undefined, execCtx);
    const explicitSeeds = new Map<string, Set<string>>();
    const tablesWithAllRecords = new Set<string>(originTableIds);

    const { link: linkAdj, conditionalRollup: referenceAdj } = await this.getAdjacencyMaps(
      Array.from(impactedTables),
      execCtx
    );

    let recordSets = await this.computeLinkClosure({
      impactedTables,
      explicitSeeds,
      tablesWithAllRecords,
      linkEdges,
      ctx: execCtx,
    });

    const queue: string[] = [];
    const queued = new Set<string>();
    const enqueueConditional = (tableId: string) => {
      if (!tableId || queued.has(tableId)) {
        return;
      }
      queued.add(tableId);
      queue.push(tableId);
    };
    const enqueueLinkDependents = (tableId: string) => {
      const targets = linkAdj[tableId];
      if (!targets) return;
      targets.forEach((tid) => enqueueConditional(tid));
    };

    const initialGrowth = this.findRecordSetGrowth({}, recordSets);
    initialGrowth.forEach((tid) => {
      enqueueConditional(tid);
      enqueueLinkDependents(tid);
    });
    const materializedAllRecords = new Map<string, string[]>();

    while (queue.length) {
      const src = queue.shift()!;
      queued.delete(src);

      const referenceEdges = (referenceAdj[src] || []).filter((edge) => {
        const targetGroup = impact[edge.tableId];
        return !!targetGroup && targetGroup.fieldIds.has(edge.fieldId);
      });
      if (!referenceEdges.length) {
        continue;
      }

      const rawSet = recordSets[src];
      if (!rawSet) {
        continue;
      }

      let currentIds: string[] = [];
      let shouldMaterializeAllRecords = false;
      if (rawSet === ALL_RECORDS) {
        const needsMaterialization = referenceEdges.some((edge) => {
          const targetSet = recordSets[edge.tableId];
          return targetSet !== ALL_RECORDS && edge.tableId !== src;
        });
        shouldMaterializeAllRecords = needsMaterialization;
        if (shouldMaterializeAllRecords) {
          currentIds = await this.materializeAllRecordIds(src, materializedAllRecords, execCtx);
        }
      } else {
        currentIds = Array.from(rawSet);
      }
      if (!currentIds.length && shouldMaterializeAllRecords) {
        continue;
      }

      const eagerReferenceMatches: Array<{
        edge: IConditionalRollupAdjacencyEdge;
        matched: typeof ALL_RECORDS;
      }> = [];
      const referencePromises: Array<
        Promise<{ edge: IConditionalRollupAdjacencyEdge; matched: string[] | typeof ALL_RECORDS }>
      > = [];
      for (const edge of referenceEdges) {
        const targetGroup = impact[edge.tableId];
        if (!targetGroup || !targetGroup.fieldIds.has(edge.fieldId)) continue;
        if (
          rawSet === ALL_RECORDS &&
          (!shouldMaterializeAllRecords ||
            recordSets[edge.tableId] === ALL_RECORDS ||
            edge.tableId === src)
        ) {
          eagerReferenceMatches.push({ edge, matched: ALL_RECORDS });
          continue;
        }
        if (!currentIds.length) continue;
        referencePromises.push(
          this.getConditionalRollupImpactedRecordIds(edge, currentIds, undefined, execCtx).then(
            (matched) => ({
              edge,
              matched,
            })
          )
        );
      }

      const referenceResults = [
        ...eagerReferenceMatches,
        ...(await Promise.all(referencePromises)),
      ];

      let dirty = false;
      for (const { edge, matched } of referenceResults) {
        const targetGroup = impact[edge.tableId];
        if (!targetGroup || !targetGroup.fieldIds.has(edge.fieldId)) continue;
        if (matched === ALL_RECORDS) {
          const updated = this.markAllSeed(tablesWithAllRecords, edge.tableId);
          if (updated) {
            targetGroup.preferAutoNumberPaging = true;
            dirty = true;
            enqueueConditional(edge.tableId);
            enqueueLinkDependents(edge.tableId);
          }
          continue;
        }
        if (!matched.length) continue;
        const updated = this.addExplicitSeed(explicitSeeds, edge.tableId, matched);
        if (updated) {
          dirty = true;
          enqueueConditional(edge.tableId);
          enqueueLinkDependents(edge.tableId);
        }
      }

      if (dirty) {
        const nextRecordSets = await this.computeLinkClosure({
          impactedTables,
          explicitSeeds,
          tablesWithAllRecords,
          linkEdges,
          ctx: execCtx,
        });
        const growth = this.findRecordSetGrowth(recordSets, nextRecordSets);
        growth.forEach((tid) => {
          enqueueConditional(tid);
          enqueueLinkDependents(tid);
        });
        recordSets = nextRecordSets;
      }
    }

    for (const [tid, group] of Object.entries(impact)) {
      const raw = recordSets[tid];
      if (raw === ALL_RECORDS) {
        group.preferAutoNumberPaging = true;
        continue;
      }
      if (raw && raw.size) {
        raw.forEach((id) => group.recordIds.add(id));
      }
    }

    for (const tid of Object.keys(impact)) {
      const g = impact[tid];
      if (!g.fieldIds.size || (!g.recordIds.size && !g.preferAutoNumberPaging)) {
        delete impact[tid];
      }
    }

    return impact;
  }

  private async getFormulaFieldsWithoutDependencies(
    tableId: string,
    excludeFieldIds?: string[]
  ): Promise<string[]> {
    const query = this.knex
      .select({ id: 'f.id' })
      .from({ f: 'field' })
      .leftJoin({ r: 'reference' }, 'r.to_field_id', 'f.id')
      .where('f.table_id', tableId)
      .whereNull('f.deleted_time')
      .where('f.type', FieldType.Formula)
      .andWhere((qb) => {
        qb.whereNull('f.is_lookup').orWhere('f.is_lookup', false);
      })
      .andWhereRaw('COALESCE(f.has_error, false) = false')
      .groupBy('f.id')
      .havingRaw('COUNT(r.from_field_id) = 0');

    if (excludeFieldIds?.length) {
      query.whereNotIn('f.id', excludeFieldIds);
    }

    const sql = query.toQuery();
    const rows = await this.prismaService.txClient().$queryRawUnsafe<{ id: string }[]>(sql);
    return rows.map((row) => row.id).filter(Boolean);
  }

  private addContextFreeFormulasToImpact(
    impact: IComputedImpactByTable,
    tableId: string,
    formulaIds: string[]
  ): void {
    if (!formulaIds.length) return;
    const target = (impact[tableId] ||= {
      fieldIds: new Set<string>(),
      recordIds: new Set<string>(),
    });
    for (const id of formulaIds) {
      target.fieldIds.add(id);
    }
  }

  /**
   * Collect impacted computed fields grouped by table, and the associated recordIds to re-evaluate.
   * - Same-table computed fields: impacted recordIds are the updated records themselves.
   * - Cross-table computed fields (via link/lookup/rollup): impacted records are those linking to
   *   the changed records through any link field on the target table that points to the changed table.
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  async collect(
    tableId: string,
    ctxs: ICellContext[],
    excludeFieldIds?: string[]
  ): Promise<IComputedCollectResult> {
    if (!ctxs.length) {
      return { impact: {}, tableDomains: new Map<string, TableDomain>() };
    }

    const changedFieldIds = Array.from(new Set(ctxs.map((c) => c.fieldId)));
    const changedRecordIds = Array.from(new Set(ctxs.map((c) => c.recordId)));
    const fieldToTableMap = new Map<string, string>();
    changedFieldIds.forEach((fid) => fieldToTableMap.set(fid, tableId));
    const relatedTables = await this.tableDomainQueryService.getAllRelatedTableDomains(
      tableId,
      changedFieldIds
    );
    const execCtx = this.createExecutionContext(relatedTables.tableDomains);

    // 1) Transitive dependents grouped by table (SQL CTE + join field)
    const contextByRecord = ctxs.reduce<Map<string, ICellContext[]>>((map, ctx) => {
      const list = map.get(ctx.recordId);
      if (list) {
        list.push(ctx);
      } else {
        map.set(ctx.recordId, [ctx]);
      }
      return map;
    }, new Map());

    const relatedLinkIds = await this.resolveRelatedLinkFieldIds(
      changedFieldIds,
      fieldToTableMap,
      execCtx
    );
    const traversalFieldIds = Array.from(new Set([...changedFieldIds, ...relatedLinkIds]));

    const depByTable = await this.collectDependentFieldsByTable(traversalFieldIds, excludeFieldIds);
    const impact: IComputedImpactByTable = Object.entries(depByTable).reduce((acc, [tid, fset]) => {
      acc[tid] = { fieldIds: new Set(fset), recordIds: new Set<string>() };
      return acc;
    }, {} as IComputedImpactByTable);

    // Additionally: include lookup/rollup fields that directly reference any changed link fields
    // (or their symmetric counterparts). This ensures cross-table lookups update when links change.
    const fallbackLookupIds = new Set<string>();
    if (relatedLinkIds.length) {
      const byTable = await this.findLookupsByLinkIds(relatedLinkIds);
      for (const [tid, fset] of Object.entries(byTable)) {
        const group = (impact[tid] ||= {
          fieldIds: new Set<string>(),
          recordIds: new Set<string>(),
        });
        fset.forEach((fid) => {
          if (!group.fieldIds.has(fid)) {
            group.fieldIds.add(fid);
            fallbackLookupIds.add(fid);
          }
        });
      }
    }

    if (fallbackLookupIds.size) {
      // Legacy compatibility: some lookup records were created when linkFieldId was
      // not persisted in reference graph, so we back-fill their dependents via traversal.
      const extraDeps = await this.collectDependentFieldsByTable(
        Array.from(fallbackLookupIds),
        excludeFieldIds
      );
      for (const [tid, fset] of Object.entries(extraDeps)) {
        const group = (impact[tid] ||= {
          fieldIds: new Set<string>(),
          recordIds: new Set<string>(),
        });
        fset.forEach((fid) => group.fieldIds.add(fid));
      }
    }

    // Include symmetric link fields (if any) on the foreign table so their values
    // are refreshed as well. The link fields themselves are already included by
    // SQL union in collectDependentFieldsByTable.
    const changedFieldIdSet = new Set(changedFieldIds);
    const currentTableDomain = await this.getTableDomain(tableId, execCtx);
    const linkFields = currentTableDomain.fieldList.filter(
      (field) => changedFieldIdSet.has(field.id) && field.type === FieldType.Link && !field.isLookup
    );

    // Record planned foreign recordIds per foreign table based on incoming link cell new/old values
    const plannedForeignRecordIds: Record<string, Set<string>> = {};

    for (const lf of linkFields) {
      type ILinkOptionsWithSymmetric = ILinkFieldOptions & { symmetricFieldId?: string };
      const optsLoose = this.parseOptionsLoose<ILinkOptionsWithSymmetric>(lf.options);
      const foreignTableId = optsLoose?.foreignTableId;
      const symmetricFieldId = optsLoose?.symmetricFieldId;

      // If symmetric, ensure foreign table symmetric field is included; recordIds
      // for foreign table will be determined by BFS propagation below.
      if (foreignTableId && symmetricFieldId) {
        (impact[foreignTableId] ||= {
          fieldIds: new Set<string>(),
          recordIds: new Set<string>(),
        }).fieldIds.add(symmetricFieldId);

        // Also pre-seed foreign impacted recordIds using planned link targets
        // Extract ids from both oldValue and newValue to cover add/remove
        const targetIds = new Set<string>();
        for (const ctx of ctxs) {
          if (ctx.fieldId !== lf.id) continue;
          const toIds = (v: unknown) => {
            if (!v) return [] as string[];
            const arr = Array.isArray(v) ? v : [v];
            return arr
              .map((x) => (x && typeof x === 'object' ? (x as { id?: string }).id : undefined))
              .filter((id): id is string => !!id);
          };
          toIds(ctx.oldValue).forEach((id) => targetIds.add(id));
          toIds(ctx.newValue).forEach((id) => targetIds.add(id));
        }
        if (targetIds.size) {
          const set = (plannedForeignRecordIds[foreignTableId] ||= new Set<string>());
          targetIds.forEach((id) => set.add(id));
        }
      }
    }
    const contextFreeFormulaIds = await this.getFormulaFieldsWithoutDependencies(
      tableId,
      excludeFieldIds
    );
    this.addContextFreeFormulasToImpact(impact, tableId, contextFreeFormulaIds);

    if (!Object.keys(impact).length) {
      return { impact: {}, tableDomains: new Map(relatedTables.tableDomains) };
    }

    const impactedTables = new Set([...Object.keys(impact), tableId]);
    for (const [tid, ids] of Object.entries(plannedForeignRecordIds)) {
      if (!impactedTables.has(tid)) {
        impactedTables.add(tid);
      }
    }

    const linkEdges = await this.buildLinkEdgesForTables(
      impactedTables,
      relatedTables.tableDomains,
      execCtx
    );
    const explicitSeeds = new Map<string, Set<string>>();
    explicitSeeds.set(tableId, new Set(changedRecordIds));
    for (const [tid, ids] of Object.entries(plannedForeignRecordIds)) {
      if (!ids.size) continue;
      explicitSeeds.set(tid, new Set(ids));
    }
    const tablesWithAllRecords = new Set<string>();

    const { link: linkAdj, conditionalRollup: referenceAdj } = await this.getAdjacencyMaps(
      Array.from(impactedTables),
      execCtx
    );

    let recordSets = await this.computeLinkClosure({
      impactedTables,
      explicitSeeds,
      tablesWithAllRecords,
      linkEdges,
      tableDomains: relatedTables.tableDomains,
      ctx: execCtx,
    });

    const queue: string[] = [];
    const queued = new Set<string>();
    const enqueueConditional = (tableId: string) => {
      if (!tableId || queued.has(tableId)) {
        return;
      }
      queued.add(tableId);
      queue.push(tableId);
    };
    const enqueueLinkDependents = (tableId: string) => {
      const targets = linkAdj[tableId];
      if (!targets) return;
      targets.forEach((tid) => enqueueConditional(tid));
    };

    const initialGrowth = this.findRecordSetGrowth({}, recordSets);
    initialGrowth.forEach((tid) => {
      enqueueConditional(tid);
      enqueueLinkDependents(tid);
    });
    const materializedAllRecords = new Map<string, string[]>();

    while (queue.length) {
      const src = queue.shift()!;
      queued.delete(src);

      const referenceEdges = (referenceAdj[src] || []).filter((edge) => {
        const targetGroup = impact[edge.tableId];
        return !!targetGroup && targetGroup.fieldIds.has(edge.fieldId);
      });
      if (!referenceEdges.length) {
        continue;
      }

      const rawSet = recordSets[src];
      if (!rawSet) {
        continue;
      }

      let currentIds: string[] = [];
      let shouldMaterializeAllRecords = false;
      if (rawSet === ALL_RECORDS) {
        const needsMaterialization = referenceEdges.some((edge) => {
          const targetSet = recordSets[edge.tableId];
          return targetSet !== ALL_RECORDS && edge.tableId !== src;
        });
        shouldMaterializeAllRecords = needsMaterialization;
        if (shouldMaterializeAllRecords) {
          currentIds = await this.materializeAllRecordIds(src, materializedAllRecords, execCtx);
        }
      } else {
        currentIds = Array.from(rawSet);
      }
      if (!currentIds.length && shouldMaterializeAllRecords) {
        continue;
      }

      const eagerReferenceMatches: Array<{
        edge: IConditionalRollupAdjacencyEdge;
        matched: typeof ALL_RECORDS;
      }> = [];
      const referencePromises: Array<
        Promise<{ edge: IConditionalRollupAdjacencyEdge; matched: string[] | typeof ALL_RECORDS }>
      > = [];
      for (const edge of referenceEdges) {
        const targetGroup = impact[edge.tableId];
        if (!targetGroup || !targetGroup.fieldIds.has(edge.fieldId)) continue;
        if (
          rawSet === ALL_RECORDS &&
          (!shouldMaterializeAllRecords ||
            recordSets[edge.tableId] === ALL_RECORDS ||
            edge.tableId === src)
        ) {
          eagerReferenceMatches.push({ edge, matched: ALL_RECORDS });
          continue;
        }
        if (!currentIds.length) continue;
        const context = src === tableId ? contextByRecord : undefined;
        referencePromises.push(
          this.getConditionalRollupImpactedRecordIds(edge, currentIds, context, execCtx).then(
            (matched) => ({
              edge,
              matched,
            })
          )
        );
      }

      const referenceResults = [
        ...eagerReferenceMatches,
        ...(await Promise.all(referencePromises)),
      ];

      let dirty = false;
      for (const { edge, matched } of referenceResults) {
        const targetGroup = impact[edge.tableId];
        if (!targetGroup || !targetGroup.fieldIds.has(edge.fieldId)) continue;
        if (matched === ALL_RECORDS) {
          const updated = this.markAllSeed(tablesWithAllRecords, edge.tableId);
          if (updated) {
            targetGroup.preferAutoNumberPaging = true;
            dirty = true;
            enqueueConditional(edge.tableId);
            enqueueLinkDependents(edge.tableId);
          }
          continue;
        }
        if (!matched.length) continue;
        const updated = this.addExplicitSeed(explicitSeeds, edge.tableId, matched);
        if (updated) {
          dirty = true;
          enqueueConditional(edge.tableId);
          enqueueLinkDependents(edge.tableId);
        }
      }

      if (dirty) {
        const nextRecordSets = await this.computeLinkClosure({
          impactedTables,
          explicitSeeds,
          tablesWithAllRecords,
          linkEdges,
          tableDomains: relatedTables.tableDomains,
          ctx: execCtx,
        });
        const growth = this.findRecordSetGrowth(recordSets, nextRecordSets);
        growth.forEach((tid) => {
          enqueueConditional(tid);
          enqueueLinkDependents(tid);
        });
        recordSets = nextRecordSets;
      }
    }

    for (const [tid, group] of Object.entries(impact)) {
      const raw = recordSets[tid];
      if (raw === ALL_RECORDS) {
        group.preferAutoNumberPaging = true;
        continue;
      }
      if (raw && raw.size) {
        raw.forEach((id) => group.recordIds.add(id));
      }
    }

    return { impact, tableDomains: new Map(relatedTables.tableDomains) };
  }
}
