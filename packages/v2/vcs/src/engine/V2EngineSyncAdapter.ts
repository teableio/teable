import {
  ActorId,
  ApplyRecordOrdersCommand,
  ApplyViewSnapshotCommand,
  CreateBaseCommand,
  CreateFieldCommand,
  CreateTableCommand,
  DeleteFieldCommand,
  DeleteRecordsCommand,
  DeleteTableCommand,
  DeleteViewCommand,
  FieldKeyType,
  FieldOptionsDtoVisitor,
  GetTableByIdQuery,
  GetViewSnapshotsQuery,
  ListBasesQuery,
  ListTableRecordsQuery,
  ListTablesQuery,
  RenameTableCommand,
  RestoreRecordsCommand,
  UpdateFieldCommand,
  UpdateRecordsCommand,
  err,
  ok,
  type ConditionalLookupField,
  type ConditionalRollupField,
  type DomainError,
  type Field,
  type GetTableByIdResult,
  type GetViewSnapshotsResult,
  type ICommandBus,
  type IExecutionContext,
  type IQueryBus,
  type ITableFieldInput,
  type LinkField,
  type ListBasesResult,
  type ListTableRecordsResult,
  type ListTablesResult,
  type LookupField,
  type Result,
  type RollupField,
  type Table,
} from '@teable/v2-core';

import { computeLinkUnlinkPass, isPlainRecordObject as isPlainObject } from '../domain/chunkPatch';
import { diffSnapshots, isEmptyPatch } from '../domain/diffSnapshots';
import { vcsDomainError } from '../domain/errors';
import {
  canonicalizeRecord,
  canonicalizeSnapshot,
  canonicalizeTable,
  deepEqualVcs,
  isStoredVcsField,
  normalizeRecordFields,
  sortFieldsCanonically,
  sortRecordsCanonically,
  sortTablesCanonically,
  sortViewsCanonically,
} from '../domain/fieldClassification';
import type {
  IBaseVcsPatch,
  IBaseVcsSnapshot,
  IFieldVcsSnapshot,
  IRecordVcsSnapshot,
  ITableVcsPatch,
  ITableVcsSnapshot,
  IVcsCloneRecordsChunk,
  IVcsEngineApplyResult,
  IVcsWorkingDelta,
  IViewVcsSnapshot,
} from '../domain/types';
import type { IVcsHydrateRecordChunkResult, IVcsLocalEnginePort } from '../ports';
import {
  listSelectedTableRecordsForVcs,
  listTableRecordsChunkForVcs,
} from '../snapshot/tableToVcsSnapshot';
import { WorkingDirtyTracker, type VcsRawSqlExecutor } from './workingDirtyTracker';

export interface IV2EngineSyncAdapterOptions {
  readonly commandBus: ICommandBus;
  readonly queryBus: IQueryBus;
  readonly actorId?: string;
  readonly executionContext?: IExecutionContext;
  readonly getExecutionContext?: () => IExecutionContext | Promise<IExecutionContext>;
  readonly flushComputed?: () => Promise<unknown>;
  readonly queryRaw?: VcsRawSqlExecutor;
  /** Clone and rollback restore captured storage identities. Ordinary pushes allocate on the server. */
  readonly preserveAutoNumbers?: boolean;
}

export interface IEngineExecutionOptions {
  readonly baseName?: string;
  readonly revision?: number;
  readonly context?: IExecutionContext;
  readonly skipCaptureSnapshot?: boolean;
}

const DEFAULT_ACTOR_ID = 'usr_vcs_sync';
const RECORD_PAGE_SIZE = 500;
const RECORD_BATCH_SIZE = 500;
const BASE_LIST_PAGE_SIZE = 100;

const DEPENDENT_FIELD_TYPES = new Set<string>([
  'link',
  'lookup',
  'conditionalLookup',
  'rollup',
  'conditionalRollup',
  'formula',
]);

function collectLinkFieldMeta(
  table: Table
): Map<string, { notNull: boolean; isMultiple: boolean }> {
  const linkFieldMeta = new Map<string, { notNull: boolean; isMultiple: boolean }>();
  for (const field of table.getFields()) {
    if (field.type().toString() !== 'link') continue;
    const multRes = (field as unknown as LinkField).isMultipleCellValue();
    linkFieldMeta.set(field.id().toString(), {
      notNull: field.notNull().toBoolean(),
      isMultiple: multRes.isOk() ? multRes.value.toBoolean() : false,
    });
  }
  return linkFieldMeta;
}

function partitionSingleRecordUpdate(
  rec: ITableVcsPatch['recordsUpdated'][number],
  linkFieldMeta: Map<string, { notNull: boolean; isMultiple: boolean }>
): { pass1Fields: Record<string, unknown>; pass2Fields: Record<string, unknown> } {
  const pass1Fields: Record<string, unknown> = {};
  const pass2Fields: Record<string, unknown> = {};
  for (const change of rec.cellChanges) {
    const meta = linkFieldMeta.get(change.fieldId);
    if (!meta) {
      pass2Fields[change.fieldId] = change.after ?? null;
      continue;
    }
    const plan = computeLinkUnlinkPass(change.before, change.after, meta.notNull, meta.isMultiple);
    if (plan.hasPass1) pass1Fields[change.fieldId] = plan.pass1Value;
    if (!plan.skipPass2) pass2Fields[change.fieldId] = change.after ?? null;
  }
  return { pass1Fields, pass2Fields };
}

function buildUpdatedRecordBatches(
  table: Table,
  recordsUpdated: ITableVcsPatch['recordsUpdated']
): {
  unlinkBatch: Array<{ id: string; fields: Record<string, unknown> }>;
  finalBatch: Array<{ id: string; fields: Record<string, unknown> }>;
} {
  const linkFieldMeta = collectLinkFieldMeta(table);
  const unlinkBatch: Array<{ id: string; fields: Record<string, unknown> }> = [];
  const finalBatch: Array<{ id: string; fields: Record<string, unknown> }> = [];

  for (const rec of recordsUpdated) {
    const { pass1Fields, pass2Fields } = partitionSingleRecordUpdate(rec, linkFieldMeta);
    if (Object.keys(pass1Fields).length > 0) {
      unlinkBatch.push({ id: rec.recordId, fields: pass1Fields });
    }
    if (Object.keys(pass2Fields).length > 0) {
      finalBatch.push({ id: rec.recordId, fields: pass2Fields });
    }
  }

  return { unlinkBatch, finalBatch };
}

function stripEmptyObject(
  obj: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!obj) {
    return undefined;
  }
  return Object.keys(obj).length > 0 ? obj : undefined;
}

function extractLookupSnapshotOptions(
  field: Field,
  isConditional: boolean
): Record<string, unknown> {
  const lookupLike = field as unknown as LookupField | ConditionalLookupField;
  const opts: Record<string, unknown> = isConditional
    ? { ...(lookupLike as ConditionalLookupField).conditionalLookupOptionsDto() }
    : { ...(lookupLike as LookupField).lookupOptionsDto() };
  const innerPatch = lookupLike.innerOptionsPatch();
  if (innerPatch !== undefined) {
    opts.innerOptions = innerPatch;
  }
  const multRes = lookupLike.isMultipleCellValue();
  if (multRes.isOk()) {
    opts.isMultipleCellValue = multRes.value.toBoolean();
  }
  return opts;
}

function extractRollupSnapshotOptions(
  field: Field,
  baseOpts: Record<string, unknown>
): Record<string, unknown> {
  const rollupLike = field as unknown as RollupField | ConditionalRollupField;
  baseOpts.config = rollupLike.configDto();
  const cvt = rollupLike.cellValueType();
  if (cvt.isOk()) baseOpts.cellValueType = cvt.value.toString();
  const mult = rollupLike.isMultipleCellValue();
  if (mult.isOk()) baseOpts.isMultipleCellValue = mult.value.toBoolean();
  return baseOpts;
}

function extractLinkSnapshotOptions(field: Field): Result<Record<string, unknown>, DomainError> {
  const link = field as unknown as LinkField;
  const cfgRes = link.configDto();
  if (cfgRes.isErr()) return err(cfgRes.error);
  const cfg = { ...cfgRes.value } as Record<string, unknown>;
  delete cfg.fkHostTableName;
  delete cfg.selfKeyName;
  delete cfg.foreignKeyName;
  return ok(cfg);
}

