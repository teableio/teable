/* eslint-disable sonarjs/cognitive-complexity */
import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import type { IConvertFieldRo, IFieldVo, IUpdateFieldRo } from '@teable/core';
import { CellValueType, DbFieldType, FieldKeyType, FieldType, getDbFieldType } from '@teable/core';
import {
  executeUpdateFieldEndpoint,
  executeUpdateRecordEndpoint,
} from '@teable/v2-contract-http-implementation/handlers';
import { TableId, v2CoreTokens } from '@teable/v2-core';
import type {
  ICommandBus,
  IExecutionContext,
  TableQueryService,
  ITableMapper,
} from '@teable/v2-core';
import { instanceToPlain } from 'class-transformer';
import { CustomHttpException, getDefaultCodeByStatus } from '../../../custom.exception';
import type { IOpsMap } from '../../calculation/utils/compose-maps';
import { DataLoaderService } from '../../data-loader/data-loader.service';
import {
  V2_FIELD_UPDATE_AUDIT_CONTEXT_KEY,
  type IV2FieldUpdateAuditContext,
} from '../../v2/v2-audit-log.constants';
import { V2ContainerService } from '../../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../../v2/v2-execution-context.factory';
import {
  V2_FIELD_CONVERT_UNDO_CONTEXT_KEY,
  type IV2FieldConvertUndoContext,
} from '../../v2/v2-undo-redo.constants';

const internalServerError = 'Internal server error';
// eslint-disable-next-line @typescript-eslint/naming-convention
type ConvertFieldExecutionOptions = {
  emitOperation?: boolean;
  suppressWindowId?: boolean;
  undoRedoMode?: 'undo' | 'redo' | 'normal';
};

@Injectable()
export class FieldOpenApiV2Service {
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ContextFactory: V2ExecutionContextFactory,
    private readonly dataLoaderService: DataLoaderService
  ) {}

  private invalidateFieldLoader(tableIds: ReadonlyArray<string>) {
    const ids = Array.from(
      new Set(tableIds.filter((id) => typeof id === 'string' && id.length > 0))
    );
    if (!ids.length) return;
    this.dataLoaderService.field.invalidateTables(ids);
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
    // Ensure unique is always a boolean (v2 persistence omits false, but v1 API expects it)
    if (vo.unique == null) {
      vo.unique = false;
    }
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
      } else if (
        linkOpts.isOneWay === false &&
        linkOpts.relationship !== 'oneOne' &&
        linkOpts.relationship !== 'one_one'
      ) {
        delete linkOpts.isOneWay;
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

    if (vo.type === FieldType.AutoNumber) {
      vo.cellValueType = CellValueType.Number;
      vo.dbFieldType = DbFieldType.Integer;
    }

    if (vo.cellValueType == null) {
      vo.cellValueType = this.deriveCellValueType(vo);
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

    const field = tableDtoResult.value.fields.find((item) => item.id === fieldId);
    if (!field) {
      throw new HttpException(`Field ${fieldId} not found`, HttpStatus.NOT_FOUND);
    }

    const vo = this.normalizeFieldVo(field);

    // Enrich lookupOptions with link metadata for v1 API compatibility.
    // v2 stores link metadata (relationship, fkHostTableName, selfKeyName, foreignKeyName) on the
    // LinkField, not on the LookupField. v1 API consumers expect these in lookupOptions.
    if (vo.lookupOptions && 'linkFieldId' in vo.lookupOptions) {
      const linkFieldDto = tableDtoResult.value.fields.find(
        (f) => f.id === (vo.lookupOptions as { linkFieldId: string }).linkFieldId
      );
      if (linkFieldDto?.options && typeof linkFieldDto.options === 'object') {
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
    }

    if (vo.isLookup && vo.lookupOptions && typeof vo.lookupOptions === 'object') {
      const lookupOpts = vo.lookupOptions as Record<string, unknown>;
      const foreignTableId = lookupOpts.foreignTableId;
      const lookupFieldId = lookupOpts.lookupFieldId;
      if (typeof foreignTableId === 'string' && typeof lookupFieldId === 'string') {
        try {
          const sourceVo = await this.getFieldFromV2(foreignTableId, lookupFieldId, queryContext);
          if (sourceVo.type) {
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

    return vo;
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
      if (result.body.error.message === 'No changes to apply') {
        return this.getFieldFromV2(tableId, fieldId, context);
      }
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
    if (ro.description != null) base.description = ro.description;
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
        cellValueType: (ro as Record<string, unknown>).cellValueType,
        isMultipleCellValue: (ro as Record<string, unknown>).isMultipleCellValue,
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
    if (ro.isLookup && ro.lookupOptions) {
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
      const linkFieldId = opts.linkFieldId ?? lookupOpts?.linkFieldId;
      const lookupFieldId = opts.lookupFieldId ?? lookupOpts?.lookupFieldId;
      const foreignTableId = opts.foreignTableId ?? lookupOpts?.foreignTableId;
      const hasShowAs = Object.prototype.hasOwnProperty.call(opts, 'showAs');
      const shouldClearShowAs =
        !hasShowAs && currentField?.type === 'rollup' && currentField?.options != null;
      const shouldIncludeConfig =
        linkFieldId != null && lookupFieldId != null && foreignTableId != null;
      return {
        ...base,
        type: 'rollup',
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
          : newExpression;

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
