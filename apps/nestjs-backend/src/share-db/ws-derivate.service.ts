import { Injectable, Logger } from '@nestjs/common';
import type { IOtOperation } from '@teable/core';
import { IdPrefix, RecordOpBuilder } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { isEmpty, pick } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type ShareDb from 'sharedb';
import { BatchService } from '../features/calculation/batch.service';
import { LinkService } from '../features/calculation/link.service';
import type { IOpsMap } from '../features/calculation/reference.service';
import { ReferenceService } from '../features/calculation/reference.service';
import { SystemFieldService } from '../features/calculation/system-field.service';
import type { ICellChange } from '../features/calculation/utils/changes';
import { formatChangesToOps } from '../features/calculation/utils/changes';
import { composeOpMaps } from '../features/calculation/utils/compose-maps';
import type { IFieldInstance } from '../features/field/model/factory';
import type { IClsStore } from '../types/cls';
import type { IRawOp, IRawOpMap } from './interface';

export interface ISaveContext {
  opsMap: IOpsMap;
  fieldMap: Record<string, IFieldInstance>;
  tableId2DbTableName: Record<string, string>;
}

export type ICustomSubmitContext = ShareDb.middleware.SubmitContext & {
  extra: { source?: unknown; saveContext?: ISaveContext; stashOpMap?: IRawOpMap };
};
export type ICustomApplyContext = ShareDb.middleware.ApplyContext & {
  extra: { source?: unknown; saveContext?: ISaveContext; stashOpMap?: IRawOpMap };
};

@Injectable()
export class WsDerivateService {
  private logger = new Logger(WsDerivateService.name);

  constructor(
    private readonly linkService: LinkService,
    private readonly referenceService: ReferenceService,
    private readonly batchService: BatchService,
    private readonly prismaService: PrismaService,
    private readonly systemFieldService: SystemFieldService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  async calculate(changes: ICellChange[]) {
    if (new Set(changes.map((c) => c.tableId)).size > 1) {
      throw new Error('Invalid changes, contains multiple tableId in 1 transaction');
    }

    if (!changes.length) {
      return;
    }

    const derivate = await this.linkService.getDerivateByLink(changes[0].tableId, changes);
    const cellChanges = derivate?.cellChanges || [];

    const opsMapOrigin = formatChangesToOps(changes);
    const opsMapByLink = formatChangesToOps(cellChanges);
    const composedOpsMap = composeOpMaps([opsMapOrigin, opsMapByLink]);
    const systemFieldOpsMap = await this.systemFieldService.getOpsMapBySystemField(composedOpsMap);

    const {
      opsMap: opsMapByCalculate,
      fieldMap,
      tableId2DbTableName,
    } = await this.referenceService.calculateOpsMap(composedOpsMap, derivate?.saveForeignKeyToDb);
    const composedMap = composeOpMaps([opsMapByLink, opsMapByCalculate, systemFieldOpsMap]);

    // console.log('socket:final:opsMap', JSON.stringify(composedMap, null, 2));

    if (isEmpty(composedMap)) {
      return;
    }

    return {
      opsMap: composedMap,
      fieldMap,
      tableId2DbTableName,
    };
  }

  async save(saveContext: ISaveContext) {
    const { opsMap, fieldMap, tableId2DbTableName } = saveContext;
    await this.prismaService.$tx(async () => {
      return await this.batchService.updateRecords(opsMap, fieldMap, tableId2DbTableName);
    });
  }

  private op2Changes(tableId: string, recordId: string, ops: IOtOperation[]) {
    return ops.reduce<ICellChange[]>((pre, cur) => {
      const ctx = RecordOpBuilder.editor.setRecord.detect(cur);
      if (ctx) {
        pre.push({
          tableId: tableId,
          recordId: recordId,
          fieldId: ctx.fieldId,
          oldValue: ctx.oldCellValue,
          newValue: ctx.newCellValue,
        });
      }
      return pre;
    }, []);
  }

  async onRecordApply(context: ICustomApplyContext, next: (err?: unknown) => void) {
    const [docType, tableId] = context.collection.split('_') as [IdPrefix, string];
    const recordId = context.id;
    if (docType !== IdPrefix.Record || !context.op.op) {
      // TODO: Capture some missed situations, which may be deleted later.
      this.stashOpMap(context, true);
      return next();
    }

    this.logger.log('onRecordApply: ' + JSON.stringify(context.op.op, null, 2));
    const changes = this.op2Changes(tableId, recordId, context.op.op);
    if (!changes.length) {
      // TODO: Capture some missed situations, which may be deleted later.
      this.stashOpMap(context, true);
      return next();
    }

    try {
      const saveContext = await this.prismaService.$tx(async () => {
        return await this.calculate(changes);
      });
      if (saveContext) {
        context.extra.saveContext = saveContext;
        context.extra.stashOpMap = this.stashOpMap(context);
      } else {
        this.stashOpMap(context, true);
      }
    } catch (e) {
      return next(e);
    }

    next();
  }

  private stashOpMap(context: ShareDb.middleware.SubmitContext, preSave: boolean = false) {
    const { collection, id, op } = context;
    const stashOpMap: IRawOpMap = { [collection]: {} };

    stashOpMap[collection][id] = pick(op, [
      'src',
      'seq',
      'm',
      'create',
      'op',
      'del',
      'v',
      'c',
      'd',
    ]) as IRawOp;

    if (preSave) {
      this.cls.set('tx.stashOpMap', stashOpMap);
    }
    return stashOpMap;
  }
}
