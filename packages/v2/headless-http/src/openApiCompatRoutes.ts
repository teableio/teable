import {
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
  mapFieldToDto,
  mapTableToDto,
} from '@teable/v2-contract-http';
import {
  ApplyViewSnapshotCommand,
  CreateFieldCommand,
  CreateRecordsCommand,
  CreateTableCommand,
  CreateViewCommand,
  DeleteFieldCommand,
  DeleteRecordsCommand,
  DeleteTableCommand,
  DeleteViewCommand,
  FieldKeyType,
  GetTableByIdQuery,
  ListBasesQuery,
  ListTableRecordsQuery,
  ListTablesQuery,
  ListViewsQuery,
  RenameTableCommand,
  RenameViewCommand,
  TableByIdSpec,
  TableId,
  UpdateFieldCommand,
  UpdateRecordCommand,
  UpdateRecordsCommand,
  UpdateTablePropertiesCommand,
  UpdateViewColumnMetaCommand,
  UpdateViewDescriptionCommand,
  UpdateViewFilterCommand,
  UpdateViewGroupCommand,
  UpdateViewLockedCommand,
  UpdateViewOptionsCommand,
  UpdateViewOrderCommand,
  UpdateViewSortCommand,
  UpsertRecordsCommand,
  domainError,
  projectViewForQuery,
  v2CoreTokens,
  type CreateRecordsResult,
  type CreateTableResult,
  type DomainError,
  type Field,
  type ICreateTableCommandInput,
  type IExecutionContext,
  type IListTableRecordsQueryInput,
  type IPublicCommand,
  type IRealtimeEngine,
  type ITableFieldInput,
  type ITableRepository,
  type ListBasesResult,
  type ListTablesResult,
  type ListViewsResult,
  type Table,
  type TableRecord,
  type TableRecordReadModel,
  type UpdateFieldResult,
  type UpdateRecordResult,
  type UpdateRecordsResult,
  type UpsertRecordsResult,
  type ViewQueryResultView,
} from '@teable/v2-core';
import type { IHeadlessRuntime } from '@teable/v2-headless-runtime';
import type { Context, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export interface IHeadlessOpenApiCompatOptions {
  readonly defaultBaseId?: string;
  readonly defaultBaseName?: string;
}

const BASE_ACTIONS = [
  'base|create',
  'base|delete',
  'base|read',
  'base|read_all',
  'base|update',
  'base|invite_email',
  'base|invite_link',
  'base|table_import',
  'base|table_export',
  'base|authority_matrix_config',
  'base|query_data',
] as const;

const TABLE_ACTIONS = [
  'table|create',
  'table|delete',
  'table|read',
  'table|update',
  'table|import',
  'table|export',
  'table|trash_read',
  'table|trash_update',
  'table|trash_reset',
  'table|archive_read',
  'table|archive_manage',
] as const;

const VIEW_ACTIONS = [
  'view|create',
  'view|delete',
  'view|read',
  'view|update',
  'view|share',
] as const;

const FIELD_ACTIONS = ['field|create', 'field|delete', 'field|read', 'field|update'] as const;

const RECORD_ACTIONS = [
  'record|create',
  'record|delete',
  'record|read',
  'record|update',
  'record|comment',
  'record|copy',
  'record|archive',
] as const;

const AUTOMATION_ACTIONS = [
  'automation|create',
  'automation|delete',
  'automation|read',
  'automation|update',
] as const;

const ROUTINE_ACTIONS = [
  'routine|create',
  'routine|delete',
  'routine|read',
  'routine|update',
] as const;

const APP_ACTIONS = ['app|create', 'app|delete', 'app|read', 'app|update'] as const;

const TABLE_RECORD_HISTORY_ACTIONS = ['table_record_history|read'] as const;

type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly response: Response };

interface IRecordDto {
  readonly id: string;
  readonly fields: Record<string, unknown>;
}

const buildPermissionMap = (actions: readonly string[]): Record<string, boolean> =>
  Object.fromEntries(actions.map((action) => [action, true]));

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const withDefined = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;

const sendOpenApiError = (
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  extra?: { details?: unknown; localization?: unknown }
) =>
  c.json(
    {
      message,
      code,
      status,
      data: {
        domainCode: code,
        ...(extra?.details !== undefined ? { details: extra.details } : {}),
        ...(extra?.localization !== undefined ? { localization: extra.localization } : {}),
      },
    },
    status
  );

const sendDomainError = (c: Context, error: DomainError) => {
  const status = mapDomainErrorToHttpStatus(error) as ContentfulStatusCode;
  const httpErr = mapDomainErrorToHttpError(error);
  return sendOpenApiError(c, status, httpErr.code, httpErr.message, {
    details: httpErr.details,
    localization: httpErr.localization,
  });
};

const parseJsonUnknown = async (c: Context): Promise<Outcome<unknown>> => {
  try {
    return { ok: true, value: await c.req.json() };
  } catch {
    return {
      ok: false,
      response: sendOpenApiError(c, 400, 'validation.json.invalid', 'Invalid JSON request body'),
    };
  }
};

const parseJsonBody = async (c: Context): Promise<Outcome<Record<string, unknown>>> => {
  const parsed = await parseJsonUnknown(c);
  if (!parsed.ok) return parsed;
  if (!isPlainRecord(parsed.value)) {
    return {
      ok: false,
      response: sendOpenApiError(
        c,
        400,
        'validation.body.invalid',
        'Request body must be a JSON object'
      ),
    };
  }
  return { ok: true, value: parsed.value };
};

const parseOptionalJsonBody = async (c: Context): Promise<Outcome<Record<string, unknown>>> => {
  const text = await c.req.text();
  if (text.trim().length === 0) {
    return { ok: true, value: {} };
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isPlainRecord(parsed)) {
      return {
        ok: false,
        response: sendOpenApiError(
          c,
          400,
          'validation.body.invalid',
          'Request body must be a JSON object'
        ),
      };
    }
    return { ok: true, value: parsed };
  } catch {
    return {
      ok: false,
      response: sendOpenApiError(c, 400, 'validation.json.invalid', 'Invalid JSON request body'),
    };
  }
};

const resolveOpenApiFieldKeyType = (raw: unknown): FieldKeyType => {
  if (raw === FieldKeyType.Id || raw === FieldKeyType.Name || raw === FieldKeyType.DbFieldName) {
    return raw;
  }
  return FieldKeyType.Name;
};

const parseQueryArray = (c: Context, key: string): string[] | undefined => {
  const bracketed = c.req.queries(`${key}[]`) ?? [];
  const plain = c.req.queries(key) ?? [];
  const rawValues = bracketed.length > 0 ? bracketed : plain;
  if (rawValues.length === 0) return undefined;

  if (rawValues.length === 1) {
    const single = rawValues[0] ?? '';
    if (single.startsWith('[')) {
      try {
        const parsed = JSON.parse(single) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.map((item) => String(item));
        }
      } catch {
        // Fall through to comma/single handling
      }
    }
    if (single.includes(',')) {
      return single
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }
  }

  return rawValues.filter((item) => item.length > 0);
};

const parseQueryJson = (c: Context, key: string): unknown => {
  const raw = c.req.query(key);
  if (raw === undefined || raw === '') return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
};

const parseQueryBoolean = (c: Context, key: string): boolean | undefined => {
  const raw = c.req.query(key);
  if (raw === undefined) return undefined;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return undefined;
};

const parseSearchTupleValues = (c: Context): unknown[] | undefined => {
  const bracketed = c.req.queries('search[]') ?? [];
  const plain = c.req.queries('search') ?? [];
  const rawValues = bracketed.length > 0 ? bracketed : plain;
  if (rawValues.length === 0) return undefined;
  const first = rawValues[0] ?? '';
  if (rawValues.length !== 1 || !first.startsWith('[')) return rawValues;
  try {
    const parsed = JSON.parse(first) as unknown;
    return Array.isArray(parsed) ? parsed : rawValues;
  } catch {
    return rawValues;
  }
};