function extractFieldSnapshotOptions(
  field: Field
): Result<Record<string, unknown> | undefined, DomainError> {
  const typeStr = field.type().toString();

  if (typeStr === 'lookup' || typeStr === 'conditionalLookup') {
    return ok(extractLookupSnapshotOptions(field, typeStr === 'conditionalLookup'));
  }

  const dtoRes = field.accept(new FieldOptionsDtoVisitor());
  if (dtoRes.isErr()) {
    return err(dtoRes.error);
  }

  const baseOpts = isPlainObject(dtoRes.value) ? { ...dtoRes.value } : {};

  if (typeStr === 'rollup' || typeStr === 'conditionalRollup') {
    return ok(extractRollupSnapshotOptions(field, baseOpts));
  }

  if (typeStr === 'link') {
    return extractLinkSnapshotOptions(field);
  }

  return ok(stripEmptyObject(baseOpts));
}

function mapDomainFieldToSnapshot(
  table: Table,
  field: Field
): Result<IFieldVcsSnapshot, DomainError> {
  const optsRes = extractFieldSnapshotOptions(field);
  if (optsRes.isErr()) {
    return err(optsRes.error);
  }

  const typeStr = field.type().toString();
  const description = field.description();
  const aiConfig = field.aiConfig();
  const notNull = field.notNull().toBoolean();
  const unique = field.unique().toBoolean();

  return ok({
    id: field.id().toString(),
    name: field.name().toString(),
    type: typeStr,
    ...(optsRes.value !== undefined ? { options: optsRes.value } : {}),
    ...(notNull ? { notNull: true } : {}),
    ...(unique ? { unique: true } : {}),
    ...(description !== null && description !== undefined ? { description } : {}),
    ...(aiConfig !== undefined && aiConfig !== null ? { aiConfig } : {}),
    ...(typeStr === 'lookup' ? { isLookup: true } : {}),
    ...(typeStr === 'conditionalLookup' ? { isConditionalLookup: true } : {}),
    isPrimary: field.id().equals(table.primaryFieldId()),
    isComputed: field.computed().toBoolean(),
  });
}

