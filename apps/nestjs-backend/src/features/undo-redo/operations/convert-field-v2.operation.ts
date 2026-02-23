import { FieldType } from '@teable/core';
import type { IConvertFieldRo, IFieldVo, IOtOperation } from '@teable/core';
import type { IConvertFieldV2Operation } from '../../../cache/types';
import type { IOpsMap } from '../../calculation/utils/compose-maps';
import type { FieldOpenApiV2Service } from '../../field/open-api/field-open-api-v2.service';

export class ConvertFieldV2Operation {
  constructor(private readonly fieldOpenApiV2Service: FieldOpenApiV2Service) {}

  private isComputedField(field: IFieldVo) {
    return (
      field.type === FieldType.Formula ||
      Boolean(field.isLookup) ||
      Boolean(field.isConditionalLookup) ||
      field.type === FieldType.Rollup ||
      field.type === FieldType.ConditionalRollup
    );
  }

  private shouldReplayUndo(oldField: IFieldVo) {
    return !this.isComputedField(oldField);
  }

  private shouldReplayRedo(newField: IFieldVo) {
    return !this.isComputedField(newField);
  }

  private extractLinkDisplayValue(value: unknown): unknown {
    if (value == null) {
      return null;
    }
    if (Array.isArray(value)) {
      const titles = value
        .map((item) =>
          item &&
          typeof item === 'object' &&
          typeof (item as Record<string, unknown>).title === 'string'
            ? (item as Record<string, unknown>).title
            : undefined
        )
        .filter((item): item is string => item != null);
      if (!titles.length) {
        return null;
      }
      return titles.join(', ');
    }
    if (value && typeof value === 'object') {
      const title = (value as Record<string, unknown>).title;
      if (typeof title === 'string') {
        return title;
      }
    }
    return null;
  }

  private applyLinkToTextReplayFallback(modifiedOps: IOpsMap): IOpsMap {
    const next: IOpsMap = {};
    for (const [tableId, recordMap] of Object.entries(modifiedOps)) {
      const nextRecordMap: IOpsMap[string] = {};
      for (const [recordId, ops] of Object.entries(recordMap)) {
        nextRecordMap[recordId] = ops.map((op) => {
          if (op.oi != null) {
            return op;
          }
          const fallback = this.extractLinkDisplayValue(op.od);
          if (fallback == null) {
            return op;
          }
          return {
            ...(op as IOtOperation),
            oi: fallback,
          };
        });
      }
      next[tableId] = nextRecordMap;
    }
    return next;
  }

  private toConvertFieldRo(field: IFieldVo): IConvertFieldRo {
    const ro: IConvertFieldRo = {
      type: field.type,
      name: field.name,
      description: field.description ?? null,
      notNull: Boolean(field.notNull),
      unique: Boolean(field.unique),
      isLookup: Boolean(field.isLookup),
      isConditionalLookup: Boolean(field.isConditionalLookup),
      options: field.options,
      lookupOptions: field.lookupOptions,
      aiConfig: field.aiConfig ?? null,
      ...(field.dbFieldName ? { dbFieldName: field.dbFieldName } : {}),
    };

    if (field.type === FieldType.Link && ro.options && typeof ro.options === 'object') {
      const linkOptions = { ...(ro.options as Record<string, unknown>) };
      if (!Object.prototype.hasOwnProperty.call(linkOptions, 'isOneWay')) {
        linkOptions.isOneWay = false;
      }
      ro.options = linkOptions;
    }

    return ro;
  }

  private async convertWithV2(
    tableId: string,
    fieldId: string,
    field: IFieldVo,
    mode: 'undo' | 'redo'
  ) {
    await this.fieldOpenApiV2Service.convertField(tableId, fieldId, this.toConvertFieldRo(field), {
      emitOperation: false,
      suppressWindowId: true,
      undoRedoMode: mode,
    });
  }

  async undo(operation: IConvertFieldV2Operation) {
    const { tableId } = operation.params;
    const { oldField, modifiedOps } = operation.result;
    await this.convertWithV2(tableId, oldField.id, oldField, 'undo');
    if (modifiedOps && this.shouldReplayUndo(oldField)) {
      await this.fieldOpenApiV2Service.replayModifiedOps(modifiedOps as IOpsMap, 'old', 'undo');
    }
    return operation;
  }

  async redo(operation: IConvertFieldV2Operation) {
    const { tableId } = operation.params;
    const { oldField, newField, modifiedOps } = operation.result;
    await this.convertWithV2(tableId, newField.id, newField, 'redo');
    if (modifiedOps && this.shouldReplayRedo(newField)) {
      const replayOps =
        oldField.type === FieldType.Link &&
        (newField.type === FieldType.SingleLineText || newField.type === FieldType.LongText)
          ? this.applyLinkToTextReplayFallback(modifiedOps as IOpsMap)
          : (modifiedOps as IOpsMap);
      await this.fieldOpenApiV2Service.replayModifiedOps(replayOps, 'new', 'redo');
    }
    return operation;
  }
}
