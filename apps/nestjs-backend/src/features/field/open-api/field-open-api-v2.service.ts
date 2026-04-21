/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable sonarjs/cognitive-complexity */
import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import {
  CellValueType,
  DbFieldType,
  FieldKeyType,
  FieldType,
  generateFieldId,
  generateOperationId,
  getDefaultFormatting,
  getDbFieldType,
  ViewOpBuilder,
  ViewType,
  type IConvertFieldRo,
  type IFieldRo,
  type IFieldVo,
  type IGridColumnMeta,
  type IGridViewOptions,
  type IOtOperation,
  type IUpdateFieldRo,
  type IViewVo,
} from '@teable/core';
import type { IDuplicateFieldRo } from '@teable/openapi';
import {
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
  mapFieldToDto,
} from '@teable/v2-contract-http';
import {
  executeDeleteFieldEndpoint,
  executeDuplicateFieldEndpoint,
  executeUpdateFieldEndpoint,
  executeUpdateRecordEndpoint,
} from '@teable/v2-contract-http-implementation/handlers';
import {
  CreateFieldCommand,
  type CreateFieldResult,
  CreateFieldsCommand,
  type CreateFieldsResult,
  DeleteFieldsCommand,
  DbTableName,
  type Field,
  FieldId,
  type ICommandBus,
  type IExecutionContext,
  type ITableMapper,
  LinkFieldConfig,
  LinkRelationship,
  TableId,
  type Table,
  type TableQueryService,
  v2CoreTokens,
} from '@teable/v2-core';
import { instanceToPlain } from 'class-transformer';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException, getDefaultCodeByStatus } from '../../../custom.exception';
import type { IClsStore } from '../../../types/cls';
import type { IOpsMap } from '../../calculation/utils/compose-maps';
import { DataLoaderService } from '../../data-loader/data-loader.service';
import {
  V2_FIELD_UPDATE_AUDIT_CONTEXT_KEY,
  type IV2FieldUpdateAuditContext,
} from '../../v2/v2-audit-log.constants';
import { V2ContainerService } from '../../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../../v2/v2-execution-context.factory';
import {
  V2_FIELD_DELETE_COMPAT_CONTEXT_KEY,
  type IV2FieldDeleteCompatContext,
} from '../../v2/v2-field-delete-compat.constants';
import {
  V2_FIELD_CONVERT_UNDO_CONTEXT_KEY,
  type IV2FieldConvertUndoContext,
} from '../../v2/v2-undo-redo.constants';
import { adjustFrozenField } from '../../view/utils/derive-frozen-fields';
import { ViewService } from '../../view/view.service';
import { FieldOpenApiService } from './field-open-api.service';

const internalServerError = 'Internal server error';
// eslint-disable-next-line @typescript-eslint/naming-convention
type ConvertFieldExecutionOptions = {
  emitOperation?: boolean;
  suppressWindowId?: boolean;
  undoRedoMode?: 'undo' | 'redo' | 'normal';
};

type IGridViewDeleteSnapshot = {
  viewId: string;
  options: IGridViewOptions;
  columnMeta: IGridColumnMeta;
};

type ITableDtoWithFields = {
  fields: ReadonlyArray<Record<string, unknown>>;
};

type IPreparedLegacyCreateField = {
  v2Field: Record<string, unknown>;
  hasAiConfig: boolean;
  nextAiConfig: IFieldVo['aiConfig'] | undefined;
};