const parseQuerySearch = (c: Context): IListTableRecordsQueryInput['search'] | undefined => {
  const tupleValues = parseSearchTupleValues(c);
  if (!tupleValues || tupleValues.length === 0) return undefined;
  const term = String(tupleValues[0] ?? '');
  if (tupleValues.length === 1) return [term];
  const fieldKeys = String(tupleValues[1] ?? '');
  if (tupleValues.length === 2) return [term, fieldKeys];
  const rawHideNotMatch = tupleValues[2];
  const hideNotMatch =
    typeof rawHideNotMatch === 'boolean' ? rawHideNotMatch : rawHideNotMatch === 'true';
  return [term, fieldKeys, hideNotMatch];
};

const normalizeLegacyTimeZone = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeLegacyTimeZone(item));
  }
  if (!isPlainRecord(value)) {
    return value;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key === 'timeZone' && raw === 'UTC') {
      normalized[key] = 'utc';
      continue;
    }
    normalized[key] = normalizeLegacyTimeZone(raw);
  }
  return normalized;
};

const getResultTypePair = (field: Record<string, unknown>): Record<string, unknown> => {
  const cellValueType = field.cellValueType;
  const isMultipleCellValue = field.isMultipleCellValue;
  if (typeof cellValueType === 'string' && typeof isMultipleCellValue === 'boolean') {
    return isMultipleCellValue ? { cellValueType, isMultipleCellValue } : { cellValueType };
  }
  if (typeof cellValueType === 'string') {
    return { cellValueType };
  }
  return {};
};

const pickLookupOptions = (lookupOptions: Record<string, unknown> | undefined) =>
  withDefined({
    linkFieldId: lookupOptions?.linkFieldId as string | undefined,
    foreignTableId: lookupOptions?.foreignTableId as string | undefined,
    lookupFieldId: lookupOptions?.lookupFieldId as string | undefined,
    filter: lookupOptions?.filter,
    sort: lookupOptions?.sort,
    limit: lookupOptions?.limit,
    isUnique: lookupOptions?.isUnique,
  });

const pickCondition = (lookupOptions: Record<string, unknown> | undefined) =>
  withDefined({
    filter: lookupOptions?.filter,
    sort: lookupOptions?.sort,
    limit: lookupOptions?.limit,
  });

const pickFormulaOptions = (options: Record<string, unknown> | undefined) =>
  withDefined({
    expression: options?.expression as string | undefined,
    timeZone: options?.timeZone as string | undefined,
    formatting: options?.formatting,
    showAs: options?.showAs,
  });

const pickRollupConfig = (
  options: Record<string, unknown> | undefined,
  lookupOptions: Record<string, unknown> | undefined
) =>
  withDefined({
    linkFieldId: (options?.linkFieldId ?? lookupOptions?.linkFieldId) as string | undefined,
    foreignTableId: (options?.foreignTableId ?? lookupOptions?.foreignTableId) as
      | string
      | undefined,
    lookupFieldId: (options?.lookupFieldId ?? lookupOptions?.lookupFieldId) as string | undefined,
  });

const pickLinkOptions = (options: Record<string, unknown> | undefined) =>
  withDefined({
    baseId: options?.baseId as string | undefined,
    relationship: options?.relationship,
    foreignTableId: options?.foreignTableId as string | undefined,
    lookupFieldId: options?.lookupFieldId as string | undefined,
    isOneWay: options?.isOneWay as boolean | undefined,
    fkHostTableName: options?.fkHostTableName as string | undefined,
    selfKeyName: options?.selfKeyName as string | undefined,
    foreignKeyName: options?.foreignKeyName as string | undefined,
    symmetricFieldId: options?.symmetricFieldId as string | undefined,
    filterByViewId: (options?.filterByViewId ?? undefined) as string | null | undefined,
    visibleFieldIds: (options?.visibleFieldIds ?? undefined) as string[] | null | undefined,
    filter: options?.filter,
  });

const extractLegacyBaseField = (rawField: Record<string, unknown>): Record<string, unknown> =>
  withDefined({
    id: rawField.id as string | undefined,
    name: rawField.name as string | undefined,
    dbFieldName: rawField.dbFieldName as string | undefined,
    description:
      rawField.description === null ? undefined : (rawField.description as string | undefined),
    aiConfig: rawField.aiConfig === null ? undefined : rawField.aiConfig,
    isPrimary: rawField.isPrimary === true ? true : undefined,
    notNull: rawField.notNull as boolean | undefined,
    unique: rawField.unique as boolean | undefined,
  });

const mapLegacyConditionalField = (
  baseField: Record<string, unknown>,
  rawField: Record<string, unknown>,
  options: Record<string, unknown> | undefined,
  lookupOptions: Record<string, unknown> | undefined
): ITableFieldInput => {
  const foreignTableId = (lookupOptions?.foreignTableId as string | undefined) ?? '';
  const lookupFieldId = (lookupOptions?.lookupFieldId as string | undefined) ?? '';
  const condition = pickCondition(lookupOptions);

  if (rawField.type === 'rollup') {
    return normalizeLegacyTimeZone({
      ...baseField,
      type: 'conditionalRollup',
      ...getResultTypePair(rawField),
      options: pickFormulaOptions(options),
      config: { foreignTableId, lookupFieldId, condition },
    }) as ITableFieldInput;
  }

  return normalizeLegacyTimeZone({
    ...baseField,
    type: 'conditionalLookup',
    options: {
      ...(typeof lookupOptions?.isUnique === 'boolean' ? { isUnique: lookupOptions.isUnique } : {}),
      foreignTableId,
      lookupFieldId,
      condition,
    },
    ...(typeof rawField.isMultipleCellValue === 'boolean'
      ? { isMultipleCellValue: rawField.isMultipleCellValue }
      : {}),
    innerOptions: options,
  }) as ITableFieldInput;
};

const mapLegacyLookupLikeField = (
  baseField: Record<string, unknown>,
  rawField: Record<string, unknown>,
  options: Record<string, unknown> | undefined,
  lookupOptions: Record<string, unknown> | undefined
): ITableFieldInput => {
  if (rawField.isConditionalLookup === true) {
    return mapLegacyConditionalField(baseField, rawField, options, lookupOptions);
  }
  return normalizeLegacyTimeZone({
    ...baseField,
    type: 'lookup',
    legacyMultiplicityDerivation: true,
    ...(rawField.isMultipleCellValue === true ? { isMultipleCellValue: true } : {}),
    options: pickLookupOptions(lookupOptions),
    innerOptions: options,
  }) as ITableFieldInput;
};

const mapLegacyFieldToV2Field = (rawField: Record<string, unknown>): ITableFieldInput => {
  const baseField = extractLegacyBaseField(rawField);
  const options = isPlainRecord(rawField.options) ? rawField.options : undefined;
  const lookupOptions = isPlainRecord(rawField.lookupOptions) ? rawField.lookupOptions : undefined;
  const fieldType = rawField.type as string | undefined;

  if (rawField.isLookup === true) {
    return mapLegacyLookupLikeField(baseField, rawField, options, lookupOptions);
  }
  if (fieldType === 'rollup') {
    return normalizeLegacyTimeZone({
      ...baseField,
      type: 'rollup',
      ...getResultTypePair(rawField),
      options: pickFormulaOptions(options),
      config: pickRollupConfig(options, lookupOptions),
    }) as ITableFieldInput;
  }
  if (fieldType === 'conditionalRollup') {
    return normalizeLegacyTimeZone({
      ...baseField,
      type: 'conditionalRollup',
      ...getResultTypePair(rawField),
      options: pickFormulaOptions(options),
      config: {
        foreignTableId: options?.foreignTableId as string | undefined,
        lookupFieldId: options?.lookupFieldId as string | undefined,
        condition: pickCondition(options),
      },
    }) as ITableFieldInput;
  }
  if (fieldType === 'link') {
    return normalizeLegacyTimeZone({
      ...baseField,
      type: 'link',
      options: pickLinkOptions(options),
    }) as ITableFieldInput;
  }
  return normalizeLegacyTimeZone(
    withDefined({
      ...baseField,
      type: fieldType,
      ...(options ? { options } : {}),
    })
  ) as ITableFieldInput;
};

