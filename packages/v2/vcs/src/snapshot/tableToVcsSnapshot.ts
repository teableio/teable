import {
  FieldKeyType,
  FieldOptionsDtoVisitor,
  GetViewSnapshotsQuery,
  ListTableRecordsQuery,
  MAX_RECORDS_LIMIT,
  projectViewForQuery,
  type ConditionalLookupField,
  type ConditionalRollupField,
  type DomainError,
  type Field,
  type GetViewSnapshotsResult,
  type IExecutionContext,
  type IQueryBus,
  type LinkField,
  type ListTableRecordsResult,
  type LookupField,
  type RecordQueryPluginScope,
  type RollupField,
  type Table,
  type TableRecordReadModel,
} from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';

import {
  canonicalizeRecord,
  canonicalizeTable,
  sortFieldsCanonically,
  sortViewsCanonically,
} from '../domain/fieldClassification';
import type {
  IFieldVcsSnapshot,
  IRecordVcsSnapshot,
  ITableVcsSnapshot,
  IVcsCloneRecordsChunk,
  IViewVcsSnapshot,
} from '../domain/types';

const SELECTED_RECORD_BATCH_SIZE = 500;
export const DEFAULT_CLONE_RECORDS_CHUNK_SIZE = 500;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const stripEmptyObject = (
  obj: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (!obj) {
    return undefined;
  }
  return Object.keys(obj).length > 0 ? obj : undefined;
};

const extractLookupFieldOptions = (
  field: LookupField | ConditionalLookupField,
  isConditional: boolean
): Record<string, unknown> => {
  const opts: Record<string, unknown> = isConditional
    ? { ...(field as ConditionalLookupField).conditionalLookupOptionsDto() }
    : { ...(field as LookupField).lookupOptionsDto() };
  const innerPatch = field.innerOptionsPatch();
  if (innerPatch !== undefined) {
    opts.innerOptions = innerPatch;
  }
  const multRes = field.isMultipleCellValue();
  if (multRes.isOk()) {
    opts.isMultipleCellValue = multRes.value.toBoolean();
  }
  return opts;
};

const extractRollupFieldOptions = (
  field: RollupField | ConditionalRollupField,
  baseOpts: Record<string, unknown>
): Record<string, unknown> => {
  baseOpts.config = field.configDto();
  const cvt = field.cellValueType();
  if (cvt.isOk()) {
    baseOpts.cellValueType = cvt.value.toString();
  }
  const mult = field.isMultipleCellValue();
  if (mult.isOk()) {
    baseOpts.isMultipleCellValue = mult.value.toBoolean();
  }
  return baseOpts;
};

const extractLinkFieldOptions = (
  field: LinkField
): Result<Record<string, unknown>, DomainError> => {
  const cfgRes = field.configDto();
  if (cfgRes.isErr()) {
    return err(cfgRes.error);
  }
  const cfg = { ...cfgRes.value } as Record<string, unknown>;
  delete cfg.fkHostTableName;
  delete cfg.selfKeyName;
  delete cfg.foreignKeyName;
  return ok(cfg);
};

export const extractFieldVcsOptions = (
  field: Field
): Result<Record<string, unknown> | undefined, DomainError> => {
  const typeStr = field.type().toString();

  if (typeStr === 'lookup') {
    return ok(extractLookupFieldOptions(field as unknown as LookupField, false));
  }

  if (typeStr === 'conditionalLookup') {
    return ok(extractLookupFieldOptions(field as unknown as ConditionalLookupField, true));
  }

  const dtoRes = field.accept(new FieldOptionsDtoVisitor());
  if (dtoRes.isErr()) {
    return err(dtoRes.error);
  }

  const baseOpts = isPlainObject(dtoRes.value) ? { ...dtoRes.value } : {};

  if (typeStr === 'rollup') {
    return ok(extractRollupFieldOptions(field as unknown as RollupField, baseOpts));
  }

  if (typeStr === 'conditionalRollup') {
    return ok(extractRollupFieldOptions(field as unknown as ConditionalRollupField, baseOpts));
  }

  if (typeStr === 'link') {
    return extractLinkFieldOptions(field as unknown as LinkField);
  }

  return ok(stripEmptyObject(baseOpts));
};