@Injectable()
export class FieldOpenApiV2Service {
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ContextFactory: V2ExecutionContextFactory,
    private readonly dataLoaderService: DataLoaderService,
    private readonly fieldOpenApiService: FieldOpenApiService,
    private readonly viewService: ViewService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  private stripUndefinedDeep(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.stripUndefinedDeep(item));
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (nested === undefined) {
        continue;
      }
      result[key] = this.stripUndefinedDeep(nested);
    }

    return result;
  }

  private invalidateFieldLoader(tableIds: ReadonlyArray<string>) {
    const ids = Array.from(
      new Set(tableIds.filter((id) => typeof id === 'string' && id.length > 0))
    );
    if (!ids.length) return;
    this.dataLoaderService.field.invalidateTables(ids);
  }

  private async captureGridViewDeleteSnapshots(
    tableId: string
  ): Promise<IGridViewDeleteSnapshot[]> {
    const views = await this.viewService.getViews(tableId);
    return views.flatMap((view) => this.toGridViewDeleteSnapshot(view));
  }

  private toGridViewDeleteSnapshot(view: IViewVo): IGridViewDeleteSnapshot[] {
    if (view.type !== ViewType.Grid) {
      return [];
    }

    const options = (view.options ?? {}) as IGridViewOptions;
    const columnMeta = (view.columnMeta ?? {}) as IGridColumnMeta;
    return [
      {
        viewId: view.id,
        options,
        columnMeta,
      },
    ];
  }

  private buildFrozenFieldDeleteOps(
    viewSnapshots: ReadonlyArray<IGridViewDeleteSnapshot>,
    fieldIds: ReadonlyArray<string>
  ): Record<string, IOtOperation[]> {
    const columnMetaUpdate = Object.fromEntries(fieldIds.map((fieldId) => [fieldId, null]));
    const opsMap: Record<string, IOtOperation[]> = {};

    for (const snapshot of viewSnapshots) {
      const nextOptions = adjustFrozenField(
        snapshot.options,
        snapshot.columnMeta,
        columnMetaUpdate as unknown as IGridColumnMeta
      );
      if (!nextOptions) {
        continue;
      }

      opsMap[snapshot.viewId] = [
        ViewOpBuilder.editor.setViewProperty.build({
          key: 'options',
          oldValue: snapshot.options,
          newValue: nextOptions,
        }),
      ];
    }

    return opsMap;
  }

  private attachDeleteFieldCompatContext(
    context: IExecutionContext,
    tableId: string,
    fieldIds: ReadonlyArray<string>,
    payload: Awaited<ReturnType<FieldOpenApiService['captureDeleteFieldsLegacyPayload']>>,
    gridViewSnapshots: ReadonlyArray<IGridViewDeleteSnapshot>
  ): void {
    (
      context as IExecutionContext & {
        [V2_FIELD_DELETE_COMPAT_CONTEXT_KEY]?: IV2FieldDeleteCompatContext;
      }
    )[V2_FIELD_DELETE_COMPAT_CONTEXT_KEY] = {
      tableId,
      userId: this.cls.get('user.id'),
      operationId: generateOperationId(),
      remainingFieldIds: new Set(fieldIds),
      frozenFieldOps: this.buildFrozenFieldDeleteOps(gridViewSnapshots, fieldIds),
      legacyDeletePayload: payload,
    };
  }

  private throwV2Error(
    error: {
      code: string;
      message: string;
      tags?: ReadonlyArray<string>;
      details?: Readonly<Record<string, unknown>>;
    },
    status: number
  ): never {
    throw new CustomHttpException(error.message, getDefaultCodeByStatus(status), {
      domainCode: error.code,
      domainTags: error.tags,
      details: error.details,
    });
  }

  private normalizeFieldVo(field: unknown): IFieldVo {
    const vo = instanceToPlain(field, { excludePrefixes: ['_'] }) as IFieldVo;
    const raw = vo as Record<string, unknown>;

    // Translate v2 conditionalRollup DTO to v1 API format.
    // v2 stores config separately: { options: { expression, formatting, ... }, config: { foreignTableId, lookupFieldId, condition: { filter, sort, limit } } }
    // v1 expects a flat options: { expression, formatting, filter, foreignTableId, lookupFieldId, sort, limit }
    if (raw.type === 'conditionalRollup') {
      const config = raw.config as Record<string, unknown> | undefined;
      if (config) {
        const condition = config.condition as Record<string, unknown> | undefined;
        const opts =
          raw.options && typeof raw.options === 'object' && !Array.isArray(raw.options)
            ? { ...(raw.options as Record<string, unknown>) }
            : {};
        if (config.foreignTableId != null) opts.foreignTableId = config.foreignTableId;
        if (config.lookupFieldId != null) opts.lookupFieldId = config.lookupFieldId;
        if (condition) {
          if (condition.filter !== undefined) opts.filter = condition.filter;
          if (condition.sort !== undefined) opts.sort = condition.sort;
          if (condition.limit !== undefined) opts.limit = condition.limit;
        }
        raw.options = opts;
        delete raw.config;
      }
    }

    // Translate v2 conditionalLookup DTO to v1 API format.
    // v2 stores: { type: 'conditionalLookup', options: { foreignTableId, lookupFieldId, condition }, innerType, innerOptions }
    // v1 expects: { type: innerType, isLookup: true, isConditionalLookup: true, lookupOptions: { foreignTableId, lookupFieldId, filter, sort, limit }, options: innerOptions }
    if (raw.type === 'conditionalLookup') {
      vo.isLookup = true;
      vo.isConditionalLookup = true;
      const v2Options = raw.options as Record<string, unknown> | undefined;
      const innerType = raw.innerType as string | undefined;
      const innerOptions = raw.innerOptions;

      // Build v1 lookupOptions from v2 conditional lookup options
      if (v2Options) {
        const condition = v2Options.condition as Record<string, unknown> | undefined;
        const lookupOptions: Record<string, unknown> = {};
        if (v2Options.foreignTableId != null)
          lookupOptions.foreignTableId = v2Options.foreignTableId;
        if (v2Options.lookupFieldId != null) lookupOptions.lookupFieldId = v2Options.lookupFieldId;
        if (condition) {
          if (condition.filter !== undefined) lookupOptions.filter = condition.filter;
          if (condition.sort !== undefined) lookupOptions.sort = condition.sort;
          if (condition.limit !== undefined) lookupOptions.limit = condition.limit;
        }
        raw.lookupOptions = lookupOptions;
      }

      // Set the type to the inner field type (e.g., 'singleSelect', 'singleLineText', 'number')
      if (innerType) {
        raw.type = innerType;
      }

      // Set options to the inner field options (e.g., {choices: [...]}, {}, {formatting: {...}})
      raw.options = innerOptions ?? {};

      // Clean up v2-specific fields
      delete raw.innerType;
      delete raw.innerOptions;
    }

    if (raw.type === FieldType.Rollup) {
      const config = raw.config as Record<string, unknown> | undefined;
      if (config) {
        const lookupOptions =
          raw.lookupOptions &&
          typeof raw.lookupOptions === 'object' &&
          !Array.isArray(raw.lookupOptions)
            ? { ...(raw.lookupOptions as Record<string, unknown>) }
            : {};

        if (config.linkFieldId != null) lookupOptions.linkFieldId = config.linkFieldId;
        if (config.lookupFieldId != null) lookupOptions.lookupFieldId = config.lookupFieldId;
        if (config.foreignTableId != null) lookupOptions.foreignTableId = config.foreignTableId;

        raw.lookupOptions = lookupOptions;
        delete raw.config;
      }
    }

    if ((raw.type === 'lookup' || vo.isLookup === true) && vo.options == null) {
      vo.options = {};
    }

    if (vo.type === FieldType.Link && vo.options && typeof vo.options === 'object') {
      const linkOpts = vo.options as Record<string, unknown>;
      if (linkOpts.isOneWay === true) {
        delete linkOpts.symmetricFieldId;
      }

      if (raw.meta && typeof raw.meta === 'object') {
        delete raw.meta;
      }
    }

    if (vo.type === FieldType.Button && vo.options && typeof vo.options === 'object') {
      const buttonOpts = vo.options as Record<string, unknown>;
      if (buttonOpts.maxCount === 10 || buttonOpts.maxCount === '10') {
        delete buttonOpts.maxCount;
      }
      if (buttonOpts.resetCount === true || buttonOpts.resetCount === 'true') {
        delete buttonOpts.resetCount;
      }
    }

    if (vo.isMultipleCellValue === false) {
      delete raw.isMultipleCellValue;
    }

    if (vo.isPrimary === false) {
      delete raw.isPrimary;
    }

    if (vo.isComputed === true && raw.isPending == null) {
      raw.isPending = true;
    }

    if (raw.options && typeof raw.options === 'object') {
      raw.options = this.denormalizeLegacyTimeZone(this.stripUndefinedDeep(raw.options));
    }

    if (raw.lookupOptions && typeof raw.lookupOptions === 'object') {
      raw.lookupOptions = this.stripUndefinedDeep(raw.lookupOptions);
    }

    if (raw.aiConfig && typeof raw.aiConfig === 'object') {
      raw.aiConfig = this.stripUndefinedDeep(raw.aiConfig);
    }

    if (vo.type === FieldType.AutoNumber) {
      vo.cellValueType = CellValueType.Number;
      vo.dbFieldType = DbFieldType.Integer;
    }

    if (vo.cellValueType == null) {
      vo.cellValueType = this.deriveCellValueType(vo);
    }

    if (vo.type === FieldType.Rollup && vo.options && typeof vo.options === 'object') {
      const options = vo.options as Record<string, unknown>;
      if (options.formatting == null) {
        const fallbackCellValueType = this.shouldApplyLegacyRollupNumberFormatting(vo)
          ? CellValueType.Number
          : vo.cellValueType;
        const defaultFormatting =
          fallbackCellValueType != null ? getDefaultFormatting(fallbackCellValueType) : undefined;
        if (defaultFormatting) {
          options.formatting = defaultFormatting;
        }
      }
    }

    // Derive isMultipleCellValue when not present for field types that are always multi-value.
    if (vo.isMultipleCellValue == null) {
      const isMultiple = this.deriveIsMultipleCellValue(vo);
      if (isMultiple) {
        vo.isMultipleCellValue = true;
      }
    }

    // Derive dbFieldType when not present from field type and cellValueType.
    if (vo.dbFieldType == null && vo.cellValueType != null) {
      vo.dbFieldType = getDbFieldType(
        vo.type as FieldType,
        vo.cellValueType as CellValueType,
        vo.isMultipleCellValue
      );
    }

    return vo;
  }

  /**
   * Derive cellValueType from field type.
   * Mirrors the FieldValueTypeVisitor from v2-core for deterministic field types.
   */
  private deriveCellValueType(vo: IFieldVo): CellValueType {
    switch (vo.type) {
      case FieldType.Number:
      case FieldType.Rating:
      case FieldType.AutoNumber:
        return CellValueType.Number;
      case FieldType.Checkbox:
        return CellValueType.Boolean;
      case FieldType.Date:
      case FieldType.CreatedTime:
      case FieldType.LastModifiedTime:
        return CellValueType.DateTime;
      case FieldType.SingleLineText:
      case FieldType.LongText:
      case FieldType.SingleSelect:
      case FieldType.MultipleSelect:
      case FieldType.Attachment:
      case FieldType.User:
      case FieldType.CreatedBy:
      case FieldType.LastModifiedBy:
      case FieldType.Link:
      case FieldType.Button:
      default:
        return CellValueType.String;
    }
  }

  /**
   * Derive isMultipleCellValue for field types that are always multi-value.
   */
  private deriveIsMultipleCellValue(vo: IFieldVo): boolean {
    switch (vo.type) {
      case FieldType.MultipleSelect:
      case FieldType.Attachment:
        return true;
      case FieldType.Link: {
        const opts = vo.options as Record<string, unknown> | undefined;
        const relationship = opts?.relationship;
        return relationship === 'oneMany' || relationship === 'manyMany';
      }
      case FieldType.User: {
        const opts = vo.options as Record<string, unknown> | undefined;
        return opts?.isMultiple === true;
      }
      default:
        return false;
    }
  }

  private shouldApplyLegacyRollupNumberFormatting(vo: IFieldVo): boolean {
    if (vo.type !== FieldType.Rollup) {
      return false;
    }
    const options =
      vo.options && typeof vo.options === 'object' && !Array.isArray(vo.options)
        ? (vo.options as Record<string, unknown>)
        : undefined;
    const expression =
      typeof options?.expression === 'string' ? options.expression.trim().toLowerCase() : '';
    if (!expression) {
      return false;
    }
    return (
      expression.startsWith('sum(') ||
      expression.startsWith('average(') ||
      expression.startsWith('count(') ||
      expression.startsWith('counta(') ||
      expression.startsWith('countall(')
    );
  }

  private async getFieldFromV2(
    tableId: string,
    fieldId: string,
    context?: IExecutionContext
  ): Promise<IFieldVo> {
    const container = await this.v2ContainerService.getContainer();
    const tableQueryService = container.resolve<TableQueryService>(v2CoreTokens.tableQueryService);
    const tableMapper = container.resolve<ITableMapper>(v2CoreTokens.tableMapper);
    const tableIdResult = TableId.create(tableId);
    if (tableIdResult.isErr()) {
      throw new HttpException('Invalid table id', HttpStatus.BAD_REQUEST);
    }

    const queryContext = context ?? (await this.v2ContextFactory.createContext());
    const tableResult = await tableQueryService.getById(queryContext, tableIdResult.value);
    if (tableResult.isErr()) {
      const errMsg = tableResult.error.message ?? 'Table not found';
      const isNotFound =
        tableResult.error.code === 'table.not_found' || errMsg.includes('not found');
      throw new HttpException(
        `v2 getFieldFromV2: ${errMsg}`,
        isNotFound ? HttpStatus.NOT_FOUND : HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    const tableDtoResult = tableMapper.toDTO(tableResult.value);
    if (tableDtoResult.isErr()) {
      throw new HttpException(tableDtoResult.error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    return this.extractFieldVoFromTableDto(tableDtoResult.value, fieldId, queryContext);
  }

  private mapDomainFieldToDto(table: Table, field: Field): Record<string, unknown> {
    const fieldDtoResult = mapFieldToDto(field, table.primaryFieldId());
    if (fieldDtoResult.isErr()) {
      throw new HttpException(fieldDtoResult.error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    return fieldDtoResult.value as Record<string, unknown>;
  }

  private enrichLookupLinkMetadata(
    vo: IFieldVo,
    resolveLinkFieldDto: (linkFieldId: string) => Record<string, unknown> | undefined
  ): void {
    // Enrich lookupOptions with link metadata for v1 API compatibility.
    // v2 stores link metadata (relationship, fkHostTableName, selfKeyName, foreignKeyName) on the
    // LinkField, not on the LookupField. v1 API consumers expect these in lookupOptions.
    if (!vo.lookupOptions || !('linkFieldId' in vo.lookupOptions)) {
      return;
    }

    const linkFieldDto = resolveLinkFieldDto(
      (vo.lookupOptions as { linkFieldId: string }).linkFieldId
    );
    if (!linkFieldDto?.options || typeof linkFieldDto.options !== 'object') {
      return;
    }

    const linkOpts = linkFieldDto.options as Record<string, unknown>;
    const lookup = vo.lookupOptions as Record<string, unknown>;
    if (linkOpts.relationship != null) lookup.relationship = linkOpts.relationship;
    if (lookup.foreignTableId == null && linkOpts.foreignTableId != null) {
      lookup.foreignTableId = linkOpts.foreignTableId;
    }
    if (linkOpts.fkHostTableName != null) lookup.fkHostTableName = linkOpts.fkHostTableName;
    if (linkOpts.selfKeyName != null) lookup.selfKeyName = linkOpts.selfKeyName;
    if (linkOpts.foreignKeyName != null) lookup.foreignKeyName = linkOpts.foreignKeyName;
  }

  private async hydrateLookupFieldVo(
    vo: IFieldVo,
    queryContext?: IExecutionContext
  ): Promise<void> {
    if (!vo.isLookup || !vo.lookupOptions || typeof vo.lookupOptions !== 'object') {
      return;
    }

    const lookupOpts = vo.lookupOptions as Record<string, unknown>;
    if (lookupOpts.isOneWay === false) {
      delete lookupOpts.isOneWay;
    }
    if (lookupOpts.symmetricFieldId != null) {
      delete lookupOpts.symmetricFieldId;
    }
    const foreignTableId = lookupOpts.foreignTableId;
    const lookupFieldId = lookupOpts.lookupFieldId;
    if (typeof foreignTableId === 'string' && typeof lookupFieldId === 'string') {
      try {
        const sourceVo = await this.getFieldFromV2(foreignTableId, lookupFieldId, queryContext);
        // Conditional lookup already exposes innerType via normalizeFieldVo.
        // Do not overwrite it with foreign lookup source field type.
        if (!vo.isConditionalLookup && sourceVo.type) {
          vo.type = sourceVo.type;
        }

        const sourceOptions =
          sourceVo.options &&
          typeof sourceVo.options === 'object' &&
          !Array.isArray(sourceVo.options)
            ? (sourceVo.options as Record<string, unknown>)
            : undefined;
        const currentOptions =
          vo.options && typeof vo.options === 'object' && !Array.isArray(vo.options)
            ? (vo.options as Record<string, unknown>)
            : undefined;

        if (sourceOptions || currentOptions) {
          vo.options = {
            ...(sourceOptions ?? {}),
            ...(currentOptions ?? {}),
          } as IFieldVo['options'];
          vo.options = this.denormalizeLegacyTimeZone(vo.options) as IFieldVo['options'];
        }

        if (sourceVo.cellValueType != null && vo.cellValueType == null) {
          vo.cellValueType = sourceVo.cellValueType;
        }
      } catch {
        // If the lookup source field can't be retrieved, we can still return the lookup field with best-effort type inference based on the field definition. This can happen if the foreign table or lookup field has been deleted, or if the user doesn't have access to the foreign table.
      }
    }

    if (vo.options == null) {
      vo.options = {};
    }
  }

  private async extractFieldVoFromTableDto(
    tableDto: ITableDtoWithFields,
    fieldId: string,
    queryContext?: IExecutionContext
  ): Promise<IFieldVo> {
    const field = tableDto.fields.find((item) => item.id === fieldId);
    if (!field) {
      throw new HttpException(`Field ${fieldId} not found`, HttpStatus.NOT_FOUND);
    }

    const vo = this.normalizeFieldVo(field);

    this.enrichLookupLinkMetadata(vo, (linkFieldId) =>
      tableDto.fields.find((f) => f.id === linkFieldId)
    );

    await this.hydrateLookupFieldVo(vo, queryContext);

    return vo;
  }

  private async extractFieldVoFromDomainTable(
    table: Table,
    fieldId: string,
    queryContext?: IExecutionContext
  ): Promise<IFieldVo> {
    const fieldIdResult = FieldId.create(fieldId);
    if (fieldIdResult.isErr()) {
      throw new HttpException('Invalid field id', HttpStatus.BAD_REQUEST);
    }

    const fieldResult = table.getField((candidate) => candidate.id().equals(fieldIdResult.value));
    if (fieldResult.isErr()) {
      throw new HttpException(`Field ${fieldId} not found`, HttpStatus.NOT_FOUND);
    }

    const vo = this.normalizeFieldVo(this.mapDomainFieldToDto(table, fieldResult.value));
    this.enrichLookupLinkMetadata(vo, (linkFieldId) => {
      const linkFieldIdResult = FieldId.create(linkFieldId);
      if (linkFieldIdResult.isErr()) {
        return undefined;
      }
      const linkFieldResult = table.getField((candidate) =>
        candidate.id().equals(linkFieldIdResult.value)
      );
      if (linkFieldResult.isErr()) {
        return undefined;
      }
      return this.mapDomainFieldToDto(table, linkFieldResult.value);
    });

    await this.hydrateLookupFieldVo(vo, queryContext);

    return vo;
  }

  private async getCreateFieldContext(tableId: string): Promise<{
    commandBus: ICommandBus;
    tableQueryService: TableQueryService;
    context: IExecutionContext;
    table: Table;
  }> {
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const tableQueryService = container.resolve<TableQueryService>(v2CoreTokens.tableQueryService);
    const context = await this.v2ContextFactory.createContext();
    const tableIdResult = TableId.create(tableId);
    if (tableIdResult.isErr()) {
      throw new HttpException('Invalid table id', HttpStatus.BAD_REQUEST);
    }

    const tableResult = await tableQueryService.getById(context, tableIdResult.value);
    if (tableResult.isErr()) {
      const errMsg = tableResult.error.message ?? 'Table not found';
      const isNotFound =
        tableResult.error.code === 'table.not_found' || errMsg.includes('not found');
      throw new HttpException(
        errMsg,
        isNotFound ? HttpStatus.NOT_FOUND : HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    return {
      commandBus,
      tableQueryService,
      context,
      table: tableResult.value,
    };
  }

  private async prepareLegacyCreateField(
    fieldRo: IFieldRo,
    currentTable: Table,
    tableQueryService: TableQueryService,
    context: IExecutionContext
  ): Promise<IPreparedLegacyCreateField> {
    const rawFieldRo = fieldRo as Record<string, unknown>;
    const hasAiConfig = Object.prototype.hasOwnProperty.call(rawFieldRo, 'aiConfig');
    const nextAiConfig = hasAiConfig
      ? (rawFieldRo.aiConfig as IFieldVo['aiConfig'] | null | undefined) ?? null
      : undefined;
    const mappedField = this.mapLegacyCreateFieldToV2(fieldRo);
    const v2Field = await this.completeLegacyLinkDbConfigForCreate(
      mappedField,
      currentTable,
      tableQueryService,
      context
    );

    return {
      v2Field,
      hasAiConfig,
      nextAiConfig,
    };
  }

  private collectFieldInvalidateTableIds(
    tableId: string,
    v2Fields: ReadonlyArray<Record<string, unknown>>
  ): string[] {
    const tableIdsToInvalidate = [tableId];

    for (const v2Field of v2Fields) {
      const mappedOptions =
        v2Field.options && typeof v2Field.options === 'object' && !Array.isArray(v2Field.options)
          ? (v2Field.options as Record<string, unknown>)
          : undefined;
      const mappedConfig =
        v2Field.config && typeof v2Field.config === 'object' && !Array.isArray(v2Field.config)
          ? (v2Field.config as Record<string, unknown>)
          : undefined;

      if (typeof mappedOptions?.foreignTableId === 'string') {
        tableIdsToInvalidate.push(mappedOptions.foreignTableId);
      }
      if (typeof mappedConfig?.foreignTableId === 'string') {
        tableIdsToInvalidate.push(mappedConfig.foreignTableId);
      }
    }

    return tableIdsToInvalidate;
  }

  private async materializeCreatedFieldVo(
    tableId: string,
    table: Table,
    fieldId: string,
    context: IExecutionContext,
    options?: {
      forceCompatLookupRead?: boolean;
    }
  ): Promise<IFieldVo> {
    const createdFieldFromDomain = await this.extractFieldVoFromDomainTable(
      table,
      fieldId,
      context
    );
    return options?.forceCompatLookupRead === true || createdFieldFromDomain.isLookup === true
      ? await this.getFieldFromV2(tableId, fieldId, context)
      : createdFieldFromDomain;
  }

  async getField(tableId: string, fieldId: string): Promise<IFieldVo> {
    const context = await this.v2ContextFactory.createContext();
    return this.getFieldFromV2(tableId, fieldId, context);
  }

  private mapLegacyUpdateFieldToV2(
    ro: IUpdateFieldRo,
    currentField?: Record<string, unknown>
  ): Record<string, unknown> {
    const rawRo = ro as Record<string, unknown>;
    const mapped = { ...rawRo };
    const rawOptions = rawRo.options;
    const inputOptions =
      rawOptions && typeof rawOptions === 'object' && !Array.isArray(rawOptions)
        ? (rawOptions as Record<string, unknown>)
        : undefined;
    const currentOptions =
      currentField?.options &&
      typeof currentField.options === 'object' &&
      !Array.isArray(currentField.options)
        ? (currentField.options as Record<string, unknown>)
        : undefined;
    const currentType =
      currentField && typeof currentField.type === 'string' ? currentField.type : undefined;

    const supportsShowAsClear =
      currentType === FieldType.SingleLineText ||
      currentType === FieldType.Formula ||
      currentType === FieldType.Rollup ||
      currentType === 'conditionalRollup';

    if (
      supportsShowAsClear &&
      inputOptions &&
      currentOptions?.showAs != null &&
      !Object.prototype.hasOwnProperty.call(inputOptions, 'showAs')
    ) {
      mapped.options = {
        ...inputOptions,
        showAs: null,
      };
    }

    return mapped;
  }

  private normalizeLegacyTimeZone(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeLegacyTimeZone(item));
    }
    if (!value || typeof value !== 'object') {
      return value;
    }

    const normalized: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'timeZone' && raw === 'UTC') {
        normalized[key] = 'utc';
        continue;
      }
      normalized[key] = this.normalizeLegacyTimeZone(raw);
    }
    return normalized;
  }

  private denormalizeLegacyTimeZone(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.denormalizeLegacyTimeZone(item));
    }
    if (!value || typeof value !== 'object') {
      return value;
    }

    const normalized: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'timeZone' && raw === 'utc') {
        normalized[key] = 'UTC';
        continue;
      }
      normalized[key] = this.denormalizeLegacyTimeZone(raw);
    }
    return normalized;
  }

  private getResultTypePair(raw: Record<string, unknown>): Record<string, unknown> {
    const cellValueType = raw.cellValueType;
    const isMultipleCellValue = raw.isMultipleCellValue;

    if (typeof cellValueType === 'string' && typeof isMultipleCellValue === 'boolean') {
      return isMultipleCellValue ? { cellValueType, isMultipleCellValue } : { cellValueType };
    }
    return {};
  }

  private getLegacyDefaultCreateFieldName(ro: IFieldRo): string | undefined {
    if (ro.isLookup || ro.isConditionalLookup) {
      return undefined;
    }

    switch (ro.type) {
      case FieldType.SingleLineText:
        return 'Label';
      case FieldType.LongText:
        return 'Notes';
      case FieldType.Number:
        return 'Number';
      case FieldType.Rating:
        return 'Rating';
      case FieldType.SingleSelect:
        return 'Select';
      case FieldType.MultipleSelect:
        return 'Tags';
      case FieldType.Attachment:
        return 'Attachments';
      case FieldType.User: {
        const options =
          ro.options && typeof ro.options === 'object' && !Array.isArray(ro.options)
            ? (ro.options as Record<string, unknown>)
            : undefined;
        return options?.isMultiple === true ? 'Collaborators' : 'Collaborator';
      }
      case FieldType.Date:
        return 'Date';
      case FieldType.AutoNumber:
        return 'ID';
      case FieldType.CreatedTime:
        return 'Created Time';
      case FieldType.LastModifiedTime:
        return 'Last Modified Time';
      case FieldType.Checkbox:
        return 'Done';
      case FieldType.Button:
        return 'Button';
      case FieldType.CreatedBy:
        return 'Created By';
      case FieldType.LastModifiedBy:
        return 'Last Modified By';
      case FieldType.Formula:
        return 'Calculation';
      default:
        return undefined;
    }
  }

  private mapLegacyCreateFieldToV2(ro: IFieldRo): Record<string, unknown> {
    const field = ro as Record<string, unknown>;
    const name = typeof field.name === 'string' && field.name.trim().length > 0 ? field.name : null;
    const base: Record<string, unknown> = {
      id: typeof field.id === 'string' ? field.id : generateFieldId(),
    };
    if (name != null) {
      base.name = name;
    } else {
      const legacyDefaultName = this.getLegacyDefaultCreateFieldName(ro);
      if (legacyDefaultName) {
        base.name = legacyDefaultName;
      }
    }
    if (typeof field.dbFieldName === 'string') {
      base.dbFieldName = field.dbFieldName;
    }
    if (Object.prototype.hasOwnProperty.call(field, 'description')) {
      base.description = field.description ?? null;
    }
    if (field.notNull != null) base.notNull = field.notNull;
    if (field.unique != null) base.unique = field.unique;
    if (Object.prototype.hasOwnProperty.call(field, 'aiConfig')) {
      base.aiConfig = field.aiConfig ?? null;
    }

    if (field.isConditionalLookup) {
      const lookupOpts =
        ro.lookupOptions && typeof ro.lookupOptions === 'object' && !Array.isArray(ro.lookupOptions)
          ? (ro.lookupOptions as Record<string, unknown>)
          : undefined;
      const innerOptions =
        ro.options && typeof ro.options === 'object' && !Array.isArray(ro.options)
          ? (ro.options as Record<string, unknown>)
          : undefined;
      return this.normalizeLegacyTimeZone({
        ...base,
        type: 'conditionalLookup',
        ...(typeof field.isMultipleCellValue === 'boolean'
          ? { isMultipleCellValue: field.isMultipleCellValue }
          : {}),
        options: {
          ...(lookupOpts?.foreignTableId != null
            ? { foreignTableId: lookupOpts.foreignTableId }
            : {}),
          ...(lookupOpts?.lookupFieldId != null ? { lookupFieldId: lookupOpts.lookupFieldId } : {}),
          condition: {
            ...(lookupOpts?.filter ? { filter: lookupOpts.filter } : {}),
            ...(lookupOpts?.sort ? { sort: lookupOpts.sort } : {}),
            ...(lookupOpts?.limit != null ? { limit: lookupOpts.limit } : {}),
          },
        },
        ...(innerOptions && Object.keys(innerOptions).length > 0 ? { innerOptions } : {}),
      }) as Record<string, unknown>;
    }

    if (field.isLookup) {
      const lookupOpts =
        ro.lookupOptions && typeof ro.lookupOptions === 'object' && !Array.isArray(ro.lookupOptions)
          ? (ro.lookupOptions as Record<string, unknown>)
          : undefined;
      const innerOptions =
        ro.options && typeof ro.options === 'object' && !Array.isArray(ro.options)
          ? (ro.options as Record<string, unknown>)
          : undefined;
      return this.normalizeLegacyTimeZone({
        ...base,
        type: 'lookup',
        legacyMultiplicityDerivation: true,
        ...(field.isMultipleCellValue === true ? { isMultipleCellValue: true } : {}),
        options: {
          ...(lookupOpts?.linkFieldId != null ? { linkFieldId: lookupOpts.linkFieldId } : {}),
          ...(lookupOpts?.lookupFieldId != null ? { lookupFieldId: lookupOpts.lookupFieldId } : {}),
          ...(lookupOpts?.foreignTableId != null
            ? { foreignTableId: lookupOpts.foreignTableId }
            : {}),
          ...(lookupOpts?.filter ? { filter: lookupOpts.filter } : {}),
          ...(lookupOpts?.sort ? { sort: lookupOpts.sort } : {}),
          ...(lookupOpts?.limit != null ? { limit: lookupOpts.limit } : {}),
        },
        ...(innerOptions && Object.keys(innerOptions).length > 0 ? { innerOptions } : {}),
      }) as Record<string, unknown>;
    }

    if (ro.type === FieldType.Rollup) {
      const opts = (ro.options ?? {}) as Record<string, unknown>;
      const lookupOpts =
        ro.lookupOptions && typeof ro.lookupOptions === 'object' && !Array.isArray(ro.lookupOptions)
          ? (ro.lookupOptions as Record<string, unknown>)
          : undefined;
      const linkFieldId = opts.linkFieldId ?? lookupOpts?.linkFieldId;
      const lookupFieldId = opts.lookupFieldId ?? lookupOpts?.lookupFieldId;
      const foreignTableId = opts.foreignTableId ?? lookupOpts?.foreignTableId;
      const shouldIncludeConfig =
        linkFieldId != null && lookupFieldId != null && foreignTableId != null;
      return this.normalizeLegacyTimeZone({
        ...base,
        type: FieldType.Rollup,
        ...this.getResultTypePair(field),
        options: {
          ...(opts.expression != null ? { expression: opts.expression } : {}),
          ...(opts.formatting != null ? { formatting: opts.formatting } : {}),
          ...(opts.timeZone != null ? { timeZone: opts.timeZone } : {}),
          ...(opts.showAs != null ? { showAs: opts.showAs } : {}),
        },
        ...(shouldIncludeConfig
          ? {
              config: {
                linkFieldId,
                lookupFieldId,
                foreignTableId,
              },
            }
          : {}),
      }) as Record<string, unknown>;
    }

    if (ro.type === FieldType.Link) {
      const opts =
        ro.options && typeof ro.options === 'object' && !Array.isArray(ro.options)
          ? (ro.options as Record<string, unknown>)
          : {};

      return this.normalizeLegacyTimeZone({
        ...base,
        type: FieldType.Link,
        options: {
          ...(opts.baseId != null ? { baseId: opts.baseId } : {}),
          ...(opts.relationship != null ? { relationship: opts.relationship } : {}),
          ...(opts.foreignTableId != null ? { foreignTableId: opts.foreignTableId } : {}),
          ...(opts.lookupFieldId != null ? { lookupFieldId: opts.lookupFieldId } : {}),
          ...(opts.fkHostTableName != null ? { fkHostTableName: opts.fkHostTableName } : {}),
          ...(opts.selfKeyName != null ? { selfKeyName: opts.selfKeyName } : {}),
          ...(opts.foreignKeyName != null ? { foreignKeyName: opts.foreignKeyName } : {}),
          ...(opts.isOneWay != null ? { isOneWay: opts.isOneWay } : {}),
          ...(opts.symmetricFieldId != null ? { symmetricFieldId: opts.symmetricFieldId } : {}),
          ...(Object.prototype.hasOwnProperty.call(opts, 'filterByViewId')
            ? { filterByViewId: opts.filterByViewId }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(opts, 'visibleFieldIds')
            ? { visibleFieldIds: opts.visibleFieldIds }
            : {}),
          ...(opts.filter != null ? { filter: opts.filter } : {}),
        },
      }) as Record<string, unknown>;
    }

    if (ro.type === 'conditionalRollup') {
      const opts = (ro.options ?? {}) as Record<string, unknown>;
      const condition = {
        ...(opts.filter ? { filter: opts.filter } : {}),
        ...(opts.sort ? { sort: opts.sort } : {}),
        ...(opts.limit != null ? { limit: opts.limit } : {}),
      };
      const shouldIncludeConfig =
        opts.foreignTableId != null &&
        opts.lookupFieldId != null &&
        Object.keys(condition).length > 0;
      return this.normalizeLegacyTimeZone({
        ...base,
        type: 'conditionalRollup',
        ...this.getResultTypePair(field),
        options: {
          ...(opts.expression != null ? { expression: opts.expression } : {}),
          ...(opts.formatting != null ? { formatting: opts.formatting } : {}),
          ...(opts.timeZone != null ? { timeZone: opts.timeZone } : {}),
          ...(opts.showAs != null ? { showAs: opts.showAs } : {}),
        },
        ...(shouldIncludeConfig
          ? {
              config: {
                foreignTableId: opts.foreignTableId,
                lookupFieldId: opts.lookupFieldId,
                condition,
              },
            }
          : {}),
      }) as Record<string, unknown>;
    }

    return this.normalizeLegacyTimeZone({
      ...base,
      type: ro.type,
      ...(ro.options != null ? { options: ro.options } : {}),
    }) as Record<string, unknown>;
  }

  private getDbTableNameString(table: Table): string | undefined {
    const dbTableNameResult = table.dbTableName();
    if (dbTableNameResult.isErr()) {
      return undefined;
    }
    const valueResult = dbTableNameResult.value.value();
    if (valueResult.isErr()) {
      return undefined;
    }
    return valueResult.value;
  }

  private hasDuplicatedDbFieldName(table: Table, dbFieldName: string): boolean {
    return table.getFields().some((field) => {
      const existingDbFieldNameResult = field.dbFieldName().andThen((name) => name.value());
      return existingDbFieldNameResult.isOk() && existingDbFieldNameResult.value === dbFieldName;
    });
  }

  private async completeLegacyLinkDbConfigForCreate(
    v2Field: Record<string, unknown>,
    currentTable: Table,
    tableQueryService: TableQueryService,
    context: IExecutionContext
  ): Promise<Record<string, unknown>> {
    if (v2Field.type !== FieldType.Link) {
      return v2Field;
    }

    const options =
      v2Field.options && typeof v2Field.options === 'object' && !Array.isArray(v2Field.options)
        ? (v2Field.options as Record<string, unknown>)
        : undefined;
    if (!options) {
      return v2Field;
    }

    const hasAnyDbConfig =
      options.fkHostTableName != null ||
      options.selfKeyName != null ||
      options.foreignKeyName != null;
    if (hasAnyDbConfig) {
      return v2Field;
    }

    const relationshipRaw = options.relationship;
    const foreignTableIdRaw = options.foreignTableId;
    if (typeof relationshipRaw !== 'string' || typeof foreignTableIdRaw !== 'string') {
      return v2Field;
    }

    const relationshipResult = LinkRelationship.create(relationshipRaw);
    if (relationshipResult.isErr()) {
      return v2Field;
    }

    const relationship = relationshipResult.value.toString();
    const isOneWay = options.isOneWay === true;
    if (relationship === 'manyMany' || (relationship === 'oneMany' && isOneWay)) {
      return v2Field;
    }

    const fieldIdRaw = v2Field.id;
    if (typeof fieldIdRaw !== 'string') {
      return v2Field;
    }

    let fkHostTableNameValue: string | undefined;
    if (relationship === 'oneMany') {
      const foreignTableIdResult = TableId.create(foreignTableIdRaw);
      if (foreignTableIdResult.isErr()) {
        return v2Field;
      }
      const foreignTableResult = await tableQueryService.getById(
        context,
        foreignTableIdResult.value
      );
      if (foreignTableResult.isErr()) {
        return v2Field;
      }
      fkHostTableNameValue = this.getDbTableNameString(foreignTableResult.value);
    } else {
      fkHostTableNameValue = this.getDbTableNameString(currentTable);
    }

    if (!fkHostTableNameValue) {
      return v2Field;
    }

    const fieldIdResult = FieldId.create(fieldIdRaw);
    if (fieldIdResult.isErr()) {
      return v2Field;
    }

    let symmetricFieldIdRaw =
      typeof options.symmetricFieldId === 'string' ? options.symmetricFieldId : undefined;
    if (relationship === 'oneMany' && !isOneWay && !symmetricFieldIdRaw) {
      symmetricFieldIdRaw = generateFieldId();
    }

    let symmetricFieldId: FieldId | undefined;
    if (symmetricFieldIdRaw) {
      const symmetricFieldIdResult = FieldId.create(symmetricFieldIdRaw);
      if (symmetricFieldIdResult.isErr()) {
        return v2Field;
      }
      symmetricFieldId = symmetricFieldIdResult.value;
    }

    const dbTableNameResult = DbTableName.rehydrate(fkHostTableNameValue);
    if (dbTableNameResult.isErr()) {
      return v2Field;
    }

    const dbConfigResult = LinkFieldConfig.buildDbConfig({
      fkHostTableName: dbTableNameResult.value,
      relationship: relationshipResult.value,
      fieldId: fieldIdResult.value,
      symmetricFieldId,
      isOneWay,
    });
    if (dbConfigResult.isErr()) {
      return v2Field;
    }

    const fkHostTableNameResult = dbConfigResult.value.fkHostTableName.value();
    const selfKeyNameResult = dbConfigResult.value.selfKeyName.value();
    const foreignKeyNameResult = dbConfigResult.value.foreignKeyName.value();
    if (
      fkHostTableNameResult.isErr() ||
      selfKeyNameResult.isErr() ||
      foreignKeyNameResult.isErr()
    ) {
      return v2Field;
    }

    return {
      ...v2Field,
      options: {
        ...options,
        fkHostTableName: fkHostTableNameResult.value,
        selfKeyName: selfKeyNameResult.value,
        foreignKeyName: foreignKeyNameResult.value,
        ...(symmetricFieldIdRaw != null ? { symmetricFieldId: symmetricFieldIdRaw } : {}),
      },
    };
  }

  async createField(tableId: string, fieldRo: IFieldRo): Promise<IFieldVo> {
    const { commandBus, tableQueryService, context, table } =
      await this.getCreateFieldContext(tableId);
    const rawFieldRo = fieldRo as Record<string, unknown>;
    const rawDbFieldName = rawFieldRo.dbFieldName;
    if (
      typeof rawDbFieldName === 'string' &&
      this.hasDuplicatedDbFieldName(table, rawDbFieldName)
    ) {
      throw new CustomHttpException(
        `Db Field name ${rawDbFieldName} already exists in this table`,
        getDefaultCodeByStatus(HttpStatus.BAD_REQUEST)
      );
    }

    const preparedField = await this.prepareLegacyCreateField(
      fieldRo,
      table,
      tableQueryService,
      context
    );
    const { hasAiConfig, nextAiConfig, v2Field } = preparedField;
    const legacyViewId =
      fieldRo && typeof fieldRo === 'object' && 'viewId' in fieldRo
        ? (fieldRo.viewId as string | undefined)
        : undefined;
    const legacyOrder =
      fieldRo && typeof fieldRo === 'object' && 'order' in fieldRo
        ? (fieldRo.order as
            | {
                viewId?: unknown;
                orderIndex?: unknown;
              }
            | undefined)
        : undefined;
    const normalizedOrder =
      typeof legacyOrder?.viewId === 'string' && typeof legacyOrder?.orderIndex === 'number'
        ? {
            viewId: legacyOrder.viewId,
            orderIndex: legacyOrder.orderIndex,
          }
        : undefined;
    const commandResult = CreateFieldCommand.create({
      baseId: table.baseId().toString(),
      tableId,
      field: v2Field,
      ...(typeof legacyViewId === 'string' ? { viewId: legacyViewId } : {}),
      ...(normalizedOrder ? { order: normalizedOrder } : {}),
    });

    if (commandResult.isErr()) {
      this.throwV2Error(
        mapDomainErrorToHttpError(commandResult.error),
        mapDomainErrorToHttpStatus(commandResult.error)
      );
    }

    const result = await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
      context,
      commandResult.value
    );

    if (result.isErr()) {
      this.throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }

    this.invalidateFieldLoader(this.collectFieldInvalidateTableIds(tableId, [v2Field]));

    if (typeof v2Field.id === 'string') {
      const shouldForceCompatLookupRead =
        v2Field.type === 'lookup' || v2Field.type === 'conditionalLookup';
      const createdField = await this.materializeCreatedFieldVo(
        tableId,
        result.value.table,
        v2Field.id,
        context,
        {
          forceCompatLookupRead: shouldForceCompatLookupRead,
        }
      );

      if (hasAiConfig) {
        createdField.aiConfig = nextAiConfig as IFieldVo['aiConfig'];
      }

      return createdField;
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async createFields(tableId: string, fieldRos: IFieldRo[]): Promise<IFieldVo[]> {
    if (!fieldRos.length) {
      return [];
    }

    const { commandBus, tableQueryService, context, table } =
      await this.getCreateFieldContext(tableId);
    const explicitDbFieldNames = new Set<string>();
    for (const fieldRo of fieldRos) {
      const rawFieldRo = fieldRo as Record<string, unknown>;
      const rawDbFieldName = rawFieldRo.dbFieldName;
      if (typeof rawDbFieldName !== 'string') {
        continue;
      }
      if (
        explicitDbFieldNames.has(rawDbFieldName) ||
        this.hasDuplicatedDbFieldName(table, rawDbFieldName)
      ) {
        throw new CustomHttpException(
          `Db Field name ${rawDbFieldName} already exists in this table`,
          getDefaultCodeByStatus(HttpStatus.BAD_REQUEST)
        );
      }
      explicitDbFieldNames.add(rawDbFieldName);
    }

    const preparedFields = await Promise.all(
      fieldRos.map((fieldRo) =>
        this.prepareLegacyCreateField(fieldRo, table, tableQueryService, context)
      )
    );
    const commandResult = CreateFieldsCommand.create({
      baseId: table.baseId().toString(),
      tableId,
      fields: preparedFields.map((field) => field.v2Field),
    });

    if (commandResult.isErr()) {
      this.throwV2Error(
        mapDomainErrorToHttpError(commandResult.error),
        mapDomainErrorToHttpStatus(commandResult.error)
      );
    }

    const result = await commandBus.execute<CreateFieldsCommand, CreateFieldsResult>(
      context,
      commandResult.value
    );

    if (result.isErr()) {
      this.throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }

    this.invalidateFieldLoader(
      this.collectFieldInvalidateTableIds(
        tableId,
        preparedFields.map((field) => field.v2Field)
      )
    );

    return await Promise.all(
      preparedFields.map(async ({ v2Field, hasAiConfig, nextAiConfig }) => {
        if (typeof v2Field.id !== 'string') {
          throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
        }

        const shouldForceCompatLookupRead =
          v2Field.type === 'lookup' || v2Field.type === 'conditionalLookup';

        const createdField = await this.materializeCreatedFieldVo(
          tableId,
          result.value.table,
          v2Field.id,
          context,
          {
            forceCompatLookupRead: shouldForceCompatLookupRead,
          }
        );

        if (hasAiConfig) {
          createdField.aiConfig = nextAiConfig as IFieldVo['aiConfig'];
        }

        return createdField;
      })
    );
  }

  async duplicateField(
    tableId: string,
    fieldId: string,
    duplicateFieldRo: IDuplicateFieldRo,
    _windowId?: string
  ): Promise<IFieldVo> {
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const tableQueryService = container.resolve<TableQueryService>(v2CoreTokens.tableQueryService);
    const context = await this.v2ContextFactory.createContext();

    const tableIdResult = TableId.create(tableId);
    if (tableIdResult.isErr()) {
      throw new HttpException('Invalid table id', HttpStatus.BAD_REQUEST);
    }

    const tableResult = await tableQueryService.getById(context, tableIdResult.value);
    if (tableResult.isErr()) {
      const errMsg = tableResult.error.message ?? 'Table not found';
      const isNotFound =
        tableResult.error.code === 'table.not_found' || errMsg.includes('not found');
      throw new HttpException(
        errMsg,
        isNotFound ? HttpStatus.NOT_FOUND : HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    const duplicateResult = await executeDuplicateFieldEndpoint(
      context,
      {
        baseId: tableResult.value.baseId().toString(),
        tableId,
        fieldId,
        includeRecordValues: true,
        newFieldName: duplicateFieldRo.name,
        viewId: duplicateFieldRo.viewId,
      },
      commandBus
    );

    if (!(duplicateResult.status === 200 && duplicateResult.body.ok)) {
      if (!duplicateResult.body.ok) {
        this.throwV2Error(duplicateResult.body.error, duplicateResult.status);
      }
      throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const duplicatedFieldId = duplicateResult.body.data.newFieldId;

    this.invalidateFieldLoader([tableId]);

    return this.getFieldFromV2(tableId, duplicatedFieldId, context);
  }

  async deleteField(tableId: string, fieldId: string): Promise<void> {
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const tableQueryService = container.resolve<TableQueryService>(v2CoreTokens.tableQueryService);
    const context = await this.v2ContextFactory.createContext();
    const tableIdResult = TableId.create(tableId);
    if (tableIdResult.isErr()) {
      throw new HttpException('Invalid table id', HttpStatus.BAD_REQUEST);
    }

    const tableResult = await tableQueryService.getById(context, tableIdResult.value);
    if (tableResult.isErr()) {
      const errMsg = tableResult.error.message ?? 'Table not found';
      const isNotFound =
        tableResult.error.code === 'table.not_found' || errMsg.includes('not found');
      throw new HttpException(
        errMsg,
        isNotFound ? HttpStatus.NOT_FOUND : HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    const [legacyDeletePayload, gridViewSnapshots] = await Promise.all([
      this.fieldOpenApiService.captureDeleteFieldsLegacyPayload(tableId, [fieldId]),
      this.captureGridViewDeleteSnapshots(tableId),
    ]);
    this.attachDeleteFieldCompatContext(
      context,
      tableId,
      [fieldId],
      legacyDeletePayload,
      gridViewSnapshots
    );

    const result = await executeDeleteFieldEndpoint(
      context,
      {
        baseId: tableResult.value.baseId().toString(),
        tableId,
        fieldId,
      },
      commandBus
    );

    if (result.status === 200 && result.body.ok) {
      this.invalidateFieldLoader([tableId]);
      return;
    }

    if (!result.body.ok) {
      this.throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async deleteFields(tableId: string, fieldIds: string[]): Promise<void> {
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const tableQueryService = container.resolve<TableQueryService>(v2CoreTokens.tableQueryService);
    const context = await this.v2ContextFactory.createContext();
    const tableIdResult = TableId.create(tableId);
    if (tableIdResult.isErr()) {
      throw new HttpException('Invalid table id', HttpStatus.BAD_REQUEST);
    }

    const tableResult = await tableQueryService.getById(context, tableIdResult.value);
    if (tableResult.isErr()) {
      const errMsg = tableResult.error.message ?? 'Table not found';
      const isNotFound =
        tableResult.error.code === 'table.not_found' || errMsg.includes('not found');
      throw new HttpException(
        errMsg,
        isNotFound ? HttpStatus.NOT_FOUND : HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    const [legacyDeletePayload, gridViewSnapshots] = await Promise.all([
      this.fieldOpenApiService.captureDeleteFieldsLegacyPayload(tableId, fieldIds),
      this.captureGridViewDeleteSnapshots(tableId),
    ]);
    this.attachDeleteFieldCompatContext(
      context,
      tableId,
      fieldIds,
      legacyDeletePayload,
      gridViewSnapshots
    );

    const commandResult = DeleteFieldsCommand.create({
      baseId: tableResult.value.baseId().toString(),
      tableId,
      fieldIds,
    });
    if (commandResult.isErr()) {
      this.throwV2Error(
        {
          code: commandResult.error.code,
          message: commandResult.error.message,
          tags: commandResult.error.tags,
          details: commandResult.error.details,
        },
        HttpStatus.BAD_REQUEST
      );
    }

    const result = await commandBus.execute(context, commandResult.value);
    if (result.isErr()) {
      this.throwV2Error(
        {
          code: result.error.code,
          message: result.error.message,
          tags: result.error.tags,
          details: result.error.details,
        },
        result.error.code === 'not_found' ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST
      );
    }

    this.invalidateFieldLoader([tableId]);
  }

  async updateField(tableId: string, fieldId: string, updateFieldRo: IUpdateFieldRo) {
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext();
    const currentField = await this.getFieldFromV2(tableId, fieldId, context);

    const v2Input = {
      tableId,
      fieldId,
      field: this.mapLegacyUpdateFieldToV2(updateFieldRo, currentField as Record<string, unknown>),
    };

    (
      context as IExecutionContext & {
        [V2_FIELD_UPDATE_AUDIT_CONTEXT_KEY]?: IV2FieldUpdateAuditContext;
      }
    )[V2_FIELD_UPDATE_AUDIT_CONTEXT_KEY] = {
      tableId,
      fieldId,
      oldField: currentField,
      inputField: { ...v2Input.field },
    };

    const result = await executeUpdateFieldEndpoint(context, v2Input, commandBus);

    if (result.status === 200 && result.body.ok) {
      this.invalidateFieldLoader([tableId]);
      return this.getFieldFromV2(tableId, fieldId, context);
    }

    if (!result.body.ok) {
      this.throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async convertField(
    tableId: string,
    fieldId: string,
    convertFieldRo: IConvertFieldRo,
    executionOptions?: ConvertFieldExecutionOptions
  ) {
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext();
    const shouldTrackUndoContext =
      executionOptions?.emitOperation !== false && Boolean(context.windowId && context.actorId);
    if (executionOptions?.undoRedoMode) {
      context.undoRedo = { mode: executionOptions.undoRedoMode };
    }
    if (executionOptions?.suppressWindowId) {
      delete context.windowId;
    }
    const currentField = await this.getFieldFromV2(tableId, fieldId, context);
    if (shouldTrackUndoContext) {
      (
        context as IExecutionContext & {
          [V2_FIELD_CONVERT_UNDO_CONTEXT_KEY]?: IV2FieldConvertUndoContext;
        }
      )[V2_FIELD_CONVERT_UNDO_CONTEXT_KEY] = {
        tableId,
        fieldId,
        oldField: currentField,
      };
    }
    // v2 uses UpdateFieldCommand for both update and convert
    const v2Input = {
      tableId,
      fieldId,
      field: {
        ...this.mapConvertFieldToV2(convertFieldRo, currentField as Record<string, unknown>),
        replaceOptions: true,
      },
    };

    const result = await executeUpdateFieldEndpoint(context, v2Input, commandBus);

    if (result.status === 200 && result.body.ok) {
      const updatedField = await this.getFieldFromV2(tableId, fieldId, context);

      if (
        convertFieldRo.type === FieldType.Link &&
        typeof convertFieldRo.options === 'object' &&
        convertFieldRo.options != null &&
        (convertFieldRo.options as Record<string, unknown>).isOneWay === false &&
        updatedField.type === FieldType.Link &&
        updatedField.options &&
        typeof updatedField.options === 'object'
      ) {
        (updatedField.options as Record<string, unknown>).isOneWay = false;
      }

      const tableIdsToInvalidate = [tableId];
      const currentOptions =
        currentField && typeof currentField === 'object'
          ? ((currentField as { options?: unknown }).options as Record<string, unknown> | undefined)
          : undefined;
      const updatedOptions =
        updatedField && typeof updatedField === 'object'
          ? ((updatedField as { options?: unknown }).options as Record<string, unknown> | undefined)
          : undefined;
      if (typeof currentOptions?.foreignTableId === 'string') {
        tableIdsToInvalidate.push(currentOptions.foreignTableId);
      }
      if (typeof updatedOptions?.foreignTableId === 'string') {
        tableIdsToInvalidate.push(updatedOptions.foreignTableId);
      }
      this.invalidateFieldLoader(tableIdsToInvalidate);

      return updatedField;
    }

    if (!result.body.ok) {
      this.throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async replayModifiedOps(
    modifiedOps: IOpsMap,
    direction: 'old' | 'new',
    undoRedoMode: 'undo' | 'redo'
  ): Promise<void> {
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext();
    context.undoRedo = { mode: undoRedoMode };
    delete context.windowId;

    for (const [tableId, opsByRecordId] of Object.entries(modifiedOps)) {
      for (const [recordId, ops] of Object.entries(opsByRecordId)) {
        const fields: Record<string, unknown> = {};
        for (const op of ops) {
          if (!Array.isArray(op.p) || op.p[0] !== 'fields') {
            continue;
          }
          const fieldPath = op.p[1];
          if (typeof fieldPath !== 'string') {
            continue;
          }
          fields[fieldPath] = (direction === 'old' ? op.od : op.oi) ?? null;
        }

        if (!Object.keys(fields).length) {
          continue;
        }

        const result = await executeUpdateRecordEndpoint(
          context,
          {
            tableId,
            recordId,
            fields,
            fieldKeyType: FieldKeyType.Id,
            typecast: false,
          },
          commandBus
        );

        if (!(result.status === 200 && result.body.ok)) {
          if (!result.body.ok) {
            this.throwV2Error(result.body.error, result.status);
          }
          throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
        }
      }
    }
  }

  /**
   * Map v1 IConvertFieldRo to v2 UpdateFieldCommand field input.
   *
   * v1 represents conditional lookups/rollups differently from v2:
   * - v1 conditional lookup: type=innerType + isConditionalLookup + lookupOptions
   * - v2 conditional lookup: type='conditionalLookup' + options with condition
   * - v1 rollup: type='rollup' + options with linkFieldId/lookupFieldId/expression
   * - v2 rollup: type='rollup' + config with linkFieldId/lookupFieldId + options with expression
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  private mapConvertFieldToV2(
    ro: IConvertFieldRo,
    currentField?: Record<string, unknown>
  ): Record<string, unknown> {
    const base: Record<string, unknown> = {};
    if (ro.name != null) base.name = ro.name;
    if (Object.prototype.hasOwnProperty.call(ro, 'description')) {
      base.description = ro.description ?? null;
    }
    if (ro.notNull != null) base.notNull = ro.notNull;
    if (ro.unique != null) base.unique = ro.unique;
    if ((ro as Record<string, unknown>).dbFieldName != null) {
      base.dbFieldName = (ro as Record<string, unknown>).dbFieldName;
    }
    if (Object.prototype.hasOwnProperty.call(ro, 'aiConfig')) {
      base.aiConfig = ro.aiConfig ?? null;
    }

    // Case 1: Conditional Rollup
    if (ro.type === 'conditionalRollup') {
      const opts = (ro.options ?? {}) as Record<string, unknown>;
      const hasShowAs = Object.prototype.hasOwnProperty.call(opts, 'showAs');
      const shouldClearShowAs =
        !hasShowAs && currentField?.type === 'conditionalRollup' && currentField?.options != null;
      const condition: Record<string, unknown> = {
        ...(opts.filter ? { filter: opts.filter } : {}),
        ...(opts.sort ? { sort: opts.sort } : {}),
        ...(opts.limit != null ? { limit: opts.limit } : {}),
      };
      const shouldIncludeConfig =
        opts.foreignTableId != null &&
        opts.lookupFieldId != null &&
        Object.keys(condition).length > 0;
      return {
        ...base,
        type: 'conditionalRollup',
        ...this.getResultTypePair(ro as Record<string, unknown>),
        options: {
          ...(opts.expression != null ? { expression: opts.expression } : {}),
          ...(opts.formatting != null ? { formatting: opts.formatting } : {}),
          ...(opts.timeZone != null ? { timeZone: opts.timeZone } : {}),
          ...(opts.showAs != null ? { showAs: opts.showAs } : {}),
          ...(shouldClearShowAs ? { showAs: null } : {}),
        },
        ...(shouldIncludeConfig
          ? {
              config: {
                foreignTableId: opts.foreignTableId,
                lookupFieldId: opts.lookupFieldId,
                condition,
              },
            }
          : {}),
      };
    }

    // Case 2: Conditional Lookup
    if (ro.isConditionalLookup) {
      const lookupOpts = ro.lookupOptions as Record<string, unknown> | undefined;
      const opts =
        ro.options && typeof ro.options === 'object' && !Array.isArray(ro.options)
          ? (ro.options as Record<string, unknown>)
          : {};
      const roRecord = ro as Record<string, unknown>;
      const currentLookupOpts =
        currentField?.lookupOptions &&
        typeof currentField.lookupOptions === 'object' &&
        !Array.isArray(currentField.lookupOptions)
          ? (currentField.lookupOptions as Record<string, unknown>)
          : undefined;
      const normalizeConditionalLookupConfig = (value?: Record<string, unknown>) => ({
        foreignTableId: value?.foreignTableId,
        lookupFieldId: value?.lookupFieldId,
        filter: value?.filter ?? null,
        sort: value?.sort ?? undefined,
        limit: value?.limit ?? undefined,
      });
      const nextLookupConfig = normalizeConditionalLookupConfig(lookupOpts);
      const prevLookupConfig = normalizeConditionalLookupConfig(currentLookupOpts);
      const shouldUpdateCondition =
        JSON.stringify(nextLookupConfig) !== JSON.stringify(prevLookupConfig);
      const currentCellValueType =
        typeof currentField?.cellValueType === 'string' ? currentField.cellValueType : undefined;
      const currentIsMultipleCellValue =
        typeof currentField?.isMultipleCellValue === 'boolean'
          ? currentField.isMultipleCellValue
          : undefined;
      const shouldSkipFormulaStringFallback =
        ro.type === FieldType.Formula &&
        typeof roRecord.cellValueType !== 'string' &&
        currentCellValueType === CellValueType.String &&
        opts.formatting != null;
      return {
        ...base,
        type: 'conditionalLookup',
        ...(typeof roRecord.cellValueType === 'string'
          ? { cellValueType: roRecord.cellValueType }
          : currentCellValueType && !shouldSkipFormulaStringFallback
            ? { cellValueType: currentCellValueType }
            : {}),
        ...(typeof roRecord.isMultipleCellValue === 'boolean'
          ? { isMultipleCellValue: roRecord.isMultipleCellValue }
          : typeof currentIsMultipleCellValue === 'boolean'
            ? { isMultipleCellValue: currentIsMultipleCellValue }
            : {}),
        options: {
          ...(lookupOpts && shouldUpdateCondition
            ? {
                foreignTableId: lookupOpts.foreignTableId,
                lookupFieldId: lookupOpts.lookupFieldId,
                condition: {
                  ...(lookupOpts.filter ? { filter: lookupOpts.filter } : {}),
                  ...(lookupOpts.sort ? { sort: lookupOpts.sort } : {}),
                  ...(lookupOpts.limit != null ? { limit: lookupOpts.limit } : {}),
                },
              }
            : {}),
          // Keep v1 convert semantics for conditional lookup inner field:
          // the looked-up field type/options can be updated independently from condition.
          ...(typeof ro.type === 'string' ? { innerType: ro.type } : {}),
          ...(Object.keys(opts).length > 0 ? { innerOptions: opts } : {}),
        },
      };
    }

    // Case 3: Regular Lookup (non-conditional)
    if (
      ro.isLookup &&
      ro.lookupOptions &&
      ro.type !== FieldType.Formula &&
      ro.type !== FieldType.Rollup
    ) {
      const lookupOpts = ro.lookupOptions as Record<string, unknown>;
      const currentLookupOpts =
        currentField?.lookupOptions &&
        typeof currentField.lookupOptions === 'object' &&
        !Array.isArray(currentField.lookupOptions)
          ? (currentField.lookupOptions as Record<string, unknown>)
          : undefined;
      const opts =
        ro.options && typeof ro.options === 'object' && !Array.isArray(ro.options)
          ? (ro.options as Record<string, unknown>)
          : undefined;
      const currentOpts =
        currentField?.options &&
        typeof currentField.options === 'object' &&
        !Array.isArray(currentField.options)
          ? (currentField.options as Record<string, unknown>)
          : undefined;
      const hasShowAs = opts ? Object.prototype.hasOwnProperty.call(opts, 'showAs') : false;
      const shouldClearShowAs =
        !hasShowAs && currentField?.isLookup === true && currentOpts?.showAs != null;
      const hasFilterPatch = Object.prototype.hasOwnProperty.call(lookupOpts, 'filter');
      const hasSortPatch = Object.prototype.hasOwnProperty.call(lookupOpts, 'sort');
      const hasLimitPatch = Object.prototype.hasOwnProperty.call(lookupOpts, 'limit');
      const shouldClearFilter = !hasFilterPatch && currentLookupOpts?.filter !== undefined;
      const shouldClearSort = !hasSortPatch && currentLookupOpts?.sort !== undefined;
      const shouldClearLimit = !hasLimitPatch && currentLookupOpts?.limit !== undefined;
      const lookupOptions: Record<string, unknown> = {
        ...(lookupOpts.linkFieldId != null ? { linkFieldId: lookupOpts.linkFieldId } : {}),
        ...(lookupOpts.lookupFieldId != null ? { lookupFieldId: lookupOpts.lookupFieldId } : {}),
        ...(lookupOpts.foreignTableId != null ? { foreignTableId: lookupOpts.foreignTableId } : {}),
        ...(hasFilterPatch || shouldClearFilter ? { filter: lookupOpts.filter } : {}),
        ...(hasSortPatch || shouldClearSort ? { sort: lookupOpts.sort } : {}),
        ...(hasLimitPatch || shouldClearLimit ? { limit: lookupOpts.limit } : {}),
        ...(shouldClearShowAs ? { showAs: null } : {}),
      };
      return {
        ...base,
        type: 'lookup',
        options: lookupOptions,
      };
    }

    // Case 4: Regular Rollup
    if (ro.type === 'rollup') {
      const opts = (ro.options ?? {}) as Record<string, unknown>;
      const lookupOpts =
        ro.lookupOptions && typeof ro.lookupOptions === 'object' && !Array.isArray(ro.lookupOptions)
          ? (ro.lookupOptions as Record<string, unknown>)
          : undefined;
      const currentOpts =
        currentField?.options &&
        typeof currentField.options === 'object' &&
        !Array.isArray(currentField.options)
          ? (currentField.options as Record<string, unknown>)
          : undefined;
      const linkFieldId = opts.linkFieldId ?? lookupOpts?.linkFieldId;
      const lookupFieldId = opts.lookupFieldId ?? lookupOpts?.lookupFieldId;
      const foreignTableId = opts.foreignTableId ?? lookupOpts?.foreignTableId;
      const hasShowAs = Object.prototype.hasOwnProperty.call(opts, 'showAs');
      const hasExpressionPatch = Object.prototype.hasOwnProperty.call(opts, 'expression');
      const shouldClearShowAs =
        !hasShowAs && currentField?.type === 'rollup' && currentField?.options != null;
      const expression =
        typeof opts.expression === 'string'
          ? opts.expression
          : !hasExpressionPatch && typeof currentOpts?.expression === 'string'
            ? currentOpts.expression
            : undefined;
      const shouldIncludeConfig =
        linkFieldId != null && lookupFieldId != null && foreignTableId != null;
      return {
        ...base,
        type: 'rollup',
        options: {
          ...(expression != null ? { expression } : {}),
          ...(opts.formatting != null ? { formatting: opts.formatting } : {}),
          ...(opts.timeZone != null ? { timeZone: opts.timeZone } : {}),
          ...(opts.showAs != null ? { showAs: opts.showAs } : {}),
          ...(shouldClearShowAs ? { showAs: null } : {}),
        },
        ...(shouldIncludeConfig
          ? {
              config: {
                linkFieldId,
                lookupFieldId,
                foreignTableId,
              },
            }
          : {}),
      };
    }

    // Case 5: Formula
    if (ro.type === 'formula') {
      const opts = (ro.options ?? {}) as Record<string, unknown>;
      const currentOpts =
        currentField?.options && typeof currentField.options === 'object'
          ? (currentField.options as Record<string, unknown>)
          : undefined;
      const hasShowAs = Object.prototype.hasOwnProperty.call(opts, 'showAs');
      const hasExpressionPatch = Object.prototype.hasOwnProperty.call(opts, 'expression');
      const shouldClearShowAs =
        !hasShowAs && currentField?.type === 'formula' && currentField?.options != null;
      const zodDefaultExpressions = new Set(['LAST_MODIFIED_TIME()', 'CREATED_TIME()']);
      const newExpression = typeof opts.expression === 'string' ? opts.expression : undefined;
      const currentExpression =
        currentOpts && typeof currentOpts.expression === 'string'
          ? currentOpts.expression
          : undefined;
      const expression =
        newExpression && zodDefaultExpressions.has(newExpression) && currentExpression
          ? currentExpression
          : newExpression ??
            (!hasExpressionPatch && currentExpression != null ? currentExpression : undefined);

      return {
        ...base,
        type: 'formula',
        options: {
          ...(expression != null ? { expression } : {}),
          ...(opts.timeZone != null ? { timeZone: opts.timeZone } : {}),
          ...(opts.formatting != null ? { formatting: opts.formatting } : {}),
          ...(opts.showAs != null ? { showAs: opts.showAs } : {}),
          ...(shouldClearShowAs ? { showAs: null } : {}),
        },
      };
    }

    // Case 6: Default pass-through
    const shouldClearShowAsOnPassThrough =
      (ro.type === FieldType.SingleLineText || ro.type === FieldType.Number) &&
      ro.options != null &&
      typeof ro.options === 'object' &&
      !Array.isArray(ro.options) &&
      !Object.prototype.hasOwnProperty.call(ro.options, 'showAs') &&
      currentField?.type === ro.type &&
      currentField?.options != null;

    const passThroughOptions =
      shouldClearShowAsOnPassThrough && ro.options && typeof ro.options === 'object'
        ? { ...(ro.options as Record<string, unknown>), showAs: null }
        : ro.options;

    return {
      ...base,
      type: ro.type,
      options: passThroughOptions,
    };
  }
}