const applyLegacyUpdateOptions = (
  patch: Record<string, unknown>,
  effectiveType: string | undefined,
  options: Record<string, unknown> | undefined,
  lookupOptions: Record<string, unknown> | undefined
): Record<string, unknown> => {
  if (effectiveType === 'rollup') {
    if (options) patch.options = pickFormulaOptions(options);
    if (lookupOptions || options) {
      const config = pickRollupConfig(options, lookupOptions);
      if (Object.keys(config).length > 0) patch.config = config;
    }
    return patch;
  }
  if (effectiveType === 'lookup') {
    if (lookupOptions) patch.options = pickLookupOptions(lookupOptions);
    if (options) patch.innerOptions = options;
    return patch;
  }
  if (options) {
    patch.options = options;
  }
  return patch;
};

const mapLegacyFieldToV2Update = (
  rawField: Record<string, unknown>,
  updateMode: 'partial' | 'full',
  existingFieldType?: string
): Record<string, unknown> => {
  if (updateMode === 'full') {
    const converted = mapLegacyFieldToV2Field(rawField) as Record<string, unknown>;
    return {
      ...converted,
      ...(rawField.description === null ? { description: null } : {}),
      ...(rawField.aiConfig === null ? { aiConfig: null } : {}),
      updateMode: 'full',
    };
  }

  const options = isPlainRecord(rawField.options)
    ? (normalizeLegacyTimeZone(rawField.options) as Record<string, unknown>)
    : undefined;
  const lookupOptions = isPlainRecord(rawField.lookupOptions) ? rawField.lookupOptions : undefined;
  const effectiveType = typeof rawField.type === 'string' ? rawField.type : existingFieldType;
  const description =
    rawField.description === null || typeof rawField.description === 'string'
      ? rawField.description
      : undefined;

  const patch: Record<string, unknown> = withDefined({
    type: rawField.type as string | undefined,
    name: rawField.name as string | undefined,
    description,
    dbFieldName: rawField.dbFieldName as string | undefined,
    notNull: rawField.notNull as boolean | undefined,
    unique: rawField.unique as boolean | undefined,
    max: rawField.max as number | undefined,
    cellValueType: rawField.cellValueType as string | undefined,
    isMultipleCellValue: rawField.isMultipleCellValue as boolean | undefined,
    aiConfig: rawField.aiConfig,
    updateMode: 'partial',
  });

  return applyLegacyUpdateOptions(patch, effectiveType, options, lookupOptions);
};

const mapV2FieldToV1Vo = (
  c: Context,
  field: Field,
  table: Table
): Outcome<Record<string, unknown>> => {
  const dtoRes = mapFieldToDto(field, table.primaryFieldId());
  if (dtoRes.isErr()) return { ok: false, response: sendDomainError(c, dtoRes.error) };

  const dto = dtoRes.value;
  const dbFieldNameResult = field.dbFieldName().andThen((name) => name.value());
  const dbFieldName =
    dto.dbFieldName ?? (dbFieldNameResult.isOk() ? dbFieldNameResult.value : field.id().toString());
  const vo: Record<string, unknown> = {
    ...dto,
    dbFieldName,
  };

  const rawDto = dto as Record<string, unknown>;
  if (dto.type === 'rollup' && isPlainRecord(rawDto.config) && !('lookupOptions' in vo)) {
    vo.lookupOptions = rawDto.config;
  }
  return { ok: true, value: vo };
};

const mapTableFieldsToV1Vos = (
  c: Context,
  table: Table,
  fields: ReadonlyArray<Field> = table.getFields()
): Outcome<Record<string, unknown>[]> => {
  const mapped: Record<string, unknown>[] = [];
  for (const field of fields) {
    const voOut = mapV2FieldToV1Vo(c, field, table);
    if (!voOut.ok) return voOut;
    mapped.push(voOut.value);
  }
  return { ok: true, value: mapped };
};

const projectTableViews = (c: Context, table: Table): Outcome<ViewQueryResultView[]> => {
  const views: ViewQueryResultView[] = [];
  for (const view of table.views()) {
    const projected = projectViewForQuery(table, view);
    if (projected.isErr()) return { ok: false, response: sendDomainError(c, projected.error) };
    views.push(projected.value);
  }
  return { ok: true, value: views };
};

const mapTableSummaryToV1Vo = (c: Context, table: Table): Outcome<Record<string, unknown>> => {
  const dtoRes = mapTableToDto(table);
  if (dtoRes.isErr()) return { ok: false, response: sendDomainError(c, dtoRes.error) };
  const dto = dtoRes.value;
  return {
    ok: true,
    value: {
      id: dto.id,
      name: dto.name,
      dbTableName: dto.dbTableName ?? dto.id,
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
      defaultViewId: dto.views[0]?.id,
      order: 0,
      lastModifiedTime: undefined,
    },
  };
};

const mapTableFullToV1Vo = (
  c: Context,
  table: Table,
  records?: ReadonlyArray<IRecordDto>
): Outcome<Record<string, unknown>> => {
  const dtoRes = mapTableToDto(table);
  if (dtoRes.isErr()) return { ok: false, response: sendDomainError(c, dtoRes.error) };
  const viewsOut = projectTableViews(c, table);
  if (!viewsOut.ok) return viewsOut;
  const fieldsOut = mapTableFieldsToV1Vos(c, table);
  if (!fieldsOut.ok) return fieldsOut;

  const dto = dtoRes.value;
  return {
    ok: true,
    value: {
      id: dto.id,
      name: dto.name,
      dbTableName: dto.dbTableName ?? dto.id,
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
      defaultViewId: viewsOut.value[0]?.id ?? dto.views[0]?.id,
      fields: fieldsOut.value,
      views: viewsOut.value,
      ...(records !== undefined ? { records: [...records] } : {}),
    },
  };
};

const mapRecordReadModel = (record: TableRecordReadModel): IRecordDto => {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record.fields)) {
    if (value !== undefined) {
      fields[key] = value;
    }
  }
  return { id: record.id, fields };
};

const mapFallbackRecord = (
  record: TableRecord,
  fieldKeyMapping?: ReadonlyMap<string, string>
): IRecordDto => {
  const fields: Record<string, unknown> = {};
  for (const entry of record.fields().entries()) {
    const val = entry.value.toValue();
    if (val === undefined) continue;
    const rawId = entry.fieldId.toString();
    const mappedKey = fieldKeyMapping?.get(rawId) ?? rawId;
    fields[mappedKey] = val;
  }
  return { id: record.id().toString(), fields };
};