export const mapSingleFieldToVcsSnapshot = (
  table: Table,
  field: Field
): Result<IFieldVcsSnapshot, DomainError> => {
  const optionsRes = extractFieldVcsOptions(field);
  if (optionsRes.isErr()) {
    return err(optionsRes.error);
  }

  const typeStr = field.type().toString();
  const options = optionsRes.value;
  const description = field.description();
  const aiConfig = field.aiConfig();
  const notNull = field.notNull().toBoolean();
  const unique = field.unique().toBoolean();

  return ok({
    id: field.id().toString(),
    name: field.name().toString(),
    type: typeStr,
    ...(options !== undefined ? { options } : {}),
    ...(notNull ? { notNull: true } : {}),
    ...(unique ? { unique: true } : {}),
    ...(description ? { description } : {}),
    ...(aiConfig ? { aiConfig } : {}),
    ...(typeStr === 'lookup' ? { isLookup: true } : {}),
    ...(typeStr === 'conditionalLookup' ? { isConditionalLookup: true } : {}),
    isPrimary: field.id().equals(table.primaryFieldId()),
    isComputed: field.computed().toBoolean(),
  });
};

export const mapTableFieldsToVcsSnapshots = (
  table: Table
): Result<IFieldVcsSnapshot[], DomainError> => {
  const fields: IFieldVcsSnapshot[] = [];
  for (const field of table.getFields()) {
    const mapped = mapSingleFieldToVcsSnapshot(table, field);
    if (mapped.isErr()) {
      return err(mapped.error);
    }
    fields.push(mapped.value);
  }
  return ok(sortFieldsCanonically(fields));
};

export interface IViewSnapshotRaw {
  id: string;
  name: string;
  type: string;
  description?: string | null;
  columnMeta: unknown;
  options?: unknown;
  filter?: unknown;
  group?: readonly unknown[];
  sort?: {
    sortObjs?: readonly unknown[];
    manualSort?: boolean;
  };
  order?: number;
}

const buildViewQuerySnapshot = (view: IViewSnapshotRaw): IViewVcsSnapshot['query'] | undefined => {
  const queryObj: NonNullable<IViewVcsSnapshot['query']> = {
    ...(view.filter != null ? { filter: view.filter } : {}),
    ...(view.sort?.sortObjs ? { sort: [...view.sort.sortObjs] } : {}),
    ...(view.group ? { group: [...view.group] } : {}),
    ...(view.sort?.manualSort !== undefined ? { manualSort: view.sort.manualSort } : {}),
  };
  return Object.keys(queryObj).length > 0 ? queryObj : undefined;
};

export const mapSingleViewRawToVcsSnapshot = (view: IViewSnapshotRaw): IViewVcsSnapshot => {
  const query = buildViewQuerySnapshot(view);
  return {
    id: view.id,
    name: view.name,
    type: view.type,
    ...(view.description !== undefined && view.description !== null
      ? { description: view.description }
      : {}),
    columnMeta: view.columnMeta as Record<string, unknown>,
    ...(view.options != null ? { options: view.options as Record<string, unknown> } : {}),
    ...(query ? { query } : {}),
    ...(view.order !== undefined ? { order: view.order } : {}),
  };
};

type VcsDomainView = Table['views'] extends () => ReadonlyArray<infer V> ? V : never;

const mapUnpersistedViewFromDomain = (
  view: VcsDomainView
): Result<IViewVcsSnapshot, DomainError> => {
  const colMetaRes = view.columnMeta();
  if (colMetaRes.isErr()) return err(colMetaRes.error);
  const queryDefaultsRes = view.queryDefaults();
  if (queryDefaultsRes.isErr()) return err(queryDefaultsRes.error);
  const qd = queryDefaultsRes.value;
  const sourceFilter = qd.sourceFilter();
  const sortObjs = qd.sort();
  const manualSort = qd.manualSort();
  const group = qd.group();
  const order = view.order();
  return ok(
    mapSingleViewRawToVcsSnapshot({
      id: view.id().toString(),
      name: view.name().toString(),
      type: view.type().toString(),
      ...(order.isOk() ? { order: order.value.toNumber() } : {}),
      ...(view.description() ? { description: view.description() } : {}),
      ...(view.options() !== undefined ? { options: view.options() } : {}),
      ...(sourceFilter != null ? { filter: sourceFilter } : {}),
      ...(sortObjs !== undefined || manualSort !== undefined
        ? {
            sort: {
              sortObjs: sortObjs ?? [],
              ...(manualSort !== undefined ? { manualSort } : {}),
            },
          }
        : {}),
      ...(group?.length ? { group } : {}),
      columnMeta: colMetaRes.value.toDto(),
    })
  );
};

