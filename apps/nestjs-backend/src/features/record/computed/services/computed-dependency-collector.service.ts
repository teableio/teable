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
} from '@teable/core';
import { DbFieldType, FieldType, isFieldReferenceValue } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { InjectDbProvider } from '../../../../db-provider/db.provider';
import { IDbProvider } from '../../../../db-provider/db.provider.interface';
import type { ICellContext } from '../../../calculation/utils/changes';
import { createFieldInstanceByRaw } from '../../../field/model/factory';

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

const ALL_RECORDS = Symbol('ALL_RECORDS');
const MAX_CONDITIONAL_ROLLUP_SAMPLE = 10_000;

@Injectable()
export class ComputedDependencyCollectorService {
  private logger = new Logger(ComputedDependencyCollectorService.name);
  constructor(
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectDbProvider() private readonly dbProvider: IDbProvider
  ) {}

  private async getDbTableName(tableId: string): Promise<string> {
    const { dbTableName } = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });
    return dbTableName;
  }

  private async getAllRecordIds(tableId: string): Promise<string[]> {
    const dbTable = await this.getDbTableName(tableId);
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
    fieldIds: Iterable<string>
  ): Promise<Map<string, FieldCore>> {
    const ids = Array.from(new Set(Array.from(fieldIds).filter(Boolean)));
    if (!ids.length) {
      return new Map();
    }

    const rows = await this.prismaService.txClient().field.findMany({
      where: { tableId, id: { in: ids }, deletedTime: null },
    });

    const map = new Map<string, FieldCore>();
    for (const row of rows) {
      const instance = createFieldInstanceByRaw(row) as unknown as FieldCore;
      map.set(instance.id, instance);
    }
    return map;
  }

  private async resolveConditionalSortDependents(
    sortFieldIds: readonly string[]
  ): Promise<Array<{ tableId: string; fieldId: string; sortFieldId: string }>> {
    if (!sortFieldIds.length) return [];

    const prisma = this.prismaService.txClient();
    const sortIdSet = new Set(sortFieldIds);
    const results: Array<{ tableId: string; fieldId: string; sortFieldId: string }> = [];

    const [conditionalRollups, conditionalLookups] = await Promise.all([
      prisma.field.findMany({
        where: { deletedTime: null, type: FieldType.ConditionalRollup },
        select: { id: true, tableId: true, options: true },
      }),
      prisma.field.findMany({
        where: { deletedTime: null, isConditionalLookup: true },
        select: { id: true, tableId: true, lookupOptions: true },
      }),
    ]);

    for (const row of conditionalRollups) {
      const options = this.parseOptionsLoose<IConditionalRollupFieldOptions>(row.options);
      const sortFieldId = options?.sort?.fieldId;
      if (sortFieldId && sortIdSet.has(sortFieldId)) {
        results.push({ tableId: row.tableId, fieldId: row.id, sortFieldId });
      }
    }

    for (const row of conditionalLookups) {
      const options = this.parseOptionsLoose<IConditionalLookupOptions>(row.lookupOptions);
      const sortFieldId = options?.sort?.fieldId;
      if (sortFieldId && sortIdSet.has(sortFieldId)) {
        results.push({ tableId: row.tableId, fieldId: row.id, sortFieldId });
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
  private async resolveRelatedLinkFieldIds(fieldIds: string[]): Promise<string[]> {
    if (!fieldIds.length) return [];
    const rows = await this.prismaService.txClient().field.findMany({
      where: { id: { in: fieldIds }, type: FieldType.Link, isLookup: null, deletedTime: null },
      select: { id: true, options: true },
    });
    const result = new Set<string>();
    for (const r of rows) {
      result.add(r.id);
      const opts = this.parseOptionsLoose<{ symmetricFieldId?: string }>(r.options);
      if (opts?.symmetricFieldId) result.add(opts.symmetricFieldId);
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

  /**
   * Given a table (targetTableId) and the changed table (changedTableId),
   * return recordIds in targetTableId that link to any of changedRecordIds via any link field.
   */
  private async getLinkedRecordIds(
    targetTableId: string,
    changedTableId: string,
    changedRecordIds: string[]
  ): Promise<string[]> {
    if (!changedRecordIds.length) return [];

    // Fetch link fields on targetTableId that point to changedTableId
    const linkFields = await this.prismaService.txClient().field.findMany({
      where: {
        tableId: targetTableId,
        type: FieldType.Link,
        isLookup: null,
        deletedTime: null,
      },
      select: { id: true, options: true },
    });
    // Build a UNION query across all matching link junction tables
    const selects = [] as Knex.QueryBuilder[];
    for (const lf of linkFields) {
      const opts = this.parseLinkOptions(lf.options);
      if (!opts || opts.foreignTableId !== changedTableId) continue;
      const { fkHostTableName, selfKeyName, foreignKeyName } = opts;
      selects.push(
        this.knex(fkHostTableName)
          .select({ id: selfKeyName })
          .whereIn(foreignKeyName, changedRecordIds)
          .whereNotNull(selfKeyName)
          .whereNotNull(foreignKeyName)
      );
    }

    if (!selects.length) return [];

    const unionQuery = this.knex.queryBuilder().union(selects);
    const finalQuery = this.knex.select('id').from(unionQuery.as('u')).distinct('id').toQuery();
    const rows = await this.prismaService.txClient().$queryRawUnsafe<{ id: string }[]>(finalQuery);
    return rows.map((r) => r.id).filter(Boolean);
  }

  private async getConditionalRollupImpactedRecordIds(
    edge: IConditionalRollupAdjacencyEdge,
    foreignRecordIds: string[],
    changeContextMap?: Map<string, ICellContext[]>
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
    const hostFieldMap = await this.loadFieldInstances(edge.tableId, uniqueHostFieldIds);
    if (hostFieldMap.size !== uniqueHostFieldIds.length) {
      return ALL_RECORDS;
    }

    const foreignFieldMap = await this.loadFieldInstances(edge.foreignTableId, foreignFieldIds);
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

    const hostTableName = await this.getDbTableName(edge.tableId);
    const foreignTableName = await this.getDbTableName(edge.foreignTableId);

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
  private async getAdjacencyMaps(tables: string[]): Promise<{
    link: Record<string, Set<string>>;
    conditionalRollup: Record<string, IConditionalRollupAdjacencyEdge[]>;
  }> {
    const linkAdj: Record<string, Set<string>> = {};
    const conditionalRollupAdj: Record<string, IConditionalRollupAdjacencyEdge[]> = {};

    if (!tables.length) {
      return { link: linkAdj, conditionalRollup: conditionalRollupAdj };
    }

    const linkFields = await this.prismaService.txClient().field.findMany({
      where: {
        tableId: { in: tables },
        type: FieldType.Link,
        isLookup: null,
        deletedTime: null,
      },
      select: { id: true, tableId: true, options: true },
    });

    for (const lf of linkFields) {
      const opts = this.parseLinkOptions(lf.options);
      if (!opts) continue;
      const from = opts.foreignTableId;
      const to = lf.tableId;
      if (!from || !to) continue;
      (linkAdj[from] ||= new Set<string>()).add(to);
    }

    const conditionalReferenceFields = await this.prismaService.txClient().field.findMany({
      where: {
        tableId: { in: tables },
        deletedTime: null,
        OR: [
          { type: FieldType.ConditionalRollup },
          { AND: [{ isLookup: true }, { isConditionalLookup: true }] },
        ],
      },
      select: {
        id: true,
        tableId: true,
        options: true,
        lookupOptions: true,
        type: true,
        isConditionalLookup: true,
      },
    });

    for (const field of conditionalReferenceFields) {
      if (field.type === FieldType.ConditionalRollup) {
        const opts = this.parseOptionsLoose<IConditionalRollupFieldOptions>(field.options);
        const foreignTableId = opts?.foreignTableId;
        if (!foreignTableId) continue;
        (conditionalRollupAdj[foreignTableId] ||= []).push({
          tableId: field.tableId,
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
          tableId: field.tableId,
          fieldId: field.id,
          foreignTableId,
          filter: opts?.filter ?? undefined,
        });
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
    const startFieldIds = Array.from(new Set(sources.flatMap((s) => s.fieldIds || [])));
    if (!startFieldIds.length) return {};

    // Group starting fields by table and fetch minimal metadata
    const startFields = await this.prismaService.txClient().field.findMany({
      where: { id: { in: startFieldIds }, deletedTime: null },
      select: { id: true, tableId: true, isComputed: true, isLookup: true, type: true },
    });
    const byTable = startFields.reduce<Record<string, string[]>>((acc, f) => {
      (acc[f.tableId] ||= []).push(f.id);
      return acc;
    }, {});

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

    if (!Object.keys(impact).length) return {};

    // 2) Seed recordIds for origin tables with ALL record ids
    const originTableIds = Object.keys(byTable);
    const recordSets: Record<string, Set<string> | typeof ALL_RECORDS> = {};
    for (const tid of originTableIds) {
      recordSets[tid] = ALL_RECORDS;
      const group = impact[tid];
      if (group) group.preferAutoNumberPaging = true;
    }

    // 3) Build adjacency among impacted + origin tables and propagate via links
    const tablesForAdjacency = Array.from(new Set([...Object.keys(impact), ...originTableIds]));
    const { link: linkAdj, conditionalRollup: referenceAdj } =
      await this.getAdjacencyMaps(tablesForAdjacency);

    const queue: string[] = [...originTableIds];
    const expandedAllRecords = new Set<string>();
    while (queue.length) {
      const src = queue.shift()!;
      const rawSet = recordSets[src];
      const startedWithAllRecords = rawSet === ALL_RECORDS;
      if (startedWithAllRecords && expandedAllRecords.has(src)) {
        continue;
      }
      const linkTargets = Array.from(linkAdj[src] || []).filter((dst) => !!impact[dst]);
      const referenceEdges = (referenceAdj[src] || []).filter((edge) => {
        const targetGroup = impact[edge.tableId];
        return !!targetGroup && targetGroup.fieldIds.has(edge.fieldId);
      });
      const hasRelevantOutgoing = linkTargets.length > 0 || referenceEdges.length > 0;

      let currentIds: string[] = [];
      let shouldMaterializeAllRecords = false;
      if (rawSet === ALL_RECORDS) {
        if (!hasRelevantOutgoing) {
          expandedAllRecords.add(src);
          continue;
        }
        const edgesRequiringIds = referenceEdges.filter((edge) => {
          const targetSet = recordSets[edge.tableId];
          return targetSet !== ALL_RECORDS && edge.tableId !== src;
        });
        shouldMaterializeAllRecords = linkTargets.length > 0 || edgesRequiringIds.length > 0;
        if (shouldMaterializeAllRecords) {
          const ids = await this.getAllRecordIds(src);
          currentIds = ids;
          recordSets[src] = new Set(ids);
        }
      } else if (rawSet) {
        currentIds = Array.from(rawSet);
      }
      if (!currentIds.length && shouldMaterializeAllRecords) continue;

      for (const dst of linkTargets) {
        const linked = await this.getLinkedRecordIds(dst, src, currentIds);
        if (!linked.length) continue;
        const existingDst = recordSets[dst];
        if (existingDst === ALL_RECORDS) {
          continue;
        }
        let set = existingDst;
        if (!set) {
          set = new Set<string>();
          recordSets[dst] = set;
        }
        let added = false;
        for (const id of linked) {
          if (!set.has(id)) {
            set.add(id);
            added = true;
          }
        }
        if (added) queue.push(dst);
      }

      for (const edge of referenceEdges) {
        const targetGroup = impact[edge.tableId];
        if (!targetGroup || !targetGroup.fieldIds.has(edge.fieldId)) continue;
        let matched: string[] | typeof ALL_RECORDS;
        if (
          rawSet === ALL_RECORDS &&
          (!shouldMaterializeAllRecords ||
            recordSets[edge.tableId] === ALL_RECORDS ||
            edge.tableId === src)
        ) {
          matched = ALL_RECORDS;
        } else {
          if (!currentIds.length) continue;
          matched = await this.getConditionalRollupImpactedRecordIds(edge, currentIds);
        }
        if (matched === ALL_RECORDS) {
          targetGroup.preferAutoNumberPaging = true;
          if (recordSets[edge.tableId] !== ALL_RECORDS) {
            recordSets[edge.tableId] = ALL_RECORDS;
          }
          if (!expandedAllRecords.has(edge.tableId)) {
            queue.push(edge.tableId);
          }
          continue;
        }
        if (!matched.length) continue;
        const currentTargetSet = recordSets[edge.tableId];
        if (currentTargetSet === ALL_RECORDS) {
          continue;
        }
        let set = currentTargetSet;
        if (!set) {
          set = new Set<string>();
          recordSets[edge.tableId] = set;
        }
        let added = false;
        for (const id of matched) {
          if (!set.has(id)) {
            set.add(id);
            added = true;
          }
        }
        if (added) queue.push(edge.tableId);
      }
      if (startedWithAllRecords) {
        expandedAllRecords.add(src);
      }
    }

    // 4) Assign recordIds into impact
    for (const [tid, group] of Object.entries(impact)) {
      const raw = recordSets[tid];
      if (raw === ALL_RECORDS) {
        group.preferAutoNumberPaging = true;
        continue;
      }
      if (raw && raw.size) raw.forEach((id) => group.recordIds.add(id));
    }

    // Remove tables with no records or fields after filtering
    for (const tid of Object.keys(impact)) {
      const g = impact[tid];
      if (!g.fieldIds.size || (!g.recordIds.size && !g.preferAutoNumberPaging)) delete impact[tid];
    }

    return impact;
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
  ): Promise<IComputedImpactByTable> {
    if (!ctxs.length) return {};

    const changedFieldIds = Array.from(new Set(ctxs.map((c) => c.fieldId)));
    const changedRecordIds = Array.from(new Set(ctxs.map((c) => c.recordId)));

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

    const relatedLinkIds = await this.resolveRelatedLinkFieldIds(changedFieldIds);
    const traversalFieldIds = Array.from(new Set([...changedFieldIds, ...relatedLinkIds]));

    const depByTable = await this.collectDependentFieldsByTable(traversalFieldIds, excludeFieldIds);
    const impact: IComputedImpactByTable = Object.entries(depByTable).reduce((acc, [tid, fset]) => {
      acc[tid] = { fieldIds: new Set(fset), recordIds: new Set<string>() };
      return acc;
    }, {} as IComputedImpactByTable);

    // Additionally: include lookup/rollup fields that directly reference any changed link fields
    // (or their symmetric counterparts). This ensures cross-table lookups update when links change.
    if (relatedLinkIds.length) {
      const byTable = await this.findLookupsByLinkIds(relatedLinkIds);
      for (const [tid, fset] of Object.entries(byTable)) {
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
    const linkFields = await this.prismaService.txClient().field.findMany({
      where: {
        id: { in: changedFieldIds },
        type: FieldType.Link,
        isLookup: null,
        deletedTime: null,
      },
      select: { id: true, tableId: true, options: true },
    });

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
    if (!Object.keys(impact).length) return {};

    // 3) Compute impacted recordIds per table with multi-hop propagation
    // Seed with origin changed records
    const recordSets: Record<string, Set<string> | typeof ALL_RECORDS> = {
      [tableId]: new Set(changedRecordIds),
    };
    // Seed foreign tables with planned link targets so impact includes them even before DB write
    for (const [tid, ids] of Object.entries(plannedForeignRecordIds)) {
      if (!ids.size) continue;
      const currentSet = recordSets[tid];
      if (currentSet === ALL_RECORDS) {
        continue;
      }
      let set = currentSet;
      if (!set) {
        set = new Set<string>();
        recordSets[tid] = set;
      }
      ids.forEach((id) => set.add(id));
    }
    // Build adjacency restricted to impacted tables + origin
    const impactedTables = Array.from(new Set([...Object.keys(impact), tableId]));
    const { link: linkAdj, conditionalRollup: referenceAdj } =
      await this.getAdjacencyMaps(impactedTables);

    // BFS-like propagation over table graph
    const queue: string[] = [tableId];
    const expandedAllRecords = new Set<string>();
    while (queue.length) {
      const src = queue.shift()!;
      const rawSet = recordSets[src];
      const startedWithAllRecords = rawSet === ALL_RECORDS;
      if (startedWithAllRecords && expandedAllRecords.has(src)) {
        continue;
      }
      const linkTargets = Array.from(linkAdj[src] || []).filter((dst) => !!impact[dst]);
      const referenceEdges = (referenceAdj[src] || []).filter((edge) => {
        const targetGroup = impact[edge.tableId];
        return !!targetGroup && targetGroup.fieldIds.has(edge.fieldId);
      });
      const hasRelevantOutgoing = linkTargets.length > 0 || referenceEdges.length > 0;

      let currentIds: string[] = [];
      let shouldMaterializeAllRecords = false;
      if (rawSet === ALL_RECORDS) {
        if (!hasRelevantOutgoing) {
          expandedAllRecords.add(src);
          continue;
        }
        const edgesRequiringIds = referenceEdges.filter((edge) => {
          const targetSet = recordSets[edge.tableId];
          return targetSet !== ALL_RECORDS && edge.tableId !== src;
        });
        shouldMaterializeAllRecords = linkTargets.length > 0 || edgesRequiringIds.length > 0;
        if (shouldMaterializeAllRecords) {
          const ids = await this.getAllRecordIds(src);
          currentIds = ids;
          recordSets[src] = new Set(ids);
        }
      } else if (rawSet) {
        currentIds = Array.from(rawSet);
      }
      if (!currentIds.length && shouldMaterializeAllRecords) continue;

      for (const dst of linkTargets) {
        const linked = await this.getLinkedRecordIds(dst, src, currentIds);
        if (!linked.length) continue;
        const existingDst = recordSets[dst];
        if (existingDst === ALL_RECORDS) {
          continue;
        }
        let set = existingDst;
        if (!set) {
          set = new Set<string>();
          recordSets[dst] = set;
        }
        let added = false;
        for (const id of linked) {
          if (!set.has(id)) {
            set.add(id);
            added = true;
          }
        }
        if (added) queue.push(dst);
      }

      for (const edge of referenceEdges) {
        const targetGroup = impact[edge.tableId];
        if (!targetGroup || !targetGroup.fieldIds.has(edge.fieldId)) continue;
        let matched: string[] | typeof ALL_RECORDS;
        if (
          rawSet === ALL_RECORDS &&
          (!shouldMaterializeAllRecords ||
            recordSets[edge.tableId] === ALL_RECORDS ||
            edge.tableId === src)
        ) {
          matched = ALL_RECORDS;
        } else {
          if (!currentIds.length) continue;
          matched = await this.getConditionalRollupImpactedRecordIds(
            edge,
            currentIds,
            src === tableId ? contextByRecord : undefined
          );
        }
        if (matched === ALL_RECORDS) {
          targetGroup.preferAutoNumberPaging = true;
          if (recordSets[edge.tableId] !== ALL_RECORDS) {
            recordSets[edge.tableId] = ALL_RECORDS;
          }
          if (!expandedAllRecords.has(edge.tableId)) {
            queue.push(edge.tableId);
          }
          continue;
        }
        if (!matched.length) continue;
        const currentTargetSet = recordSets[edge.tableId];
        if (currentTargetSet === ALL_RECORDS) {
          continue;
        }
        let set = currentTargetSet;
        if (!set) {
          set = new Set<string>();
          recordSets[edge.tableId] = set;
        }
        let added = false;
        for (const id of matched) {
          if (!set.has(id)) {
            set.add(id);
            added = true;
          }
        }
        if (added) queue.push(edge.tableId);
      }
      if (startedWithAllRecords) {
        expandedAllRecords.add(src);
      }
    }

    // Assign results into impact
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

    return impact;
  }
}