export const registerHeadlessOpenApiCompatRoutes = <TRealtime extends IRealtimeEngine>(
  app: Hono,
  runtime: IHeadlessRuntime<TRealtime>,
  getExecutionContext: () => IExecutionContext,
  options?: IHeadlessOpenApiCompatOptions
): void => {
  const runSimpleMutation = async <TCommand extends IPublicCommand>(
    c: Context,
    commandResult: {
      match<U>(onOk: (value: TCommand) => U, onErr: (error: DomainError) => U): U;
    },
    body: Record<string, unknown> = { ok: true }
  ): Promise<Response> =>
    commandResult.match(
      async (command) => {
        const execRes = await runtime.commandBus.execute(getExecutionContext(), command);
        if (execRes.isErr()) return sendDomainError(c, execRes.error);
        await runtime.flushComputed();
        return c.json(body, 200);
      },
      async (error) => sendDomainError(c, error)
    );

  const resolveTable = async (c: Context, rawTableId: string): Promise<Outcome<Table>> => {
    const tableIdRes = TableId.create(rawTableId);
    if (tableIdRes.isErr()) {
      return { ok: false, response: sendDomainError(c, tableIdRes.error) };
    }
    const tableRepo = runtime.container.resolve<ITableRepository>(v2CoreTokens.tableRepository);
    const found = await tableRepo.findOne(
      getExecutionContext(),
      TableByIdSpec.create(tableIdRes.value)
    );
    if (found.isErr()) {
      return { ok: false, response: sendDomainError(c, found.error) };
    }
    return { ok: true, value: found.value };
  };

  const queryRecordsByIds = async (
    c: Context,
    tableId: string,
    recordIds: readonly string[],
    fieldKeyType: FieldKeyType
  ): Promise<Outcome<IRecordDto[]>> => {
    if (recordIds.length === 0) return { ok: true, value: [] };
    const queryRes = ListTableRecordsQuery.create({
      tableId,
      selectedRecordIds: [...recordIds],
      ignoreViewQuery: true,
      limit: recordIds.length,
      fieldKeyType,
    });
    if (queryRes.isErr()) {
      return { ok: false, response: sendDomainError(c, queryRes.error) };
    }
    const execRes = await runtime.queryBus.execute<
      ListTableRecordsQuery,
      { records: ReadonlyArray<TableRecordReadModel> }
    >(getExecutionContext(), queryRes.value);
    if (execRes.isErr()) {
      return { ok: false, response: sendDomainError(c, execRes.error) };
    }
    const byId = new Map(execRes.value.records.map((rec) => [rec.id, mapRecordReadModel(rec)]));
    const ordered = recordIds
      .map((id) => byId.get(id))
      .filter((rec): rec is IRecordDto => rec !== undefined);
    return { ok: true, value: ordered };
  };

  const queryViewById = async (
    c: Context,
    tableId: string,
    viewId: string
  ): Promise<Outcome<ViewQueryResultView>> => {
    const queryRes = ListViewsQuery.create({ tableId, viewIds: [viewId] });
    if (queryRes.isErr()) return { ok: false, response: sendDomainError(c, queryRes.error) };
    const execRes = await runtime.queryBus.execute<ListViewsQuery, ListViewsResult>(
      getExecutionContext(),
      queryRes.value
    );
    if (execRes.isErr()) return { ok: false, response: sendDomainError(c, execRes.error) };
    const view = execRes.value.views[0];
    if (!view) {
      return {
        ok: false,
        response: sendDomainError(
          c,
          domainError.notFound({ code: 'view.not_found', message: `View ${viewId} not found` })
        ),
      };
    }
    return { ok: true, value: view };
  };

  // --- Base & Permission routes ---

  app.get('/api/base/:baseId', async (c) => {
    const context = getExecutionContext();
    const baseId = c.req.param('baseId');
    let name = options?.defaultBaseName ?? baseId;

    const listQueryRes = ListBasesQuery.create({ limit: 100, offset: 0 });
    if (listQueryRes.isOk()) {
      const listRes = await runtime.queryBus.execute<ListBasesQuery, ListBasesResult>(
        context,
        listQueryRes.value
      );
      if (listRes.isOk()) {
        const matched = listRes.value.bases.find((base) => base.id().toString() === baseId);
        if (matched) {
          name = matched.name().toString();
        }
      }
    }

    return c.json(
      {
        id: baseId,
        name,
        spaceId: 'spc_local_vcs',
        icon: null,
        role: 'owner',
        collaboratorType: 'owner',
        createdBy: context.actorId.toString(),
      },
      200
    );
  });

  app.get('/api/base/:baseId/permission', (c) =>
    c.json(
      buildPermissionMap([
        ...BASE_ACTIONS,
        ...TABLE_ACTIONS,
        ...VIEW_ACTIONS,
        ...FIELD_ACTIONS,
        ...RECORD_ACTIONS,
        ...TABLE_RECORD_HISTORY_ACTIONS,
        ...AUTOMATION_ACTIONS,
        ...ROUTINE_ACTIONS,
        ...APP_ACTIONS,
      ]),
      200
    )
  );

  app.get('/api/base/:baseId/table/:tableId/permission', (c) =>
    c.json(
      {
        table: buildPermissionMap(TABLE_ACTIONS),
        view: buildPermissionMap(VIEW_ACTIONS),
        record: buildPermissionMap(RECORD_ACTIONS),
        field: buildPermissionMap(FIELD_ACTIONS),
      },
      200
    )
  );

  // --- Table routes ---

  app.get('/api/base/:baseId/table', async (c) => {
    const queryRes = ListTablesQuery.create({ baseId: c.req.param('baseId') });
    if (queryRes.isErr()) return sendDomainError(c, queryRes.error);

    const execRes = await runtime.queryBus.execute<ListTablesQuery, ListTablesResult>(
      getExecutionContext(),
      queryRes.value
    );
    if (execRes.isErr()) return sendDomainError(c, execRes.error);

    const summaries: Record<string, unknown>[] = [];
    for (const table of execRes.value.tables) {
      const summaryOut = mapTableSummaryToV1Vo(c, table);
      if (!summaryOut.ok) return summaryOut.response;
      summaries.push(summaryOut.value);
    }
    return c.json(summaries, 200);
  });

  app.get('/api/base/:baseId/table/:tableId', async (c) => {
    const queryRes = GetTableByIdQuery.create({
      baseId: c.req.param('baseId'),
      tableId: c.req.param('tableId'),
    });
    if (queryRes.isErr()) return sendDomainError(c, queryRes.error);

    const execRes = await runtime.queryBus.execute<GetTableByIdQuery, { table: Table }>(
      getExecutionContext(),
      queryRes.value
    );
    if (execRes.isErr()) return sendDomainError(c, execRes.error);

    const voOut = mapTableFullToV1Vo(c, execRes.value.table);
    if (!voOut.ok) return voOut.response;
    return c.json(voOut.value, 200);
  });

  const buildCreateTableCommandInput = (
    baseId: string,
    body: Record<string, unknown>,
    rawRecords: Record<string, unknown>[],
    passRecordsInCreateTable: boolean
  ): ICreateTableCommandInput => {
    const rawFields = Array.isArray(body.fields) ? body.fields.filter(isPlainRecord) : [];
    const fieldsInput: ITableFieldInput[] =
      rawFields.length > 0
        ? rawFields.map(mapLegacyFieldToV2Field)
        : [{ type: 'singleLineText', name: 'Name', isPrimary: true }];

    const rawViews = Array.isArray(body.views) ? body.views.filter(isPlainRecord) : [];
    const viewsInput =
      rawViews.length > 0
        ? rawViews.map((view) =>
            withDefined({
              type:
                (view.type as 'grid' | 'kanban' | 'gallery' | 'calendar' | 'form' | 'plugin') ??
                'grid',
              name: view.name as string | undefined,
            })
          )
        : [{ type: 'grid' as const, name: 'Grid view' }];

    const tableName =
      typeof body.name === 'string' && body.name.trim().length > 0 ? body.name : 'New table';
    const initialRecords = passRecordsInCreateTable
      ? rawRecords.map((rec) =>
          withDefined({
            id: typeof rec.id === 'string' ? rec.id : undefined,
            fields: isPlainRecord(rec.fields) ? rec.fields : {},
          })
        )
      : [];

    return withDefined({
      baseId,
      tableId: typeof body.tableId === 'string' ? body.tableId : undefined,
      name: tableName,
      dbTableName: typeof body.dbTableName === 'string' ? body.dbTableName : undefined,
      fields: fieldsInput,
      views: viewsInput,
      records: initialRecords,
    }) as ICreateTableCommandInput;
  };

  const applyCreatedTableProperties = async (
    c: Context,
    context: IExecutionContext,
    baseId: string,
    createdTable: Table,
    body: Record<string, unknown>
  ): Promise<Outcome<Table>> => {
    const hasDescription = typeof body.description === 'string';
    const hasIcon = typeof body.icon === 'string';
    if (!hasDescription && !hasIcon) {
      return { ok: true, value: createdTable };
    }

    const propCmdRes = UpdateTablePropertiesCommand.create(
      withDefined({
        baseId,
        tableId: createdTable.id().toString(),
        description: hasDescription ? (body.description as string) : undefined,
        icon: hasIcon ? (body.icon as string) : undefined,
      })
    );
    if (propCmdRes.isErr()) return { ok: false, response: sendDomainError(c, propCmdRes.error) };

    const propExecRes = await runtime.commandBus.execute<
      UpdateTablePropertiesCommand,
      { table: Table }
    >(context, propCmdRes.value);
    if (propExecRes.isErr()) return { ok: false, response: sendDomainError(c, propExecRes.error) };
    return { ok: true, value: propExecRes.value.table };
  };

  const finalizeCreatedTableRecords = async (
    c: Context,
    context: IExecutionContext,
    createdTable: Table,
    rawRecords: Record<string, unknown>[],
    fieldKeyType: FieldKeyType,
    passRecordsInCreateTable: boolean
  ): Promise<Outcome<IRecordDto[]>> => {
    const tableId = createdTable.id().toString();
    if (rawRecords.length > 0 && !passRecordsInCreateTable) {
      const recCmdRes = CreateRecordsCommand.create({
        tableId,
        records: rawRecords.map((rec) => ({
          fields: isPlainRecord(rec.fields) ? rec.fields : {},
        })),
        typecast: true,
        fieldKeyType,
      });
      if (recCmdRes.isErr()) return { ok: false, response: sendDomainError(c, recCmdRes.error) };
      const recExecRes = await runtime.commandBus.execute<
        CreateRecordsCommand,
        CreateRecordsResult
      >(context, recCmdRes.value);
      if (recExecRes.isErr()) return { ok: false, response: sendDomainError(c, recExecRes.error) };
      await runtime.flushComputed();
      const ids = recExecRes.value.records.map((r) => r.id().toString());
      const queriedOut = await queryRecordsByIds(c, tableId, ids, fieldKeyType);
      const records = queriedOut.ok
        ? queriedOut.value
        : recExecRes.value.records.map((r) =>
            mapFallbackRecord(r, recExecRes.value.fieldKeyMapping)
          );
      return { ok: true, value: records };
    }

    await runtime.flushComputed();
    if (!passRecordsInCreateTable) {
      return { ok: true, value: [] };
    }
    const listRes = ListTableRecordsQuery.create({
      tableId,
      ignoreViewQuery: true,
      limit: rawRecords.length,
      fieldKeyType,
    });
    if (listRes.isErr()) return { ok: true, value: [] };
    const queried = await runtime.queryBus.execute<
      ListTableRecordsQuery,
      { records: ReadonlyArray<TableRecordReadModel> }
    >(context, listRes.value);
    return {
      ok: true,
      value: queried.isOk() ? queried.value.records.map(mapRecordReadModel) : [],
    };
  };

  const handleCreateTable = async (c: Context) => {
    const bodyOut = await parseJsonBody(c);
    if (!bodyOut.ok) return bodyOut.response;
    const body = bodyOut.value;
    const context = getExecutionContext();
    const baseId = c.req.param('baseId') ?? '';

    const rawRecords = Array.isArray(body.records) ? body.records.filter(isPlainRecord) : [];
    const fieldKeyType = resolveOpenApiFieldKeyType(body.fieldKeyType);
    const passRecordsInCreateTable = rawRecords.length > 0 && fieldKeyType === FieldKeyType.Id;

    const commandInput = buildCreateTableCommandInput(
      baseId,
      body,
      rawRecords,
      passRecordsInCreateTable
    );
    const cmdRes = CreateTableCommand.create(commandInput, { executionContext: context });
    if (cmdRes.isErr()) return sendDomainError(c, cmdRes.error);

    const execRes = await runtime.commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      cmdRes.value
    );
    if (execRes.isErr()) return sendDomainError(c, execRes.error);

    const tableWithPropsOut = await applyCreatedTableProperties(
      c,
      context,
      baseId,
      execRes.value.table,
      body
    );
    if (!tableWithPropsOut.ok) return tableWithPropsOut.response;

    const recordsOut = await finalizeCreatedTableRecords(
      c,
      context,
      tableWithPropsOut.value,
      rawRecords,
      fieldKeyType,
      passRecordsInCreateTable
    );
    if (!recordsOut.ok) return recordsOut.response;

    const voOut = mapTableFullToV1Vo(c, tableWithPropsOut.value, recordsOut.value);
    if (!voOut.ok) return voOut.response;
    return c.json(voOut.value, 201);
  };

  app.post('/api/base/:baseId/table', handleCreateTable);
  app.post('/api/base/:baseId/table/', handleCreateTable);

  app.put('/api/base/:baseId/table/:tableId/name', async (c) => {
    const bodyOut = await parseJsonBody(c);
    if (!bodyOut.ok) return bodyOut.response;
    return runSimpleMutation(
      c,
      RenameTableCommand.create({
        baseId: c.req.param('baseId'),
        tableId: c.req.param('tableId'),
        name: bodyOut.value.name,
      })
    );
  });

  app.put('/api/base/:baseId/table/:tableId/description', async (c) => {
    const bodyOut = await parseJsonBody(c);
    if (!bodyOut.ok) return bodyOut.response;
    return runSimpleMutation(
      c,
      UpdateTablePropertiesCommand.create({
        baseId: c.req.param('baseId'),
        tableId: c.req.param('tableId'),
        description: (bodyOut.value.description ?? null) as string | null,
      })
    );
  });

  app.put('/api/base/:baseId/table/:tableId/icon', async (c) => {
    const bodyOut = await parseJsonBody(c);
    if (!bodyOut.ok) return bodyOut.response;
    return runSimpleMutation(
      c,
      UpdateTablePropertiesCommand.create({
        baseId: c.req.param('baseId'),
        tableId: c.req.param('tableId'),
        icon: (bodyOut.value.icon ?? null) as string | null,
      })
    );
  });

  const handleDeleteTable = (mode: 'soft' | 'permanent') => async (c: Context) =>
    runSimpleMutation(
      c,
      DeleteTableCommand.create({
        baseId: c.req.param('baseId'),
        tableId: c.req.param('tableId'),
        mode,
      }),
      { deleted: true }
    );

  app.delete('/api/base/:baseId/table/:tableId', handleDeleteTable('soft'));
  app.delete('/api/base/:baseId/table/:tableId/permanent', handleDeleteTable('permanent'));

  // --- Field routes ---

  app.get('/api/table/:tableId/field', async (c) => {
    const tableOut = await resolveTable(c, c.req.param('tableId'));
    if (!tableOut.ok) return tableOut.response;

    const viewIdFilter = c.req.query('viewId');
    let fields = tableOut.value.getFields();
    if (viewIdFilter) {
      const targetView = tableOut.value.views().find((v) => v.id().toString() === viewIdFilter);
      if (targetView) {
        const metaRes = targetView.columnMeta();
        if (metaRes.isOk()) {
          const metaDto = metaRes.value.toDto();
          fields = [...fields].sort((a, b) => {
            const orderA = metaDto[a.id().toString()]?.order ?? Number.MAX_SAFE_INTEGER;
            const orderB = metaDto[b.id().toString()]?.order ?? Number.MAX_SAFE_INTEGER;
            return orderA - orderB;
          });
        }
      }
    }

    const mappedOut = mapTableFieldsToV1Vos(c, tableOut.value, fields);
    if (!mappedOut.ok) return mappedOut.response;
    return c.json(mappedOut.value, 200);
  });

  app.get('/api/table/:tableId/field/:fieldId', async (c) => {
    const tableOut = await resolveTable(c, c.req.param('tableId'));
    if (!tableOut.ok) return tableOut.response;

    const fieldId = c.req.param('fieldId');
    const field = tableOut.value.getFields().find((f) => f.id().toString() === fieldId);
    if (!field) {
      return sendDomainError(
        c,
        domainError.notFound({ code: 'field.not_found', message: `Field ${fieldId} not found` })
      );
    }

    const voOut = mapV2FieldToV1Vo(c, field, tableOut.value);
    if (!voOut.ok) return voOut.response;
    return c.json(voOut.value, 200);
  });

  app.post('/api/table/:tableId/field', async (c) => {
    const bodyOut = await parseJsonBody(c);
    if (!bodyOut.ok) return bodyOut.response;
    const body = bodyOut.value;
    const context = getExecutionContext();
    const tableId = c.req.param('tableId');

    const tableOut = await resolveTable(c, tableId);
    if (!tableOut.ok) return tableOut.response;

    const existingFieldIds = new Set(tableOut.value.getFields().map((f) => f.id().toString()));
    const mappedField = mapLegacyFieldToV2Field(body);
    const cmdRes = CreateFieldCommand.create(
      {
        baseId: tableOut.value.baseId().toString(),
        tableId,
        field: mappedField,
        ...(typeof body.viewId === 'string' ? { viewId: body.viewId } : {}),
        ...(isPlainRecord(body.order) ? { order: body.order } : {}),
      },
      { preloadedTable: tableOut.value }
    );
    if (cmdRes.isErr()) return sendDomainError(c, cmdRes.error);

    const execRes = await runtime.commandBus.execute<CreateFieldCommand, { table: Table }>(
      context,
      cmdRes.value
    );
    if (execRes.isErr()) return sendDomainError(c, execRes.error);

    await runtime.flushComputed();

    const refreshedOut = await resolveTable(c, tableId);
    const targetTable = refreshedOut.ok ? refreshedOut.value : execRes.value.table;
    const requestedId = typeof body.id === 'string' ? body.id : undefined;
    const createdField =
      (requestedId
        ? targetTable.getFields().find((f) => f.id().toString() === requestedId)
        : undefined) ??
      targetTable.getFields().find((f) => !existingFieldIds.has(f.id().toString()));

    if (!createdField) {
      return sendDomainError(
        c,
        domainError.unexpected({ code: 'field.create_missing', message: 'Created field not found' })
      );
    }

    const voOut = mapV2FieldToV1Vo(c, createdField, targetTable);
    if (!voOut.ok) return voOut.response;
    return c.json(voOut.value, 201);
  });

  const handleUpdateField = (updateMode: 'partial' | 'full') => async (c: Context) => {
    const bodyOut = await parseJsonBody(c);
    if (!bodyOut.ok) return bodyOut.response;
    const context = getExecutionContext();
    const tableId = c.req.param('tableId') ?? '';
    const fieldId = c.req.param('fieldId') ?? '';

    const tableOut = await resolveTable(c, tableId);
    if (!tableOut.ok) return tableOut.response;

    const existingField = tableOut.value.getFields().find((f) => f.id().toString() === fieldId);
    if (!existingField) {
      return sendDomainError(
        c,
        domainError.notFound({ code: 'field.not_found', message: `Field ${fieldId} not found` })
      );
    }

    const cmdRes = UpdateFieldCommand.create({
      tableId,
      fieldId,
      field: mapLegacyFieldToV2Update(bodyOut.value, updateMode, existingField.type().toString()),
    });
    if (cmdRes.isErr()) return sendDomainError(c, cmdRes.error);

    const execRes = await runtime.commandBus.execute<UpdateFieldCommand, UpdateFieldResult>(
      context,
      cmdRes.value
    );
    if (execRes.isErr()) return sendDomainError(c, execRes.error);

    await runtime.flushComputed();

    const refreshedOut = await resolveTable(c, tableId);
    const targetTable = refreshedOut.ok ? refreshedOut.value : execRes.value.table;
    const updatedField = targetTable.getFields().find((f) => f.id().toString() === fieldId);
    if (!updatedField) {
      return sendDomainError(
        c,
        domainError.notFound({ code: 'field.not_found', message: `Field ${fieldId} not found` })
      );
    }

    const voOut = mapV2FieldToV1Vo(c, updatedField, targetTable);
    if (!voOut.ok) return voOut.response;
    return c.json(voOut.value, 200);
  };

  app.patch('/api/table/:tableId/field/:fieldId', handleUpdateField('partial'));
  app.put('/api/table/:tableId/field/:fieldId/convert', handleUpdateField('full'));

  app.delete('/api/table/:tableId/field/:fieldId', async (c) => {
    const tableId = c.req.param('tableId') ?? '';
    const fieldId = c.req.param('fieldId') ?? '';

    const tableOut = await resolveTable(c, tableId);
    if (!tableOut.ok) return tableOut.response;

    return runSimpleMutation(
      c,
      DeleteFieldCommand.create({
        baseId: tableOut.value.baseId().toString(),
        tableId,
        fieldId,
      }),
      { deleted: true }
    );
  });

  // --- Record routes ---

  app.get('/api/table/:tableId/record', async (c) => {
    const tableId = c.req.param('tableId');
    const takeRaw = c.req.query('take');
    const skipRaw = c.req.query('skip');
    const rawGroupBy = parseQueryJson(c, 'groupBy');
    const normalizedGroupBy = Array.isArray(rawGroupBy)
      ? rawGroupBy
          .map((item) =>
            typeof item === 'string'
              ? item
              : isPlainRecord(item) && typeof item.fieldId === 'string'
                ? item.fieldId
                : undefined
          )
          .filter((item): item is string => typeof item === 'string' && item.length > 0)
      : undefined;

    const queryInput: Record<string, unknown> = withDefined({
      tableId,
      fieldKeyType: resolveOpenApiFieldKeyType(c.req.query('fieldKeyType')),
      viewId: c.req.query('viewId') || undefined,
      ignoreViewQuery: parseQueryBoolean(c, 'ignoreViewQuery'),
      filter: parseQueryJson(c, 'filter'),
      sort: parseQueryJson(c, 'orderBy') ?? parseQueryJson(c, 'sort'),
      groupBy: normalizedGroupBy && normalizedGroupBy.length > 0 ? normalizedGroupBy : undefined,
      search: parseQuerySearch(c),
      projection: parseQueryArray(c, 'projection'),
      selectedRecordIds: parseQueryArray(c, 'selectedRecordIds'),
      filterLinkCellSelected: parseQueryJson(c, 'filterLinkCellSelected'),
      filterLinkCellCandidate: parseQueryJson(c, 'filterLinkCellCandidate'),
      limit: takeRaw !== undefined && takeRaw !== '' ? Number(takeRaw) : undefined,
      offset: skipRaw !== undefined && skipRaw !== '' ? Number(skipRaw) : undefined,
      cursor: c.req.query('cursor') || undefined,
    });

    const queryRes = ListTableRecordsQuery.create(queryInput);
    if (queryRes.isErr()) return sendDomainError(c, queryRes.error);

    const execRes = await runtime.queryBus.execute<
      ListTableRecordsQuery,
      { records: ReadonlyArray<TableRecordReadModel>; total?: number }
    >(getExecutionContext(), queryRes.value);
    if (execRes.isErr()) return sendDomainError(c, execRes.error);

    return c.json({ records: execRes.value.records.map(mapRecordReadModel) }, 200);
  });

  app.get('/api/table/:tableId/record/:recordId', async (c) => {
    const tableId = c.req.param('tableId');
    const recordId = c.req.param('recordId');
    const fieldKeyType = resolveOpenApiFieldKeyType(c.req.query('fieldKeyType'));
    const projection = parseQueryArray(c, 'projection');

    const queryRes = ListTableRecordsQuery.create(
      withDefined({
        tableId,
        selectedRecordIds: [recordId],
        ignoreViewQuery: true,
        limit: 1,
        fieldKeyType,
        projection,
      })
    );
    if (queryRes.isErr()) return sendDomainError(c, queryRes.error);

    const execRes = await runtime.queryBus.execute<
      ListTableRecordsQuery,
      { records: ReadonlyArray<TableRecordReadModel> }
    >(getExecutionContext(), queryRes.value);
    if (execRes.isErr()) return sendDomainError(c, execRes.error);

    const matched = execRes.value.records[0];
    if (!matched) {
      return sendDomainError(
        c,
        domainError.notFound({ code: 'record.not_found', message: `Record ${recordId} not found` })
      );
    }

    return c.json(mapRecordReadModel(matched), 200);
  });

  app.post('/api/table/:tableId/record', async (c) => {
    const bodyOut = await parseJsonBody(c);
    if (!bodyOut.ok) return bodyOut.response;
    const context = getExecutionContext();
    const tableId = c.req.param('tableId');
    const body = bodyOut.value;
    const fieldKeyType = resolveOpenApiFieldKeyType(body.fieldKeyType);

    if (Array.isArray(body.records) && body.records.length === 0) {
      return c.json({ records: [] }, 201);
    }

    const cmdRes = CreateRecordsCommand.create(
      withDefined({
        tableId,
        records: body.records,
        typecast: body.typecast === true,
        fieldKeyType,
        order: body.order,
      })
    );
    if (cmdRes.isErr()) return sendDomainError(c, cmdRes.error);

    const execRes = await runtime.commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
      context,
      cmdRes.value
    );
    if (execRes.isErr()) return sendDomainError(c, execRes.error);

    await runtime.flushComputed();

    const createdIds = execRes.value.records.map((r) => r.id().toString());
    const queriedOut = await queryRecordsByIds(c, tableId, createdIds, fieldKeyType);
    const records =
      queriedOut.ok && queriedOut.value.length === createdIds.length
        ? queriedOut.value
        : execRes.value.records.map((r) => mapFallbackRecord(r, execRes.value.fieldKeyMapping));

    return c.json({ records }, 201);
  });

  app.post('/api/table/:tableId/record/upsert', async (c) => {
    const bodyOut = await parseJsonBody(c);
    if (!bodyOut.ok) return bodyOut.response;
    const context = getExecutionContext();
    const tableId = c.req.param('tableId');
    const body = bodyOut.value;
    const fieldKeyType = resolveOpenApiFieldKeyType(body.fieldKeyType);

    const cmdRes = UpsertRecordsCommand.create({
      tableId,
      records: body.records,
      matchField: body.matchField,
      onConflict: body.onConflict,
      typecast: body.typecast === true,
      fieldKeyType,
    });
    if (cmdRes.isErr()) return sendDomainError(c, cmdRes.error);

    const execRes = await runtime.commandBus.execute<UpsertRecordsCommand, UpsertRecordsResult>(
      context,
      cmdRes.value
    );
    if (execRes.isErr()) return sendDomainError(c, execRes.error);

    await runtime.flushComputed();

    const recordIds = Array.from(
      new Set(
        execRes.value.results
          .map((row) => row.recordId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      )
    );
    const queriedOut = await queryRecordsByIds(c, tableId, recordIds, fieldKeyType);
    const byId = new Map(
      (queriedOut.ok ? queriedOut.value : []).map((record) => [record.id, record])
    );

    const results = execRes.value.results.map((row) => {
      const hydrated = row.recordId ? byId.get(row.recordId) : undefined;
      const fallback = row.record
        ? mapFallbackRecord(row.record, execRes.value.fieldKeyMapping)
        : undefined;
      return withDefined({
        index: row.index,
        status: row.status,
        recordId: row.recordId,
        record: hydrated ?? fallback,
      });
    });

    return c.json({ results, summary: execRes.value.summary }, 200);
  });

  app.patch('/api/table/:tableId/record/:recordId', async (c) => {
    const bodyOut = await parseJsonBody(c);
    if (!bodyOut.ok) return bodyOut.response;
    const context = getExecutionContext();
    const tableId = c.req.param('tableId');
    const recordId = c.req.param('recordId');
    const body = bodyOut.value;
    const fieldKeyType = resolveOpenApiFieldKeyType(body.fieldKeyType);
    const fields = isPlainRecord(body.record)
      ? body.record.fields
      : isPlainRecord(body.fields)
        ? body.fields
        : undefined;

    if (!isPlainRecord(fields)) {
      return sendOpenApiError(
        c,
        400,
        'validation.record.fields_required',
        'Request body must contain record.fields'
      );
    }

    const cmdRes = UpdateRecordCommand.create(
      withDefined({
        tableId,
        recordId,
        fields,
        typecast: body.typecast === true,
        fieldKeyType,
        order: body.order,
      })
    );
    if (cmdRes.isErr()) return sendDomainError(c, cmdRes.error);

    const execRes = await runtime.commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(
      context,
      cmdRes.value
    );
    if (execRes.isErr()) return sendDomainError(c, execRes.error);

    await runtime.flushComputed();

    const queriedOut = await queryRecordsByIds(c, tableId, [recordId], fieldKeyType);
    const updated =
      queriedOut.ok && queriedOut.value[0]
        ? queriedOut.value[0]
        : mapFallbackRecord(execRes.value.record, execRes.value.fieldKeyMapping);
    return c.json(updated, 200);
  });

  app.patch('/api/table/:tableId/record', async (c) => {
    const bodyOut = await parseJsonBody(c);
    if (!bodyOut.ok) return bodyOut.response;
    const context = getExecutionContext();
    const tableId = c.req.param('tableId');
    const body = bodyOut.value;
    const fieldKeyType = resolveOpenApiFieldKeyType(body.fieldKeyType);

    if (Array.isArray(body.records) && body.records.length === 0) {
      return c.json([], 200);
    }

    const cmdRes = UpdateRecordsCommand.create(
      withDefined({
        tableId,
        records: body.records,
        fields: body.fields,
        filter: body.filter,
        recordIds: body.recordIds,
        typecast: body.typecast === true,
        fieldKeyType,
        order: body.order,
      })
    );
    if (cmdRes.isErr()) return sendDomainError(c, cmdRes.error);

    const execRes = await runtime.commandBus.execute<UpdateRecordsCommand, UpdateRecordsResult>(
      context,
      cmdRes.value
    );
    if (execRes.isErr()) return sendDomainError(c, execRes.error);

    await runtime.flushComputed();

    const updatedRecords = execRes.value.records ?? [];
    const targetIds = updatedRecords.map((r) => r.id().toString());
    const queriedOut = await queryRecordsByIds(c, tableId, targetIds, fieldKeyType);
    const records =
      queriedOut.ok && queriedOut.value.length === targetIds.length
        ? queriedOut.value
        : updatedRecords.map((r) => mapFallbackRecord(r, execRes.value.fieldKeyMapping));

    return c.json(records, 200);
  });

  app.delete('/api/table/:tableId/record/:recordId', async (c) => {
    const tableId = c.req.param('tableId');
    const recordId = c.req.param('recordId');

    const beforeOut = await queryRecordsByIds(c, tableId, [recordId], FieldKeyType.Name);
    const existingRecord = beforeOut.ok ? beforeOut.value[0] : undefined;

    const cmdRes = DeleteRecordsCommand.create({ tableId, recordIds: [recordId] });
    if (cmdRes.isErr()) return sendDomainError(c, cmdRes.error);

    const execRes = await runtime.commandBus.execute(getExecutionContext(), cmdRes.value);
    if (execRes.isErr()) return sendDomainError(c, execRes.error);

    await runtime.flushComputed();
    return c.json(existingRecord ?? { id: recordId, fields: {} }, 200);
  });

  app.delete('/api/table/:tableId/record', async (c) => {
    const tableId = c.req.param('tableId');
    const recordIds = parseQueryArray(c, 'recordIds');
    if (!recordIds || recordIds.length === 0) {
      return sendOpenApiError(
        c,
        400,
        'validation.record_ids.required',
        'Query parameter recordIds is required'
      );
    }

    const cmdRes = DeleteRecordsCommand.create({ tableId, recordIds });
    if (cmdRes.isErr()) return sendDomainError(c, cmdRes.error);

    const execRes = await runtime.commandBus.execute<
      DeleteRecordsCommand,
      { deletedRecordIds: ReadonlyArray<string> }
    >(getExecutionContext(), cmdRes.value);
    if (execRes.isErr()) return sendDomainError(c, execRes.error);

    await runtime.flushComputed();
    return c.json(
      { records: execRes.value.deletedRecordIds.map((id) => ({ id, fields: {} })) },
      200
    );
  });

  // --- View routes ---

  app.get('/api/table/:tableId/view', async (c) => {
    const queryRes = ListViewsQuery.create({ tableId: c.req.param('tableId') });
    if (queryRes.isErr()) return sendDomainError(c, queryRes.error);

    const execRes = await runtime.queryBus.execute<ListViewsQuery, ListViewsResult>(
      getExecutionContext(),
      queryRes.value
    );
    if (execRes.isErr()) return sendDomainError(c, execRes.error);
    return c.json([...execRes.value.views], 200);
  });

  app.get('/api/table/:tableId/view/:viewId', async (c) => {
    const viewOut = await queryViewById(c, c.req.param('tableId'), c.req.param('viewId'));
    if (!viewOut.ok) return viewOut.response;
    return c.json(viewOut.value, 200);
  });

  const asString = (value: unknown): string | undefined =>
    typeof value === 'string' ? value : undefined;
  const asBoolean = (value: unknown): boolean | undefined =>
    typeof value === 'boolean' ? value : undefined;
  const asNumber = (value: unknown): number | undefined =>
    typeof value === 'number' ? value : undefined;

  const buildCreateViewInput = (body: Record<string, unknown>): Record<string, unknown> => {
    const sortObj = isPlainRecord(body.sort) ? body.sort : undefined;
    const sort = Array.isArray(sortObj?.sortObjs)
      ? sortObj.sortObjs
      : Array.isArray(body.sort)
        ? body.sort
        : undefined;
    return withDefined({
      name: asString(body.name),
      type: body.type,
      description: asString(body.description),
      columnMeta: isPlainRecord(body.columnMeta) ? body.columnMeta : undefined,
      options: body.options,
      sourceFilter: body.filter ?? undefined,
      sort,
      manualSort: asBoolean(sortObj?.manualSort),
      group: Array.isArray(body.group) ? body.group : undefined,
      isLocked: asBoolean(body.isLocked),
      order: asNumber(body.order),
      enableShare: asBoolean(body.enableShare),
      shareId: asString(body.shareId),
      shareMeta: isPlainRecord(body.shareMeta) ? body.shareMeta : undefined,
    });
  };

  app.post('/api/table/:tableId/view', async (c) => {
    const bodyOut = await parseJsonBody(c);
    if (!bodyOut.ok) return bodyOut.response;
    const context = getExecutionContext();
    const tableId = c.req.param('tableId');
    const viewInput = buildCreateViewInput(bodyOut.value);

    const cmdRes = CreateViewCommand.create({ tableId, view: viewInput });
    if (cmdRes.isErr()) return sendDomainError(c, cmdRes.error);

    const execRes = await runtime.commandBus.execute<
      CreateViewCommand,
      { table: Table; viewId: { toString(): string } }
    >(context, cmdRes.value);
    if (execRes.isErr()) return sendDomainError(c, execRes.error);

    await runtime.flushComputed();

    const viewOut = await queryViewById(c, tableId, execRes.value.viewId.toString());
    if (!viewOut.ok) return viewOut.response;
    return c.json(viewOut.value, 201);
  });

  app.put('/api/table/:tableId/view/:viewId/name', async (c) => {
    const bodyOut = await parseJsonBody(c);
    if (!bodyOut.ok) return bodyOut.response;
    return runSimpleMutation(
      c,
      RenameViewCommand.create({
        tableId: c.req.param('tableId'),
        viewId: c.req.param('viewId'),
        name: bodyOut.value.name,
      })
    );
  });

  app.put('/api/table/:tableId/view/:viewId/description', async (c) => {
    const bodyOut = await parseJsonBody(c);
    if (!bodyOut.ok) return bodyOut.response;
    return runSimpleMutation(
      c,
      UpdateViewDescriptionCommand.create({
        tableId: c.req.param('tableId'),
        viewId: c.req.param('viewId'),
        description: typeof bodyOut.value.description === 'string' ? bodyOut.value.description : '',
      })
    );
  });

  app.put('/api/table/:tableId/view/:viewId/filter', async (c) => {
    const bodyOut = await parseJsonBody(c);
    if (!bodyOut.ok) return bodyOut.response;
    return runSimpleMutation(
      c,
      UpdateViewFilterCommand.create({
        tableId: c.req.param('tableId'),
        viewId: c.req.param('viewId'),
        filter: bodyOut.value.filter ?? null,
      })
    );
  });

  app.put('/api/table/:tableId/view/:viewId/sort', async (c) => {
    const bodyOut = await parseJsonBody(c);
    if (!bodyOut.ok) return bodyOut.response;
    return runSimpleMutation(
      c,
      UpdateViewSortCommand.create({
        tableId: c.req.param('tableId'),
        viewId: c.req.param('viewId'),
        sort: 'sort' in bodyOut.value ? bodyOut.value.sort : bodyOut.value,
      })
    );
  });

  app.put('/api/table/:tableId/view/:viewId/group', async (c) => {
    const parsedUnknown = await parseJsonUnknown(c);
    if (!parsedUnknown.ok) return parsedUnknown.response;
    const groupValue = Array.isArray(parsedUnknown.value)
      ? parsedUnknown.value
      : isPlainRecord(parsedUnknown.value)
        ? (parsedUnknown.value.group ?? null)
        : null;
    return runSimpleMutation(
      c,
      UpdateViewGroupCommand.create({
        tableId: c.req.param('tableId'),
        viewId: c.req.param('viewId'),
        group: groupValue,
      })
    );
  });

  app.put('/api/table/:tableId/view/:viewId/column-meta', async (c) => {
    const parsedUnknown = await parseJsonUnknown(c);
    if (!parsedUnknown.ok) return parsedUnknown.response;
    const columnMeta = Array.isArray(parsedUnknown.value)
      ? parsedUnknown.value
      : isPlainRecord(parsedUnknown.value)
        ? parsedUnknown.value.columnMeta
        : undefined;
    return runSimpleMutation(
      c,
      UpdateViewColumnMetaCommand.create({
        tableId: c.req.param('tableId'),
        viewId: c.req.param('viewId'),
        columnMeta,
      })
    );
  });

  app.on(['PUT', 'PATCH'], '/api/table/:tableId/view/:viewId/options', async (c) => {
    const bodyOut = await parseJsonBody(c);
    if (!bodyOut.ok) return bodyOut.response;
    const optionsValue = isPlainRecord(bodyOut.value.options)
      ? bodyOut.value.options
      : bodyOut.value;
    return runSimpleMutation(
      c,
      UpdateViewOptionsCommand.create({
        tableId: c.req.param('tableId'),
        viewId: c.req.param('viewId'),
        options: optionsValue,
      })
    );
  });

  app.put('/api/table/:tableId/view/:viewId/locked', async (c) => {
    const bodyOut = await parseOptionalJsonBody(c);
    if (!bodyOut.ok) return bodyOut.response;
    return runSimpleMutation(
      c,
      UpdateViewLockedCommand.create({
        tableId: c.req.param('tableId'),
        viewId: c.req.param('viewId'),
        isLocked: typeof bodyOut.value.isLocked === 'boolean' ? bodyOut.value.isLocked : undefined,
      })
    );
  });

  app.put('/api/table/:tableId/view/:viewId/order', async (c) => {
    const bodyOut = await parseJsonBody(c);
    if (!bodyOut.ok) return bodyOut.response;
    return runSimpleMutation(
      c,
      UpdateViewOrderCommand.create({
        tableId: c.req.param('tableId'),
        viewId: c.req.param('viewId'),
        anchorId: bodyOut.value.anchorId,
        position: bodyOut.value.position,
      })
    );
  });

  app.put('/api/table/:tableId/view/:viewId/snapshot', async (c) => {
    const bodyOut = await parseJsonBody(c);
    if (!bodyOut.ok) return bodyOut.response;
    return runSimpleMutation(
      c,
      ApplyViewSnapshotCommand.create({
        tableId: c.req.param('tableId'),
        snapshot: bodyOut.value.snapshot ?? bodyOut.value,
      })
    );
  });

  app.delete('/api/table/:tableId/view/:viewId', async (c) =>
    runSimpleMutation(
      c,
      DeleteViewCommand.create({
        tableId: c.req.param('tableId'),
        viewId: c.req.param('viewId'),
      }),
      { deleted: true }
    )
  );
};