export const mapSingleViewFromDomain = (
  table: Table,
  view: VcsDomainView
): Result<IViewVcsSnapshot, DomainError> => {
  const projected = projectViewForQuery(table, view);
  if (projected.isOk()) {
    return ok(mapSingleViewRawToVcsSnapshot(projected.value as IViewSnapshotRaw));
  }
  // Newly created domain tables inside same-tx projections do not have ViewAuditMetadata
  // hydrated yet; VCS view snapshots do not store audit metadata, so project core view state directly.
  if (view.auditMetadata().isErr()) {
    return mapUnpersistedViewFromDomain(view);
  }
  return err(projected.error);
};

export const mapTableViewsFromDomain = (table: Table): Result<IViewVcsSnapshot[], DomainError> => {
  const views: IViewVcsSnapshot[] = [];
  for (const view of table.views()) {
    const mapped = mapSingleViewFromDomain(table, view);
    if (mapped.isErr()) {
      return err(mapped.error);
    }
    views.push(mapped.value);
  }
  return ok(sortViewsCanonically(views));
};

export const mapTableViewsToVcsSnapshots = async (
  queryBus: IQueryBus,
  context: IExecutionContext,
  table: Table
): Promise<Result<IViewVcsSnapshot[], DomainError>> => {
  const viewIds = table.views().map((view) => view.id().toString());
  if (viewIds.length === 0) {
    return ok([]);
  }

  const queryRes = GetViewSnapshotsQuery.create({
    tableId: table.id().toString(),
    viewIds,
  });
  if (queryRes.isErr()) {
    return err(queryRes.error);
  }

  const execRes = await queryBus.execute<GetViewSnapshotsQuery, GetViewSnapshotsResult>(
    context,
    queryRes.value
  );
  if (execRes.isErr()) {
    return err(execRes.error);
  }

  return ok(
    sortViewsCanonically(
      execRes.value.snapshots.map((item) => mapSingleViewRawToVcsSnapshot(item.view))
    )
  );
};

export const mapRecordReadModelToVcsSnapshot = (
  rec: TableRecordReadModel,
  includeOrder = true
): IRecordVcsSnapshot => ({
  id: rec.id,
  fields: rec.fields,
  ...(includeOrder && rec.autoNumber !== undefined ? { autoNumber: rec.autoNumber } : {}),
  ...(rec.version !== undefined ? { version: rec.version } : {}),
  ...(includeOrder && rec.orders ? { orders: { ...rec.orders } } : {}),
});

