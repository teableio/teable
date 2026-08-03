import { FieldType } from '@teable/core';
import type { IFieldVo, IOtOperation } from '@teable/core';
import type { PrismaService } from '@teable/db-main-prisma';
import type { IConvertFieldOperation } from '../../../cache/types';
import { OperationName } from '../../../cache/types';
import type { IThresholdConfig } from '../../../configs/threshold.config';
import type { IOpsMap } from '../../calculation/utils/compose-maps';
import { createFieldInstanceByVo } from '../../field/model/factory';
import type { FieldOpenApiService } from '../../field/open-api/field-open-api.service';

export interface IConvertFieldPayload {
  windowId: string;
  tableId: string;
  userId: string;
  oldField: IFieldVo;
  newField: IFieldVo;
  modifiedOps?: IOpsMap;
  references?: string[];
  supplementChange?: {
    tableId: string;
    newField: IFieldVo;
    oldField: IFieldVo;
  };
}

export class ConvertFieldOperation {
  constructor(
    private readonly fieldOpenApiService: FieldOpenApiService,
    private readonly prismaService: PrismaService,
    private readonly thresholdConfig: IThresholdConfig
  ) {}

  async event2Operation(payload: IConvertFieldPayload): Promise<IConvertFieldOperation> {
    return {
      name: OperationName.ConvertField,
      params: {
        tableId: payload.tableId,
      },
      result: {
        oldField: payload.oldField,
        newField: payload.newField,
        modifiedOps: payload.modifiedOps,
        references: payload.references,
        supplementChange: payload.supplementChange,
      },
    };
  }

  // convert oi to od, od to oi in IOtOperation
  private revertOpsMap(opsMap: IOpsMap) {
    return Object.entries(opsMap).reduce<IOpsMap>((acc, [key, opsKeyMap]) => {
      acc[key] = Object.entries(opsKeyMap).reduce<Record<string, IOtOperation[]>>(
        (opAcc, [opsKey, op]) => {
          opAcc[opsKey] = op.map(
            (singleOp) =>
              ({
                ...singleOp,
                oi: singleOp.od,
                od: singleOp.oi,
              }) as IOtOperation
          );
          return opAcc;
        },
        {}
      );
      return acc;
    }, {});
  }

  private isLinkForeignTableChanged(oldField: IFieldVo, newField: IFieldVo) {
    if (oldField.type !== FieldType.Link || newField.type !== FieldType.Link) {
      return false;
    }
    if (oldField.isLookup || newField.isLookup) {
      return false;
    }
    const oldOptions =
      oldField.options && typeof oldField.options === 'object'
        ? (oldField.options as Record<string, unknown>)
        : undefined;
    const newOptions =
      newField.options && typeof newField.options === 'object'
        ? (newField.options as Record<string, unknown>)
        : undefined;
    const oldForeignTableId =
      oldOptions && typeof oldOptions.foreignTableId === 'string'
        ? oldOptions.foreignTableId
        : undefined;
    const newForeignTableId =
      newOptions && typeof newOptions.foreignTableId === 'string'
        ? newOptions.foreignTableId
        : undefined;
    return Boolean(
      oldForeignTableId && newForeignTableId && oldForeignTableId !== newForeignTableId
    );
  }

  private async forceLookupRelatedError(linkFieldId: string) {
    const dependentLookupFields = await this.prismaService.txClient().field.findMany({
      where: {
        lookupLinkedFieldId: linkFieldId,
        deletedTime: null,
        OR: [{ isLookup: true }, { type: FieldType.Rollup }, { type: FieldType.ConditionalRollup }],
      },
      select: { id: true },
    });

    if (!dependentLookupFields.length) {
      return;
    }

    await this.prismaService.txClient().field.updateMany({
      where: {
        id: { in: dependentLookupFields.map((item) => item.id) },
      },
      data: {
        hasError: true,
      },
    });
  }

  async undo(operation: IConvertFieldOperation) {
    const { params, result } = operation;
    const { tableId } = params;
    const { oldField, newField, modifiedOps, references, supplementChange } = result;
    await this.prismaService.$tx(
      async () => {
        await this.fieldOpenApiService.performConvertField({
          tableId,
          oldField: createFieldInstanceByVo(newField),
          newField: createFieldInstanceByVo(oldField),
          modifiedOps: modifiedOps && this.revertOpsMap(modifiedOps),
          supplementChange: supplementChange && {
            tableId: supplementChange.tableId,
            oldField: createFieldInstanceByVo(supplementChange.newField),
            newField: createFieldInstanceByVo(supplementChange.oldField),
          },
        });

        if (references) {
          await this.fieldOpenApiService.restoreReference(references);
        }
      },
      { timeout: this.thresholdConfig.bigTransactionTimeout }
    );

    return operation;
  }

  async redo(operation: IConvertFieldOperation) {
    const { params, result } = operation;
    const { tableId } = params;
    const { oldField, newField, modifiedOps, references, supplementChange } = result;
    await this.prismaService.$tx(
      async () => {
        await this.fieldOpenApiService.performConvertField({
          tableId,
          oldField: createFieldInstanceByVo(oldField),
          newField: createFieldInstanceByVo(newField),
          modifiedOps,
          supplementChange: supplementChange && {
            tableId: supplementChange.tableId,
            oldField: createFieldInstanceByVo(supplementChange.oldField),
            newField: createFieldInstanceByVo(supplementChange.newField),
          },
        });

        if (references) {
          await this.fieldOpenApiService.restoreReference(references);
        }

        if (this.isLinkForeignTableChanged(oldField, newField)) {
          await this.forceLookupRelatedError(newField.id);
        }
      },
      { timeout: this.thresholdConfig.bigTransactionTimeout }
    );

    return operation;
  }
}