function pickDefined(
  source: Record<string, unknown>,
  keys: readonly string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

type CoreFieldInputBuilder = (
  common: Record<string, unknown>,
  rawOpts: Record<string, unknown>,
  hostBaseId: string
) => ITableFieldInput;

function buildFormulaCoreInput(
  common: Record<string, unknown>,
  rawOpts: Record<string, unknown>
): ITableFieldInput {
  return {
    ...common,
    options: pickDefined(rawOpts, ['expression', 'timeZone', 'formatting', 'showAs']),
  } as ITableFieldInput;
}

function buildLinkCoreInput(
  common: Record<string, unknown>,
  rawOpts: Record<string, unknown>,
  hostBaseId: string
): ITableFieldInput {
  const linkOpts = pickDefined(rawOpts, [
    'baseId',
    'relationship',
    'foreignTableId',
    'lookupFieldId',
    'isOneWay',
    'symmetricFieldId',
    'filterByViewId',
    'visibleFieldIds',
    'filter',
  ]);
  if (linkOpts.baseId === hostBaseId) {
    delete linkOpts.baseId;
  }
  return {
    ...common,
    options: linkOpts,
  } as ITableFieldInput;
}

function buildRollupCoreInput(
  common: Record<string, unknown>,
  rawOpts: Record<string, unknown>
): ITableFieldInput {
  return {
    ...common,
    options: pickDefined(rawOpts, ['expression', 'timeZone', 'formatting', 'showAs']),
    config: rawOpts.config,
    ...(rawOpts.cellValueType !== undefined ? { cellValueType: rawOpts.cellValueType } : {}),
    ...(rawOpts.isMultipleCellValue !== undefined
      ? { isMultipleCellValue: rawOpts.isMultipleCellValue }
      : {}),
  } as ITableFieldInput;
}

function buildLookupCoreInput(
  common: Record<string, unknown>,
  rawOpts: Record<string, unknown>
): ITableFieldInput {
  return {
    ...common,
    options: pickDefined(rawOpts, [
      'isUnique',
      'linkFieldId',
      'foreignTableId',
      'lookupFieldId',
      'filter',
      'sort',
      'limit',
    ]),
    ...(rawOpts.innerOptions !== undefined ? { innerOptions: rawOpts.innerOptions } : {}),
    ...(rawOpts.isMultipleCellValue !== undefined
      ? { isMultipleCellValue: rawOpts.isMultipleCellValue }
      : {}),
  } as ITableFieldInput;
}

function buildConditionalLookupCoreInput(
  common: Record<string, unknown>,
  rawOpts: Record<string, unknown>
): ITableFieldInput {
  return {
    ...common,
    options: pickDefined(rawOpts, [
      'isUnique',
      'baseId',
      'foreignTableId',
      'lookupFieldId',
      'condition',
    ]),
    ...(rawOpts.innerOptions !== undefined ? { innerOptions: rawOpts.innerOptions } : {}),
    ...(rawOpts.isMultipleCellValue !== undefined
      ? { isMultipleCellValue: rawOpts.isMultipleCellValue }
      : {}),
  } as ITableFieldInput;
}

const CORE_FIELD_INPUT_BUILDERS: Record<string, CoreFieldInputBuilder> = {
  formula: buildFormulaCoreInput,
  link: buildLinkCoreInput,
  rollup: buildRollupCoreInput,
  conditionalRollup: buildRollupCoreInput,
  lookup: buildLookupCoreInput,
  conditionalLookup: buildConditionalLookupCoreInput,
};

function toCoreFieldInput(
  field: IFieldVcsSnapshot,
  hostBaseId: string,
  options?: { allowPrimary?: boolean }
): ITableFieldInput {
  const common: Record<string, unknown> = {
    id: field.id,
    name: field.name,
    type: field.type,
    ...(options?.allowPrimary && field.isPrimary ? { isPrimary: true } : {}),
    ...(field.notNull ? { notNull: true } : {}),
    ...(field.unique ? { unique: true } : {}),
    ...(field.description !== undefined ? { description: field.description } : {}),
    ...(field.aiConfig !== undefined ? { aiConfig: field.aiConfig } : {}),
  };

  const builder = CORE_FIELD_INPUT_BUILDERS[field.type];
  if (builder) {
    const rawOpts = isPlainObject(field.options) ? field.options : {};
    return builder(common, rawOpts, hostBaseId);
  }

  if (field.options !== undefined) {
    common.options = field.options;
  }
  return common as ITableFieldInput;
}

function normalizeViewSortInput(rawQuery: Record<string, unknown>): {
  sortItems?: unknown[];
  manualSort?: unknown;
} {
  const rawSort = rawQuery.sort as unknown;
  let sortItems: unknown[] | undefined;
  let manualSort = rawQuery.manualSort;

  if (Array.isArray(rawSort)) {
    sortItems = rawSort;
  } else if (isPlainObject(rawSort) && Array.isArray(rawSort.sortObjs)) {
    sortItems = rawSort.sortObjs;
    if (manualSort === undefined && typeof rawSort.manualSort === 'boolean') {
      manualSort = rawSort.manualSort;
    }
  }

  return { sortItems, manualSort };
}

function buildViewQueryPayload(rawQuery: Record<string, unknown>): Record<string, unknown> {
  const { sortItems, manualSort } = normalizeViewSortInput(rawQuery);
  const queryPayload: Record<string, unknown> = {};
  if (rawQuery.filter !== undefined && rawQuery.filter !== null) {
    queryPayload.filter = rawQuery.filter;
  }
  if (sortItems !== undefined) {
    queryPayload.sort = sortItems;
  }
  if (Array.isArray(rawQuery.group)) {
    queryPayload.group = rawQuery.group;
  }
  if (typeof manualSort === 'boolean') {
    queryPayload.manualSort = manualSort;
  }
  return queryPayload;
}

function toViewSnapshotCommandPayload(view: IViewVcsSnapshot): Record<string, unknown> {
  return {
    id: view.id,
    name: view.name,
    type: view.type,
    ...(typeof view.order === 'number' ? { order: view.order } : {}),
    properties: {
      ...(typeof view.description === 'string' ? { description: view.description } : {}),
    },
    columnMeta: view.columnMeta ?? {},
    query: buildViewQueryPayload(view.query ?? {}),
    ...(view.options !== undefined && view.options !== null ? { options: view.options } : {}),
  };
}

function assignCommonFieldUpdates(
  before: IFieldVcsSnapshot,
  after: IFieldVcsSnapshot,
  payload: Record<string, unknown>
): void {
  if (before.type !== after.type) payload.type = after.type;
  if (before.name !== after.name) payload.name = after.name;
  if ((before.description ?? null) !== (after.description ?? null)) {
    payload.description = after.description ?? null;
  }
  if (Boolean(before.notNull) !== Boolean(after.notNull)) {
    payload.notNull = Boolean(after.notNull);
  }
  if (Boolean(before.unique) !== Boolean(after.unique)) {
    payload.unique = Boolean(after.unique);
  }
  if (!deepEqualVcs(before.aiConfig ?? null, after.aiConfig ?? null)) {
    payload.aiConfig = after.aiConfig ?? null;
  }
}

function assignFieldOptionsUpdates(
  after: IFieldVcsSnapshot,
  hostBaseId: string,
  payload: Record<string, unknown>
): void {
  const coreInput = toCoreFieldInput(after, hostBaseId) as Record<string, unknown>;
  const optionKeys = [
    'options',
    'config',
    'innerOptions',
    'cellValueType',
    'isMultipleCellValue',
  ] as const;
  for (const key of optionKeys) {
    if (coreInput[key] !== undefined) {
      payload[key] = coreInput[key];
    }
  }
  if (after.type === 'singleSelect' || after.type === 'multipleSelect') {
    payload.updateMode = 'full';
  }
}

function toFieldUpdatePayload(
  before: IFieldVcsSnapshot,
  after: IFieldVcsSnapshot,
  hostBaseId: string
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  assignCommonFieldUpdates(before, after, payload);
  if (before.type !== after.type || !deepEqualVcs(before.options ?? null, after.options ?? null)) {
    assignFieldOptionsUpdates(after, hostBaseId, payload);
  }
  return payload;
}

function isAlreadyExistsError(error: DomainError): boolean {
  const msg = error.message.toLowerCase();
  const code = (error.code ?? '').toLowerCase();
  return (
    error.tags.includes('conflict') ||
    code.includes('conflict') ||
    code.includes('already_exists') ||
    msg.includes('already exists') ||
    msg.includes('duplicate key') ||
    msg.includes('unique constraint')
  );
}

function isNotFoundError(error: DomainError): boolean {
  const code = (error.code ?? '').toLowerCase();
  return error.tags.includes('not-found') || code.includes('not_found');
}

function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

export class V2EngineSyncAdapter implements IVcsLocalEnginePort {
  private readonly commandBus: ICommandBus;
  private readonly queryBus: IQueryBus;
  private readonly actorId: string;
  private readonly executionContext?: IExecutionContext;
  private readonly getExecutionContext?: () => IExecutionContext | Promise<IExecutionContext>;
  private readonly onFlushComputed?: () => Promise<unknown>;
  private readonly dirtyTracker?: WorkingDirtyTracker;
  private readonly preserveAutoNumbers: boolean;

  constructor(options: IV2EngineSyncAdapterOptions) {
    this.commandBus = options.commandBus;
    this.queryBus = options.queryBus;
    this.actorId = options.actorId ?? DEFAULT_ACTOR_ID;
    this.executionContext = options.executionContext;
    this.getExecutionContext = options.getExecutionContext;
    this.onFlushComputed = options.flushComputed;
    this.dirtyTracker = options.queryRaw ? new WorkingDirtyTracker(options.queryRaw) : undefined;
    this.preserveAutoNumbers = options.preserveAutoNumbers ?? true;
  }

  private async resolveContext(
    override?: IExecutionContext
  ): Promise<Result<IExecutionContext, DomainError>> {
    if (override) {
      return ok(override);
    }
    if (this.getExecutionContext) {
      return ok(await this.getExecutionContext());
    }
    if (this.executionContext) {
      return ok(this.executionContext);
    }
    const actorRes = ActorId.create(this.actorId);
    if (actorRes.isErr()) {
      return err(actorRes.error);
    }
    return ok({ actorId: actorRes.value });
  }

  private async runFlushComputed(): Promise<number> {
    if (!this.onFlushComputed) {
      return 0;
    }
    const result = await this.onFlushComputed();
    if (
      result !== null &&
      typeof result === 'object' &&
      'processed' in result &&
      typeof (result as { processed?: unknown }).processed === 'number'
    ) {
      return (result as { processed: number }).processed;
    }
    return 0;
  }

  private async getTableById(
    context: IExecutionContext,
    baseId: string,
    tableId: string
  ): Promise<Result<Table, DomainError>> {
    const queryRes = GetTableByIdQuery.create({ baseId, tableId });
    if (queryRes.isErr()) return err(queryRes.error);
    const execRes = await this.queryBus.execute<GetTableByIdQuery, GetTableByIdResult>(
      context,
      queryRes.value
    );
    if (execRes.isErr()) return err(execRes.error);
    return ok(execRes.value.table);
  }

  private mapRecordReadModel(rec: ListTableRecordsResult['records'][number]): IRecordVcsSnapshot {
    return {
      id: rec.id,
      fields: normalizeRecordFields(rec.fields),
      ...(rec.autoNumber !== undefined ? { autoNumber: rec.autoNumber } : {}),
      ...(rec.version !== undefined ? { version: rec.version } : {}),
      ...(rec.orders ? { orders: { ...rec.orders } } : {}),
    };
  }

  private async listTableRecords(
    context: IExecutionContext,
    tableId: string
  ): Promise<Result<IRecordVcsSnapshot[], DomainError>> {
    const records: IRecordVcsSnapshot[] = [];
    let cursor: string | undefined;
    let offset = 0;

    for (;;) {
      const queryRes = ListTableRecordsQuery.create({
        tableId,
        limit: RECORD_PAGE_SIZE,
        ...(cursor !== undefined ? { cursor } : { offset }),
        ignoreViewQuery: true,
        includeOrders: true,
        fieldKeyType: FieldKeyType.Id,
      });
      if (queryRes.isErr()) return err(queryRes.error);

      const pageRes = await this.queryBus.execute<ListTableRecordsQuery, ListTableRecordsResult>(
        context,
        queryRes.value
      );
      if (pageRes.isErr()) return err(pageRes.error);

      records.push(...pageRes.value.records.map((rec) => this.mapRecordReadModel(rec)));

      if (!pageRes.value.hasMore) {
        break;
      }
      if (pageRes.value.nextCursor && pageRes.value.nextCursor !== cursor) {
        cursor = pageRes.value.nextCursor;
        continue;
      }
      if (pageRes.value.records.length < RECORD_PAGE_SIZE) {
        break;
      }
      offset += pageRes.value.records.length;
    }

    return ok(sortRecordsCanonically(records, undefined, { preserveComputed: true }));
  }

  private captureTableFields(table: Table): Result<IFieldVcsSnapshot[], DomainError> {
    const fields: IFieldVcsSnapshot[] = [];
    for (const field of table.getFields()) {
      const mapped = mapDomainFieldToSnapshot(table, field);
      if (mapped.isErr()) return err(mapped.error);
      fields.push(mapped.value);
    }
    return ok(sortFieldsCanonically(fields));
  }

  private mapViewQueryToVcs(
    v: GetViewSnapshotsResult['snapshots'][number]['view']
  ): IViewVcsSnapshot['query'] {
    const queryObj: NonNullable<IViewVcsSnapshot['query']> = {
      ...(v.filter !== undefined && v.filter !== null ? { filter: v.filter } : {}),
      ...(v.sort?.sortObjs ? { sort: [...v.sort.sortObjs] } : {}),
      ...(v.group ? { group: [...v.group] } : {}),
      ...(v.sort?.manualSort !== undefined ? { manualSort: v.sort.manualSort } : {}),
    };
    return Object.keys(queryObj).length > 0 ? queryObj : undefined;
  }

  private async captureTableViews(
    context: IExecutionContext,
    table: Table
  ): Promise<Result<IViewVcsSnapshot[], DomainError>> {
    const viewIds = table.views().map((v) => v.id().toString());
    if (viewIds.length === 0) {
      return ok([]);
    }

    const viewsQueryRes = GetViewSnapshotsQuery.create({
      tableId: table.id().toString(),
      viewIds,
    });
    if (viewsQueryRes.isErr()) return err(viewsQueryRes.error);

    const viewsRes = await this.queryBus.execute<GetViewSnapshotsQuery, GetViewSnapshotsResult>(
      context,
      viewsQueryRes.value
    );
    if (viewsRes.isErr()) return err(viewsRes.error);

    const views: IViewVcsSnapshot[] = viewsRes.value.snapshots.map((item) => {
      const v = item.view;
      const query = this.mapViewQueryToVcs(v);
      return {
        id: v.id,
        name: v.name,
        type: v.type,
        ...(v.description !== undefined ? { description: v.description } : {}),
        columnMeta: v.columnMeta as Record<string, unknown>,
        ...(v.options !== undefined && v.options !== null
          ? { options: v.options as Record<string, unknown> }
          : {}),
        ...(query !== undefined ? { query } : {}),
        ...(v.order !== undefined ? { order: v.order } : {}),
      };
    });
    return ok(sortViewsCanonically(views));
  }

  private async captureSingleTable(
    context: IExecutionContext,
    table: Table,
    includeRecords = true
  ): Promise<Result<ITableVcsSnapshot, DomainError>> {
    const fieldsRes = this.captureTableFields(table);
    if (fieldsRes.isErr()) return err(fieldsRes.error);

    const viewsRes = await this.captureTableViews(context, table);
    if (viewsRes.isErr()) return err(viewsRes.error);

    let records: IRecordVcsSnapshot[] = [];
    if (includeRecords) {
      const recordsRes = await this.listTableRecords(context, table.id().toString());
      if (recordsRes.isErr()) return err(recordsRes.error);
      records = recordsRes.value;
    }

    const dbTableNameRes = table.dbTableName().andThen((d) => d.value());

    return ok(
      canonicalizeTable(
        {
          id: table.id().toString(),
          name: table.name().toString(),
          ...(dbTableNameRes.isOk() ? { dbTableName: dbTableNameRes.value } : {}),
          primaryFieldId: table.primaryFieldId().toString(),
          fields: fieldsRes.value,
          views: viewsRes.value,
          records,
        },
        { preserveComputed: true }
      )
    );
  }

  private async listBaseLiveTables(
    context: IExecutionContext,
    baseId: string
  ): Promise<Result<readonly Table[], DomainError>> {
    const listQueryRes = ListTablesQuery.create({ baseId });
    if (listQueryRes.isErr()) return err(listQueryRes.error);

    const listRes = await this.queryBus.execute<ListTablesQuery, ListTablesResult>(
      context,
      listQueryRes.value
    );
    if (listRes.isErr()) return err(listRes.error);
    return ok(listRes.value.tables);
  }

  async captureSnapshot(
    baseId: string,
    options?: IEngineExecutionOptions
  ): Promise<Result<IBaseVcsSnapshot, DomainError>> {
    const ctxRes = await this.resolveContext(options?.context);
    if (ctxRes.isErr()) return err(ctxRes.error);
    const context = ctxRes.value;

    const liveTablesRes = await this.listBaseLiveTables(context, baseId);
    if (liveTablesRes.isErr()) return err(liveTablesRes.error);

    const tables: ITableVcsSnapshot[] = [];
    for (const table of liveTablesRes.value) {
      const capRes = await this.captureSingleTable(context, table, true);
      if (capRes.isErr()) return err(capRes.error);
      tables.push(capRes.value);
    }

    return ok(
      canonicalizeSnapshot(
        {
          formatVersion: 1,
          baseId,
          baseName: options?.baseName ?? baseId,
          revision: options?.revision ?? 0,
          capturedAt: new Date().toISOString(),
          tables: sortTablesCanonically(tables, { preserveComputed: true }),
        },
        { preserveComputed: true }
      )
    );
  }

  async hasBase(
    baseId: string,
    options?: IEngineExecutionOptions
  ): Promise<Result<boolean, DomainError>> {
    const ctxRes = await this.resolveContext(options?.context);
    if (ctxRes.isErr()) return err(ctxRes.error);
    const context = ctxRes.value;

    const listQueryRes = ListTablesQuery.create({ baseId });
    if (listQueryRes.isErr()) return err(listQueryRes.error);

    const listRes = await this.queryBus.execute<ListTablesQuery, ListTablesResult>(
      context,
      listQueryRes.value
    );
    if (listRes.isErr()) {
      return isNotFoundError(listRes.error) ? ok(false) : err(listRes.error);
    }
    if (listRes.value.tables.length > 0) {
      return ok(true);
    }

    return this.hasBaseInBaseList(context, baseId);
  }

  private async hasBaseInBaseList(
    context: IExecutionContext,
    baseId: string
  ): Promise<Result<boolean, DomainError>> {
    let offset = 0;
    while (true) {
      const basesQueryRes = ListBasesQuery.create({
        limit: BASE_LIST_PAGE_SIZE,
        offset,
      });
      if (basesQueryRes.isErr()) return err(basesQueryRes.error);

      const basesRes = await this.queryBus.execute<ListBasesQuery, ListBasesResult>(
        context,
        basesQueryRes.value
      );
      if (basesRes.isErr()) {
        return isNotFoundError(basesRes.error) ? ok(false) : err(basesRes.error);
      }

      if (basesRes.value.bases.some((base) => base.id().toString() === baseId)) {
        return ok(true);
      }

      offset += BASE_LIST_PAGE_SIZE;
      if (basesRes.value.bases.length === 0 || offset >= basesRes.value.total) {
        return ok(false);
      }
    }
  }

  private async ensureBaseCreated(
    context: IExecutionContext,
    baseId: string,
    baseName: string
  ): Promise<Result<void, DomainError>> {
    const cmdRes = CreateBaseCommand.create({ baseId, name: baseName });
    if (cmdRes.isErr()) return err(cmdRes.error);
    const execRes = await this.commandBus.execute(context, cmdRes.value);
    if (execRes.isErr() && !isAlreadyExistsError(execRes.error)) {
      return err(execRes.error);
    }
    return ok(undefined);
  }

  private async syncExistingLinkField(
    context: IExecutionContext,
    table: Table,
    existing: Field,
    field: IFieldVcsSnapshot,
    baseId: string
  ): Promise<Result<void, DomainError>> {
    const mappedExistingRes = mapDomainFieldToSnapshot(table, existing);
    if (mappedExistingRes.isErr()) {
      return ok(undefined);
    }
    const updatePayload = toFieldUpdatePayload(mappedExistingRes.value, field, baseId);
    if (Object.keys(updatePayload).length === 0) {
      return ok(undefined);
    }
    const updateCmd = UpdateFieldCommand.create(
      { tableId: table.id().toString(), fieldId: field.id, field: updatePayload },
      { allowNoop: true }
    );
    if (updateCmd.isErr()) return err(updateCmd.error);
    const updateRes = await this.commandBus.execute(context, updateCmd.value);
    if (updateRes.isErr()) return err(updateRes.error);
    return ok(undefined);
  }

  private async createSingleFieldIfMissing(
    context: IExecutionContext,
    baseId: string,
    tableId: string,
    field: IFieldVcsSnapshot
  ): Promise<Result<boolean, DomainError>> {
    const tableRes = await this.getTableById(context, baseId, tableId);
    if (tableRes.isErr()) return err(tableRes.error);

    const existing = tableRes.value.getFields((f) => f.id().toString() === field.id)[0];
    if (existing) {
      if (field.type === 'link') {
        const syncRes = await this.syncExistingLinkField(
          context,
          tableRes.value,
          existing,
          field,
          baseId
        );
        if (syncRes.isErr()) return err(syncRes.error);
      }
      return ok(true);
    }

    const createCmd = CreateFieldCommand.create({
      baseId,
      tableId,
      field: toCoreFieldInput(field, baseId),
    });
    if (createCmd.isErr()) return err(createCmd.error);
    const execRes = await this.commandBus.execute(context, createCmd.value);
    if (execRes.isErr()) return err(execRes.error);
    return ok(true);
  }

  private async runDependentFieldPass(
    context: IExecutionContext,
    baseId: string,
    pending: ReadonlyArray<{ tableId: string; field: IFieldVcsSnapshot }>
  ): Promise<{
    nextPending: { tableId: string; field: IFieldVcsSnapshot }[];
    progressed: boolean;
    lastError?: DomainError;
  }> {
    const nextPending: { tableId: string; field: IFieldVcsSnapshot }[] = [];
    let lastError: DomainError | undefined;
    let progressed = false;

    for (const item of pending) {
      const res = await this.createSingleFieldIfMissing(context, baseId, item.tableId, item.field);
      if (res.isOk()) {
        progressed = true;
      } else {
        lastError = res.error;
        nextPending.push(item);
      }
    }

    return { nextPending, progressed, ...(lastError ? { lastError } : {}) };
  }

  private async createDependentFieldsTopologically(
    context: IExecutionContext,
    baseId: string,
    items: ReadonlyArray<{ tableId: string; field: IFieldVcsSnapshot }>
  ): Promise<Result<void, DomainError>> {
    const links = items.filter((item) => item.field.type === 'link');
    for (const item of links) {
      const res = await this.createSingleFieldIfMissing(context, baseId, item.tableId, item.field);
      if (res.isErr()) return err(res.error);
    }

    let pending = items.filter((item) => item.field.type !== 'link');
    const maxPasses = Math.max(pending.length + 1, 2);

    for (let pass = 0; pass < maxPasses && pending.length > 0; pass += 1) {
      const passResult = await this.runDependentFieldPass(context, baseId, pending);
      if (passResult.nextPending.length === 0) {
        return ok(undefined);
      }
      if (!passResult.progressed && passResult.lastError) {
        return err(passResult.lastError);
      }
      pending = passResult.nextPending;
    }

    if (pending.length > 0) {
      return err(
        vcsDomainError.invariant({
          code: 'vcs.dependency_cycle',
          message: `Failed to resolve dependent field order for ${pending.map((p) => p.field.id).join(', ')}`,
        })
      );
    }

    return ok(undefined);
  }

  private async syncTableViews(
    context: IExecutionContext,
    baseId: string,
    tableId: string,
    targetViews: readonly IViewVcsSnapshot[]
  ): Promise<Result<void, DomainError>> {
    if (targetViews.length === 0) {
      return ok(undefined);
    }

    for (const view of sortViewsCanonically(targetViews)) {
      const cmdRes = ApplyViewSnapshotCommand.create({
        tableId,
        snapshot: toViewSnapshotCommandPayload(view),
      });
      if (cmdRes.isErr()) return err(cmdRes.error);
      const execRes = await this.commandBus.execute(context, cmdRes.value);
      if (execRes.isErr()) return err(execRes.error);
    }

    const tableRes = await this.getTableById(context, baseId, tableId);
    if (tableRes.isErr()) return err(tableRes.error);

    const targetIds = new Set(targetViews.map((v) => v.id));
    for (const existingView of tableRes.value.views()) {
      const viewId = existingView.id().toString();
      if (targetIds.has(viewId)) {
        continue;
      }
      const delCmd = DeleteViewCommand.create({ tableId, viewId });
      if (delCmd.isErr()) return err(delCmd.error);
      const delRes = await this.commandBus.execute(context, delCmd.value);
      if (delRes.isErr()) return err(delRes.error);
    }

    return ok(undefined);
  }

  private partitionRecordsForRestore(
    records: readonly IRecordVcsSnapshot[],
    linkFieldIds: ReadonlySet<string>,
    schemaFields?: readonly IFieldVcsSnapshot[]
  ): {
    scalarPayloads: {
      recordId: string;
      fields: Record<string, unknown>;
      orders?: Record<string, number>;
      autoNumber?: number;
      defaultOrder?: number;
    }[];
    linkUpdates: { id: string; fields: Record<string, unknown> }[];
  } {
    const scalarPayloads: {
      recordId: string;
      fields: Record<string, unknown>;
      orders?: Record<string, number>;
      autoNumber?: number;
      defaultOrder?: number;
    }[] = [];
    const linkUpdates: { id: string; fields: Record<string, unknown> }[] = [];

    for (const record of records) {
      const normalized = normalizeRecordFields(record.fields, schemaFields);
      const scalarFields: Record<string, unknown> = {};
      const linkFields: Record<string, unknown> = {};
      for (const [fieldId, value] of Object.entries(normalized)) {
        const target = linkFieldIds.has(fieldId) ? linkFields : scalarFields;
        target[fieldId] = value;
      }
      scalarPayloads.push({
        recordId: record.id,
        fields: scalarFields,
        ...(this.preserveAutoNumbers &&
          record.autoNumber !== undefined && {
            autoNumber: record.autoNumber,
            defaultOrder: record.autoNumber,
          }),
        ...(record.orders ? { orders: { ...record.orders } } : {}),
      });
      if (Object.keys(linkFields).length > 0) {
        linkUpdates.push({ id: record.id, fields: linkFields });
      }
    }

    return { scalarPayloads, linkUpdates };
  }

  private async restoreTableScalarBatch(
    context: IExecutionContext,
    table: ITableVcsSnapshot
  ): Promise<Result<{ id: string; fields: Record<string, unknown> }[], DomainError>> {
    const linkFieldIds = new Set(table.fields.filter((f) => f.type === 'link').map((f) => f.id));
    const { scalarPayloads, linkUpdates } = this.partitionRecordsForRestore(
      table.records,
      linkFieldIds,
      table.fields
    );
    for (const batch of chunkArray(scalarPayloads, RECORD_BATCH_SIZE)) {
      const cmdRes = RestoreRecordsCommand.create({
        tableId: table.id,
        records: batch,
      });
      if (cmdRes.isErr()) return err(cmdRes.error);
      const execRes = await this.commandBus.execute(context, cmdRes.value);
      if (execRes.isErr()) return err(execRes.error);
    }
    return ok(linkUpdates);
  }

  private async applyTableLinkUpdateBatches(
    context: IExecutionContext,
    tableId: string,
    records: { id: string; fields: Record<string, unknown> }[]
  ): Promise<Result<void, DomainError>> {
    for (const batch of chunkArray(records, RECORD_BATCH_SIZE)) {
      const cmdRes = UpdateRecordsCommand.create({
        tableId,
        fieldKeyType: FieldKeyType.Id,
        records: batch,
      });
      if (cmdRes.isErr()) return err(cmdRes.error);
      const execRes = await this.commandBus.execute(context, cmdRes.value);
      if (execRes.isErr()) return err(execRes.error);
    }
    return ok(undefined);
  }

  private async restoreTableRecords(
    context: IExecutionContext,
    tables: readonly ITableVcsSnapshot[]
  ): Promise<Result<void, DomainError>> {
    const linkUpdatesByTable: {
      tableId: string;
      records: { id: string; fields: Record<string, unknown> }[];
    }[] = [];

    for (const table of tables) {
      if (table.records.length === 0) continue;
      const linkUpdatesRes = await this.restoreTableScalarBatch(context, table);
      if (linkUpdatesRes.isErr()) return err(linkUpdatesRes.error);
      if (linkUpdatesRes.value.length > 0) {
        linkUpdatesByTable.push({ tableId: table.id, records: linkUpdatesRes.value });
      }
    }

    for (const item of linkUpdatesByTable) {
      const linkRes = await this.applyTableLinkUpdateBatches(context, item.tableId, item.records);
      if (linkRes.isErr()) return err(linkRes.error);
    }

    return ok(undefined);
  }

  private partitionTableFieldsForPass1(
    table: ITableVcsSnapshot,
    baseId: string
  ): {
    pass1Fields: ITableFieldInput[];
    dependentFields: { tableId: string; field: IFieldVcsSnapshot }[];
  } {
    const pass1Fields: ITableFieldInput[] = [];
    const dependentFields: { tableId: string; field: IFieldVcsSnapshot }[] = [];
    for (const field of table.fields) {
      const isDep = DEPENDENT_FIELD_TYPES.has(field.type);
      if (!isDep || field.isPrimary) {
        pass1Fields.push(toCoreFieldInput(field, baseId, { allowPrimary: true }));
      } else {
        dependentFields.push({ tableId: table.id, field });
      }
    }
    return { pass1Fields, dependentFields };
  }

  private async createPass1Tables(
    context: IExecutionContext,
    snapshot: IBaseVcsSnapshot
  ): Promise<Result<{ tableId: string; field: IFieldVcsSnapshot }[], DomainError>> {
    const dependentQueue: { tableId: string; field: IFieldVcsSnapshot }[] = [];

    for (const table of snapshot.tables) {
      const { pass1Fields, dependentFields } = this.partitionTableFieldsForPass1(
        table,
        snapshot.baseId
      );
      dependentQueue.push(...dependentFields);

      const createCmd = CreateTableCommand.create({
        baseId: snapshot.baseId,
        tableId: table.id,
        name: table.name,
        ...(table.dbTableName ? { dbTableName: table.dbTableName } : {}),
        fields: pass1Fields,
        ...(table.views.length > 0
          ? { views: [{ type: 'grid', name: `__vcs_bootstrap_${table.id}` }] }
          : {}),
      });
      if (createCmd.isErr()) return err(createCmd.error);
      const createRes = await this.commandBus.execute(context, createCmd.value);
      if (createRes.isErr()) return err(createRes.error);
    }

    return ok(dependentQueue);
  }

  private async hydrateFromScratch(
    context: IExecutionContext,
    snapshot: IBaseVcsSnapshot
  ): Promise<Result<void, DomainError>> {
    const pass1Res = await this.createPass1Tables(context, snapshot);
    if (pass1Res.isErr()) return err(pass1Res.error);

    const depRes = await this.createDependentFieldsTopologically(
      context,
      snapshot.baseId,
      pass1Res.value
    );
    if (depRes.isErr()) return err(depRes.error);

    for (const table of snapshot.tables) {
      const viewRes = await this.syncTableViews(context, snapshot.baseId, table.id, table.views);
      if (viewRes.isErr()) return err(viewRes.error);
    }

    return this.restoreTableRecords(context, snapshot.tables);
  }

  async hydrateSnapshot(
    snapshot: IBaseVcsSnapshot,
    options?: IEngineExecutionOptions
  ): Promise<Result<IVcsEngineApplyResult, DomainError>> {
    const ctxRes = await this.resolveContext(options?.context);
    if (ctxRes.isErr()) return err(ctxRes.error);
    const context = ctxRes.value;

    const baseRes = await this.ensureBaseCreated(context, snapshot.baseId, snapshot.baseName);
    if (baseRes.isErr()) return err(baseRes.error);

    const liveTablesRes = await this.listBaseLiveTables(context, snapshot.baseId);
    if (liveTablesRes.isOk() && liveTablesRes.value.length > 0) {
      const existingCap = await this.captureSnapshot(snapshot.baseId, {
        baseName: snapshot.baseName,
        revision: snapshot.revision,
        context,
      });

      if (existingCap.isOk() && existingCap.value.tables.length > 0) {
        const targetWithoutScope: IBaseVcsSnapshot = {
          ...snapshot,
          accessScope: undefined,
        };
        const patch = diffSnapshots(existingCap.value, targetWithoutScope);
        return this.applyPatch(snapshot.baseId, patch, {
          baseName: snapshot.baseName,
          revision: snapshot.revision,
          context,
          skipCaptureSnapshot: options?.skipCaptureSnapshot,
        });
      }
    }

    const scratchRes = await this.hydrateFromScratch(context, snapshot);
    if (scratchRes.isErr()) return err(scratchRes.error);

    const recomputedCells = await this.runFlushComputed();
    if (options?.skipCaptureSnapshot) {
      return ok({
        applied: true,
        recomputedCells,
      });
    }

    const afterCap = await this.captureSnapshot(snapshot.baseId, {
      baseName: snapshot.baseName,
      revision: snapshot.revision,
      context,
    });
    if (afterCap.isErr()) return err(afterCap.error);

    return ok({
      applied: true,
      recomputedCells,
      snapshot: afterCap.value,
    });
  }

  private async deleteFieldIfPresent(
    context: IExecutionContext,
    baseId: string,
    tableId: string,
    fieldId: string
  ): Promise<Result<void, DomainError>> {
    const delCmd = DeleteFieldCommand.create({ baseId, tableId, fieldId }, { skipUndoRedo: true });
    if (delCmd.isErr()) return err(delCmd.error);
    const execRes = await this.commandBus.execute(context, delCmd.value);
    if (execRes.isErr() && !isNotFoundError(execRes.error)) {
      return err(execRes.error);
    }
    return ok(undefined);
  }

  private async applyTableRename(
    context: IExecutionContext,
    baseId: string,
    tablePatch: ITableVcsPatch
  ): Promise<Result<void, DomainError>> {
    if (!tablePatch.nameChange) return ok(undefined);
    const renameCmd = RenameTableCommand.create({
      baseId,
      tableId: tablePatch.tableId,
      name: tablePatch.nameChange.to,
    });
    if (renameCmd.isErr()) return err(renameCmd.error);
    const renameRes = await this.commandBus.execute(context, renameCmd.value);
    if (renameRes.isErr()) return err(renameRes.error);
    return ok(undefined);
  }

  private async applyTableRenameAndAddedFields(
    context: IExecutionContext,
    baseId: string,
    tablePatch: ITableVcsPatch,
    dependentQueue: { tableId: string; field: IFieldVcsSnapshot }[]
  ): Promise<Result<void, DomainError>> {
    const renameRes = await this.applyTableRename(context, baseId, tablePatch);
    if (renameRes.isErr()) return err(renameRes.error);

    for (const addedField of tablePatch.fieldsAdded) {
      if (DEPENDENT_FIELD_TYPES.has(addedField.type)) {
        dependentQueue.push({ tableId: tablePatch.tableId, field: addedField });
        continue;
      }
      const createRes = await this.createSingleFieldIfMissing(
        context,
        baseId,
        tablePatch.tableId,
        addedField
      );
      if (createRes.isErr()) return err(createRes.error);
    }
    return ok(undefined);
  }

  private async applyTableUpdatedFields(
    context: IExecutionContext,
    baseId: string,
    tablePatch: ITableVcsPatch
  ): Promise<Result<void, DomainError>> {
    for (const updatedField of tablePatch.fieldsUpdated) {
      const fieldPayload = toFieldUpdatePayload(updatedField.before, updatedField.after, baseId);
      if (Object.keys(fieldPayload).length === 0) continue;
      const updCmd = UpdateFieldCommand.create(
        { tableId: tablePatch.tableId, fieldId: updatedField.fieldId, field: fieldPayload },
        { allowNoop: true }
      );
      if (updCmd.isErr()) return err(updCmd.error);
      const updRes = await this.commandBus.execute(context, updCmd.value);
      if (updRes.isErr()) return err(updRes.error);
    }
    return ok(undefined);
  }

  private async applyTableUpsertedViews(
    context: IExecutionContext,
    tableId: string,
    views: readonly IViewVcsSnapshot[]
  ): Promise<Result<void, DomainError>> {
    for (const view of views) {
      const viewCmd = ApplyViewSnapshotCommand.create({
        tableId,
        snapshot: toViewSnapshotCommandPayload(view),
      });
      if (viewCmd.isErr()) return err(viewCmd.error);
      const viewRes = await this.commandBus.execute(context, viewCmd.value);
      if (viewRes.isErr()) return err(viewRes.error);
    }
    return ok(undefined);
  }

  private async applyTablePatchViews(
    context: IExecutionContext,
    tablePatch: ITableVcsPatch
  ): Promise<Result<void, DomainError>> {
    const upsertList = [
      ...tablePatch.viewsAdded,
      ...tablePatch.viewsUpdated.map((updated) => updated.after),
    ];
    const upsertRes = await this.applyTableUpsertedViews(context, tablePatch.tableId, upsertList);
    if (upsertRes.isErr()) return err(upsertRes.error);

    for (const deletedView of tablePatch.viewsDeleted) {
      const delViewCmd = DeleteViewCommand.create({
        tableId: tablePatch.tableId,
        viewId: deletedView.viewId,
      });
      if (delViewCmd.isErr()) return err(delViewCmd.error);
      const delViewRes = await this.commandBus.execute(context, delViewCmd.value);
      if (delViewRes.isErr() && !isNotFoundError(delViewRes.error)) {
        return err(delViewRes.error);
      }
    }
    return ok(undefined);
  }

  private async deleteTableFieldsTopologically(
    context: IExecutionContext,
    baseId: string,
    tableId: string,
    deletedFields: ITableVcsPatch['fieldsDeleted']
  ): Promise<Result<void, DomainError>> {
    if (deletedFields.length === 0) return ok(undefined);

    // Delete computed/non-stored fields before link/stored fields to satisfy dependencies
    let pending = [...deletedFields].sort((a, b) => {
      const rank = (field?: IFieldVcsSnapshot) => {
        if (!field) return 0;
        if (!isStoredVcsField(field)) return 0;
        return field.type === 'link' ? 1 : 2;
      };
      return rank(a.before) - rank(b.before);
    });

    const maxPasses = Math.max(pending.length + 1, 2);
    for (let pass = 0; pass < maxPasses && pending.length > 0; pass += 1) {
      const nextPending: typeof pending = [];
      let progressed = false;
      let lastError: DomainError | undefined;

      for (const deletedField of pending) {
        const res = await this.deleteFieldIfPresent(context, baseId, tableId, deletedField.fieldId);
        if (res.isOk()) {
          progressed = true;
        } else {
          lastError = res.error;
          nextPending.push(deletedField);
        }
      }

      if (nextPending.length === 0) return ok(undefined);
      if (!progressed && lastError) return err(lastError);
      pending = nextPending;
    }

    return ok(undefined);
  }

  private async applyTableRecordsAddedScalar(
    context: IExecutionContext,
    baseId: string,
    tablePatch: ITableVcsPatch
  ): Promise<Result<{ id: string; fields: Record<string, unknown> }[], DomainError>> {
    if (tablePatch.recordsAdded.length === 0) return ok([]);

    const tableRes = await this.getTableById(context, baseId, tablePatch.tableId);
    if (tableRes.isErr()) return err(tableRes.error);

    const linkFieldIds = new Set(
      tableRes.value
        .getFields()
        .filter((field) => field.type().toString() === 'link')
        .map((field) => field.id().toString())
    );

    const { scalarPayloads, linkUpdates } = this.partitionRecordsForRestore(
      tablePatch.recordsAdded,
      linkFieldIds
    );

    for (const batch of chunkArray(scalarPayloads, RECORD_BATCH_SIZE)) {
      const recCmd = RestoreRecordsCommand.create({
        tableId: tablePatch.tableId,
        records: batch,
      });
      if (recCmd.isErr()) return err(recCmd.error);
      const recRes = await this.commandBus.execute(context, recCmd.value);
      if (recRes.isErr()) return err(recRes.error);
    }

    return ok(linkUpdates);
  }

  private async executeUpdateRecordBatches(
    context: IExecutionContext,
    tableId: string,
    records: ReadonlyArray<{ id: string; fields: Record<string, unknown> }>
  ): Promise<Result<void, DomainError>> {
    for (const batch of chunkArray(records, RECORD_BATCH_SIZE)) {
      const updRecCmd = UpdateRecordsCommand.create({
        tableId,
        fieldKeyType: FieldKeyType.Id,
        records: batch,
      });
      if (updRecCmd.isErr()) return err(updRecCmd.error);
      const updRecRes = await this.commandBus.execute(context, updRecCmd.value);
      if (updRecRes.isErr()) return err(updRecRes.error);
    }
    return ok(undefined);
  }

  private async applyTableRecordsUpdated(
    context: IExecutionContext,
    baseId: string,
    tablePatch: ITableVcsPatch
  ): Promise<Result<void, DomainError>> {
    if (tablePatch.recordsUpdated.length === 0) return ok(undefined);

    const tableRes = await this.getTableById(context, baseId, tablePatch.tableId);
    if (tableRes.isErr()) return err(tableRes.error);

    const { unlinkBatch, finalBatch } = buildUpdatedRecordBatches(
      tableRes.value,
      tablePatch.recordsUpdated
    );

    // Release removed links before assigning them to other records to avoid oneMany duplicate rejections.
    if (unlinkBatch.length > 0) {
      const unlinkRes = await this.executeUpdateRecordBatches(
        context,
        tablePatch.tableId,
        unlinkBatch
      );
      if (unlinkRes.isErr()) return err(unlinkRes.error);
    }
    if (finalBatch.length > 0) {
      const result = await this.executeUpdateRecordBatches(context, tablePatch.tableId, finalBatch);
      if (result.isErr()) return err(result.error);
    }
    const byView = new Map<string, { recordId: string; order: number }[]>();
    for (const { recordId, orderChanges } of tablePatch.recordsUpdated) {
      for (const { viewId, after } of orderChanges ?? []) {
        const records = byView.get(viewId);
        if (records) records.push({ recordId, order: after });
        else byView.set(viewId, [{ recordId, order: after }]);
      }
    }
    for (const [viewId, records] of byView) {
      for (const batch of chunkArray(records, RECORD_BATCH_SIZE)) {
        const command = ApplyRecordOrdersCommand.create({
          tableId: tablePatch.tableId,
          viewId,
          records: batch,
          source: 'recordUpdate',
        });
        if (command.isErr()) return err(command.error);
        const result = await this.commandBus.execute(context, command.value);
        if (result.isErr()) return err(result.error);
      }
    }
    return ok(undefined);
  }

  private async applyTableRecordsDeleted(
    context: IExecutionContext,
    tablePatch: ITableVcsPatch
  ): Promise<Result<void, DomainError>> {
    if (tablePatch.recordsDeleted.length === 0) return ok(undefined);
    const delIds = tablePatch.recordsDeleted.map((r) => r.recordId);
    for (const batch of chunkArray(delIds, RECORD_BATCH_SIZE)) {
      const delRecCmd = DeleteRecordsCommand.create({
        tableId: tablePatch.tableId,
        recordIds: batch,
      });
      if (delRecCmd.isErr()) return err(delRecCmd.error);
      const delRecRes = await this.commandBus.execute(context, delRecCmd.value);
      if (delRecRes.isErr()) return err(delRecRes.error);
    }
    return ok(undefined);
  }

  private async applySingleTablePatchSchemaAndViews(
    context: IExecutionContext,
    baseId: string,
    tablePatch: ITableVcsPatch
  ): Promise<Result<void, DomainError>> {
    const updFieldsRes = await this.applyTableUpdatedFields(context, baseId, tablePatch);
    if (updFieldsRes.isErr()) return err(updFieldsRes.error);

    return this.applyTablePatchViews(context, tablePatch);
  }

  private async applySingleTablePatchDataAndDeletes(
    context: IExecutionContext,
    baseId: string,
    tablePatch: ITableVcsPatch
  ): Promise<Result<void, DomainError>> {
    const updRecRes = await this.applyTableRecordsUpdated(context, baseId, tablePatch);
    if (updRecRes.isErr()) return err(updRecRes.error);

    const delRecRes = await this.applyTableRecordsDeleted(context, tablePatch);
    if (delRecRes.isErr()) return err(delRecRes.error);

    return this.deleteTableFieldsTopologically(
      context,
      baseId,
      tablePatch.tableId,
      tablePatch.fieldsDeleted
    );
  }

  private async applyDeletedTables(
    context: IExecutionContext,
    baseId: string,
    tablesDeleted: IBaseVcsPatch['tablesDeleted']
  ): Promise<Result<void, DomainError>> {
    for (const deletedTable of tablesDeleted) {
      const delTableCmd = DeleteTableCommand.create({
        baseId,
        tableId: deletedTable.tableId,
        mode: 'permanent',
      });
      if (delTableCmd.isErr()) return err(delTableCmd.error);
      const delTableRes = await this.commandBus.execute(context, delTableCmd.value);
      if (delTableRes.isErr() && !isNotFoundError(delTableRes.error)) {
        return err(delTableRes.error);
      }
    }
    return ok(undefined);
  }

  private async applyAddedTablesPhase(
    context: IExecutionContext,
    baseId: string,
    tablesAdded: IBaseVcsPatch['tablesAdded'],
    options?: IEngineExecutionOptions
  ): Promise<Result<void, DomainError>> {
    if (tablesAdded.length === 0) return ok(undefined);
    return this.hydrateFromScratch(context, {
      formatVersion: 1,
      baseId,
      baseName: options?.baseName ?? baseId,
      revision: options?.revision ?? 0,
      capturedAt: new Date().toISOString(),
      tables: [...tablesAdded],
    });
  }

  private async applyUpdatedTablesRecordAdds(
    context: IExecutionContext,
    baseId: string,
    tablesUpdated: IBaseVcsPatch['tablesUpdated']
  ): Promise<Result<void, DomainError>> {
    const linkUpdatesByTable: {
      tableId: string;
      records: { id: string; fields: Record<string, unknown> }[];
    }[] = [];

    for (const tablePatch of tablesUpdated) {
      const linkUpdatesRes = await this.applyTableRecordsAddedScalar(context, baseId, tablePatch);
      if (linkUpdatesRes.isErr()) return err(linkUpdatesRes.error);
      if (linkUpdatesRes.value.length > 0) {
        linkUpdatesByTable.push({ tableId: tablePatch.tableId, records: linkUpdatesRes.value });
      }
    }

    for (const item of linkUpdatesByTable) {
      const linkRes = await this.applyTableLinkUpdateBatches(context, item.tableId, item.records);
      if (linkRes.isErr()) return err(linkRes.error);
    }

    return ok(undefined);
  }

  private async applyUpdatedTablesPhase(
    context: IExecutionContext,
    baseId: string,
    tablesUpdated: IBaseVcsPatch['tablesUpdated']
  ): Promise<Result<void, DomainError>> {
    const addedDependentFields: { tableId: string; field: IFieldVcsSnapshot }[] = [];
    for (const tablePatch of tablesUpdated) {
      const res = await this.applyTableRenameAndAddedFields(
        context,
        baseId,
        tablePatch,
        addedDependentFields
      );
      if (res.isErr()) return err(res.error);
    }

    if (addedDependentFields.length > 0) {
      const depRes = await this.createDependentFieldsTopologically(
        context,
        baseId,
        addedDependentFields
      );
      if (depRes.isErr()) return err(depRes.error);
    }

    for (const tablePatch of tablesUpdated) {
      const res = await this.applySingleTablePatchSchemaAndViews(context, baseId, tablePatch);
      if (res.isErr()) return err(res.error);
    }

    const addRecRes = await this.applyUpdatedTablesRecordAdds(context, baseId, tablesUpdated);
    if (addRecRes.isErr()) return err(addRecRes.error);

    for (const tablePatch of tablesUpdated) {
      const res = await this.applySingleTablePatchDataAndDeletes(context, baseId, tablePatch);
      if (res.isErr()) return err(res.error);
    }
    return ok(undefined);
  }

  async applyPatch(
    baseId: string,
    patch: IBaseVcsPatch,
    options?: IEngineExecutionOptions
  ): Promise<Result<IVcsEngineApplyResult, DomainError>> {
    const ctxRes = await this.resolveContext(options?.context);
    if (ctxRes.isErr()) return err(ctxRes.error);
    const context = ctxRes.value;

    if (!isEmptyPatch(patch)) {
      const addTablesRes = await this.applyAddedTablesPhase(
        context,
        baseId,
        patch.tablesAdded,
        options
      );
      if (addTablesRes.isErr()) return err(addTablesRes.error);

      const updTablesRes = await this.applyUpdatedTablesPhase(context, baseId, patch.tablesUpdated);
      if (updTablesRes.isErr()) return err(updTablesRes.error);

      const delTablesRes = await this.applyDeletedTables(context, baseId, patch.tablesDeleted);
      if (delTablesRes.isErr()) return err(delTablesRes.error);
    }

    const recomputedCells = await this.runFlushComputed();

    if (options?.skipCaptureSnapshot) {
      return ok({
        applied: true,
        recomputedCells,
      });
    }

    const afterCap = await this.captureSnapshot(baseId, options);
    if (afterCap.isErr()) return err(afterCap.error);

    return ok({
      applied: true,
      recomputedCells,
      snapshot: afterCap.value,
    });
  }

  async hydrateRecordChunk(params: {
    readonly baseId: string;
    readonly tableId: string;
    readonly records: readonly IRecordVcsSnapshot[];
    readonly mode?: 'scalar-insert' | 'link-update';
  }): Promise<Result<IVcsHydrateRecordChunkResult, DomainError>> {
    if (params.records.length === 0) {
      return ok({ deferredLinkRecords: [] });
    }
    const ctxRes = await this.resolveContext();
    if (ctxRes.isErr()) return err(ctxRes.error);
    const context = ctxRes.value;

    const mode = params.mode ?? 'scalar-insert';
    if (mode === 'link-update') {
      const linkRes = await this.applyTableLinkUpdateBatches(
        context,
        params.tableId,
        params.records.map((rec) => ({ id: rec.id, fields: { ...rec.fields } }))
      );
      if (linkRes.isErr()) return err(linkRes.error);
      return ok({ deferredLinkRecords: [] });
    }

    const tableRes = await this.getTableById(context, params.baseId, params.tableId);
    if (tableRes.isErr()) return err(tableRes.error);
    const schemaFieldsRes = this.captureTableFields(tableRes.value);
    if (schemaFieldsRes.isErr()) return err(schemaFieldsRes.error);

    const linkFieldIds = new Set(
      tableRes.value
        .getFields()
        .filter((f) => f.type().toString() === 'link')
        .map((f) => f.id().toString())
    );
    const { scalarPayloads, linkUpdates } = this.partitionRecordsForRestore(
      params.records,
      linkFieldIds,
      schemaFieldsRes.value
    );

    for (const batch of chunkArray(scalarPayloads, RECORD_BATCH_SIZE)) {
      const cmdRes = RestoreRecordsCommand.create({
        tableId: params.tableId,
        records: batch,
      });
      if (cmdRes.isErr()) return err(cmdRes.error);
      const execRes = await this.commandBus.execute(context, cmdRes.value);
      if (execRes.isErr()) return err(execRes.error);
    }

    return ok({ deferredLinkRecords: linkUpdates });
  }

  async flushComputed(_baseId: string): Promise<Result<number, DomainError>> {
    const processed = await this.runFlushComputed();
    return ok(processed);
  }

  async captureTableRecordsChunk(
    baseId: string,
    tableId: string,
    options?: { readonly cursor?: string; readonly limit?: number }
  ): Promise<Result<IVcsCloneRecordsChunk, DomainError>> {
    const ctxRes = await this.resolveContext();
    if (ctxRes.isErr()) return err(ctxRes.error);
    const context = ctxRes.value;

    const tableRes = await this.getTableById(context, baseId, tableId);
    if (tableRes.isErr()) return err(tableRes.error);

    return listTableRecordsChunkForVcs({
      queryBus: this.queryBus,
      context,
      table: tableRes.value,
      cursor: options?.cursor,
      limit: options?.limit,
      preserveComputed: true,
    });
  }

  async markWorkingClean(baseId: string): Promise<Result<void, DomainError>> {
    if (!this.dirtyTracker) {
      return ok(undefined);
    }
    const ctxRes = await this.resolveContext();
    if (ctxRes.isErr()) return err(ctxRes.error);
    const context = ctxRes.value;

    const liveTablesRes = await this.listBaseLiveTables(context, baseId);
    if (liveTablesRes.isErr()) return err(liveTablesRes.error);

    return this.dirtyTracker.markWorkingClean(baseId, liveTablesRes.value);
  }

  async ensureWorkingTrackingTriggers(baseId: string): Promise<Result<void, DomainError>> {
    if (!this.dirtyTracker) {
      return ok(undefined);
    }
    const ctxRes = await this.resolveContext();
    if (ctxRes.isErr()) return err(ctxRes.error);
    const context = ctxRes.value;

    const liveTablesRes = await this.listBaseLiveTables(context, baseId);
    if (liveTablesRes.isErr()) return err(liveTablesRes.error);

    const ensureRes = await this.dirtyTracker.ensureTriggersForBase(baseId, liveTablesRes.value, {
      seedNewTables: false,
    });
    return ensureRes.map(() => undefined);
  }

  async captureWorkingDelta(
    baseId: string,
    options?: IEngineExecutionOptions
  ): Promise<Result<IVcsWorkingDelta, DomainError>> {
    const ctxRes = await this.resolveContext(options?.context);
    if (ctxRes.isErr()) return err(ctxRes.error);
    const context = ctxRes.value;

    const liveTablesRes = await this.listBaseLiveTables(context, baseId);
    if (liveTablesRes.isErr()) return err(liveTablesRes.error);

    const schemaTables: ITableVcsSnapshot[] = [];
    const fieldsByTable = new Map<string, readonly IFieldVcsSnapshot[]>();
    for (const table of liveTablesRes.value) {
      const capRes = await this.captureSingleTable(context, table, false);
      if (capRes.isErr()) return err(capRes.error);
      schemaTables.push(capRes.value);
      fieldsByTable.set(capRes.value.id, capRes.value.fields);
    }

    const schemaSnapshot = canonicalizeSnapshot(
      {
        formatVersion: 1,
        baseId,
        baseName: options?.baseName ?? baseId,
        revision: options?.revision ?? 0,
        capturedAt: new Date().toISOString(),
        tables: sortTablesCanonically(schemaTables, { preserveComputed: true }),
      },
      { preserveComputed: true }
    );

    if (!this.dirtyTracker) {
      return ok({
        isCompleteDelta: false,
        schemaSnapshot,
        tableDeltas: new Map(),
      });
    }

    return this.dirtyTracker.captureWorkingDelta({
      baseId,
      baseName: options?.baseName,
      revision: options?.revision,
      liveTables: liveTablesRes.value,
      schemaSnapshot,
      fetchTableRecordsByIds: async (table, recordIds) => {
        const res = await listSelectedTableRecordsForVcs(this.queryBus, context, table, recordIds);
        if (res.isErr()) return err(res.error);
        const tableFields = fieldsByTable.get(table.id().toString());
        return ok(
          sortRecordsCanonically(
            res.value.map((rec) =>
              canonicalizeRecord(rec, tableFields, { preserveComputed: true })
            ),
            tableFields,
            { preserveComputed: true }
          )
        );
      },
    });
  }
}
