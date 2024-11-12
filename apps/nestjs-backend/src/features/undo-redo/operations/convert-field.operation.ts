import type { IFieldVo, IOtOperation } from '@teable/core';
import type { IConvertFieldOperation } from '../../../cache/types';
import { OperationName } from '../../../cache/types';
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
  constructor(private readonly fieldOpenApiService: FieldOpenApiService) {}

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
        (acc, [opsKey, op]) => {
          acc[opsKey] = op.map(
            (op) =>
              ({
                ...op,
                oi: op.od,
                od: op.oi,
              }) as IOtOperation
          );
          return acc;
        },
        {}
      );
      return acc;
    }, {});
  }

  async undo(operation: IConvertFieldOperation) {
    const { params, result } = operation;
    const { tableId } = params;
    const { oldField, newField, modifiedOps, references, supplementChange } = result;

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

    return operation;
  }

  async redo(operation: IConvertFieldOperation) {
    const { params, result } = operation;
    const { tableId } = params;
    const { oldField, newField, modifiedOps, references, supplementChange } = result;
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

    return operation;
  }
}