const chunkIds = (items: readonly string[], size: number): string[][] => {
  const chunks: string[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

export const listTableRecordsChunkForVcs = async (params: {
  readonly queryBus: IQueryBus;
  readonly context: IExecutionContext;
  readonly table: Table;
  readonly cursor?: string;
  readonly offset?: number;
  readonly limit?: number;
  readonly queryScope?: RecordQueryPluginScope;
  readonly preserveComputed?: boolean;
}): Promise<Result<IVcsCloneRecordsChunk, DomainError>> => {
  const tableId = params.table.id().toString();
  const limit = Math.min(
    MAX_RECORDS_LIMIT,
    Math.max(1, Math.floor(params.limit ?? DEFAULT_CLONE_RECORDS_CHUNK_SIZE))
  );
  const queryRes = ListTableRecordsQuery.create(
    {
      tableId,
      fieldKeyType: FieldKeyType.Id,
      ignoreViewQuery: true,
      includeOrders: !params.queryScope,
      limit,
      ...(params.cursor !== undefined ? { cursor: params.cursor } : { offset: params.offset ?? 0 }),
    },
    { queryScope: params.queryScope, table: params.table }
  );
  if (queryRes.isErr()) {
    return err(queryRes.error);
  }

  const pageRes = await params.queryBus.execute<ListTableRecordsQuery, ListTableRecordsResult>(
    params.context,
    queryRes.value
  );
  if (pageRes.isErr()) {
    return err(pageRes.error);
  }

  const records = pageRes.value.records.map((rec) =>
    canonicalizeRecord(mapRecordReadModelToVcsSnapshot(rec, !params.queryScope), undefined, {
      preserveComputed: params.preserveComputed ?? true,
    })
  );
  const nextCursor = pageRes.value.nextCursor;
  const hasMore =
    records.length > 0 &&
    Boolean(pageRes.value.hasMore ?? (nextCursor !== undefined || records.length >= limit));

  return ok({
    tableId,
    records,
    ...(hasMore && nextCursor ? { nextCursor } : {}),
    hasMore,
  });
};

export const listAllTableRecordsForVcs = async (
  queryBus: IQueryBus,
  context: IExecutionContext,
  table: Table,
  queryScope?: RecordQueryPluginScope
): Promise<Result<IRecordVcsSnapshot[], DomainError>> => {
  const records: IRecordVcsSnapshot[] = [];
  let cursor: string | undefined;
  let offset = 0;

  for (;;) {
    const chunkRes = await listTableRecordsChunkForVcs({
      queryBus,
      context,
      table,
      ...(cursor !== undefined ? { cursor } : { offset }),
      limit: MAX_RECORDS_LIMIT,
      queryScope,
    });
    if (chunkRes.isErr()) {
      return err(chunkRes.error);
    }

    records.push(...chunkRes.value.records);
    if (!chunkRes.value.hasMore) {
      break;
    }

    if (chunkRes.value.nextCursor && chunkRes.value.nextCursor !== cursor) {
      cursor = chunkRes.value.nextCursor;
      continue;
    }

    if (chunkRes.value.records.length < MAX_RECORDS_LIMIT) {
      break;
    }
    offset += chunkRes.value.records.length;
  }

  return ok(records);
};

export const listSelectedTableRecordsForVcs = async (
  queryBus: IQueryBus,
  context: IExecutionContext,
  table: Table,
  selectedIds: readonly string[],
  queryScope?: RecordQueryPluginScope
): Promise<Result<IRecordVcsSnapshot[], DomainError>> => {
  if (selectedIds.length === 0) {
    return ok([]);
  }

  const tableId = table.id().toString();
  const records: IRecordVcsSnapshot[] = [];

  for (const batch of chunkIds(selectedIds, SELECTED_RECORD_BATCH_SIZE)) {
    const queryRes = ListTableRecordsQuery.create(
      {
        tableId,
        selectedRecordIds: batch,
        fieldKeyType: FieldKeyType.Id,
        ignoreViewQuery: true,
        includeOrders: !queryScope,
        limit: MAX_RECORDS_LIMIT,
        offset: 0,
      },
      { queryScope, table }
    );
    if (queryRes.isErr()) {
      return err(queryRes.error);
    }

    const pageRes = await queryBus.execute<ListTableRecordsQuery, ListTableRecordsResult>(
      context,
      queryRes.value
    );
    if (pageRes.isErr()) {
      return err(pageRes.error);
    }

    for (const rec of pageRes.value.records) {
      records.push(mapRecordReadModelToVcsSnapshot(rec, !queryScope));
    }
  }

  return ok(records);
};

export const buildTableVcsSnapshot = async (params: {
  readonly queryBus: IQueryBus;
  readonly context: IExecutionContext;
  readonly table: Table;
  readonly includeRecords: boolean;
  readonly queryScope?: RecordQueryPluginScope;
}): Promise<Result<ITableVcsSnapshot, DomainError>> => {
  const fieldsRes = mapTableFieldsToVcsSnapshots(params.table);
  if (fieldsRes.isErr()) {
    return err(fieldsRes.error);
  }

  const viewsRes = await mapTableViewsToVcsSnapshots(params.queryBus, params.context, params.table);
  if (viewsRes.isErr()) {
    return err(viewsRes.error);
  }

  let records: IRecordVcsSnapshot[] = [];
  if (params.includeRecords) {
    const recRes = await listAllTableRecordsForVcs(
      params.queryBus,
      params.context,
      params.table,
      params.queryScope
    );
    if (recRes.isErr()) {
      return err(recRes.error);
    }
    records = recRes.value;
  }

  const dbTableNameRes = params.table.dbTableName().andThen((name) => name.value());
  return ok(
    canonicalizeTable(
      {
        id: params.table.id().toString(),
        name: params.table.name().toString(),
        ...(dbTableNameRes.isOk() ? { dbTableName: dbTableNameRes.value } : {}),
        primaryFieldId: params.table.primaryFieldId().toString(),
        fields: fieldsRes.value,
        views: viewsRes.value,
        records,
      },
      { preserveComputed: true }
    )
  );
};
