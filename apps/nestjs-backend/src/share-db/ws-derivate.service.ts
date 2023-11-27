import { Injectable, Logger } from '@nestjs/common';
import type { IOtOperation } from '@teable-group/core';
import { IdPrefix, RecordOpBuilder } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { isEmpty } from 'lodash';
import type ShareDb from 'sharedb';
import { BatchService } from '../features/calculation/batch.service';
import { LinkService } from '../features/calculation/link.service';
import { ReferenceService } from '../features/calculation/reference.service';
import type { IOpsMap } from '../features/calculation/reference.service';
import { SystemFieldService } from '../features/calculation/system-field.service';
import type { ICellChange } from '../features/calculation/utils/changes';
import { formatChangesToOps } from '../features/calculation/utils/changes';
import { composeMaps } from '../features/calculation/utils/compose-maps';
import type { IFieldInstance } from '../features/field/model/factory';

@Injectable()
export class WsDerivateService {
  private logger = new Logger(WsDerivateService.name);

  constructor(
    private readonly linkService: LinkService,
    private readonly referenceService: ReferenceService,
    private readonly batchService: BatchService,
    private readonly prismaService: PrismaService,
    private readonly systemFieldService: SystemFieldService
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
    const fkRecordMap = derivate?.fkRecordMap || {};

    const opsMapOrigin = formatChangesToOps(changes);
    const opsMapByLink = formatChangesToOps(cellChanges);
    const composedOpsMap = composeMaps([opsMapOrigin, opsMapByLink]);
    const systemFieldOpsMap = await this.systemFieldService.getOpsMapBySystemField(composedOpsMap);

    const {
      opsMap: opsMapByCalculate,
      fieldMap,
      tableId2DbTableName,
    } = await this.referenceService.calculateOpsMap(
      composeMaps([composedOpsMap, systemFieldOpsMap]),
      fkRecordMap
    );
    const composedMap = composeMaps([opsMapByLink, opsMapByCalculate, systemFieldOpsMap]);

    if (isEmpty(composedMap)) {
      return;
    }

    return {
      opsMap: composedMap,
      fieldMap,
      tableId2DbTableName,
    };
  }

  async save(saveContext: {
    opsMap: IOpsMap;
    fieldMap: Record<string, IFieldInstance>;
    tableId2DbTableName: Record<string, string>;
  }) {
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
          ...ctx,
        });
      }
      return pre;
    }, []);
  }

  async onRecordApply(context: ShareDb.middleware.SubmitContext, next: (err?: unknown) => void) {
    const [docType, tableId] = context.collection.split('_') as [IdPrefix, string];
    const recordId = context.id;
    if (docType !== IdPrefix.Record || !context.op.op) {
      return next();
    }

    this.logger.log('onRecordApply: ' + JSON.stringify(context.op.op, null, 2));
    const changes = this.op2Changes(tableId, recordId, context.op.op);
    if (!changes.length) {
      return next();
    }

    try {
      const saveContext = await this.prismaService.$tx(async () => {
        return await this.calculate(changes);
      });
      if (saveContext) {
        context.agent.custom.saveContext = saveContext;
      }
    } catch (e) {
      return next(e);
    }

    next();
  }
}
