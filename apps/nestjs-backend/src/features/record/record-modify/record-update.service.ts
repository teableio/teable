import { Injectable } from '@nestjs/common';
import { FieldKeyType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IUpdateRecordsRo, IRecordInsertOrderRo } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { EventEmitterService } from '../../../event-emitter/event-emitter.service';
import { Events } from '../../../event-emitter/events';
import type { IClsStore } from '../../../types/cls';
import { retryOnDeadlock } from '../../../utils/retry-decorator';
import { BatchService } from '../../calculation/batch.service';
import { LinkService } from '../../calculation/link.service';
import { SystemFieldService } from '../../calculation/system-field.service';
import { composeOpMaps, type IOpsMap } from '../../calculation/utils/compose-maps';
import { ViewOpenApiService } from '../../view/open-api/view-open-api.service';
import { ComputedOrchestratorService } from '../computed/services/computed-orchestrator.service';
import { RecordService } from '../record.service';
import { RecordModifySharedService } from './record-modify.shared.service';

@Injectable()
export class RecordUpdateService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService,
    private readonly systemFieldService: SystemFieldService,
    private readonly viewOpenApiService: ViewOpenApiService,
    private readonly batchService: BatchService,
    private readonly linkService: LinkService,
    private readonly computedOrchestrator: ComputedOrchestratorService,
    private readonly shared: RecordModifySharedService,
    private readonly eventEmitterService: EventEmitterService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  @retryOnDeadlock()
  async updateRecords(
    tableId: string,
    updateRecordsRo: IUpdateRecordsRo & {
      records: {
        id: string;
        fields: Record<string, unknown>;
        order?: Record<string, number>;
      }[];
    },
    windowId?: string
  ) {
    const { records, order, fieldKeyType = FieldKeyType.Name, typecast } = updateRecordsRo;
    const orderIndexesBefore =
      order != null && windowId
        ? await this.recordService.getRecordIndexes(
            tableId,
            records.map((r) => r.id),
            (order as IRecordInsertOrderRo).viewId
          )
        : undefined;

    const cellContexts = await this.prismaService.$tx(async () => {
      if (order != null) {
        const { viewId, anchorId, position } = order as IRecordInsertOrderRo;
        await this.viewOpenApiService.updateRecordOrders(tableId, viewId, {
          anchorId,
          position,
          recordIds: records.map((r) => r.id),
        });
      }

      const typecastRecords = await this.shared.validateFieldsAndTypecast(
        tableId,
        records,
        fieldKeyType,
        typecast
      );

      const preparedRecords = await this.systemFieldService.getModifiedSystemOpsMap(
        tableId,
        fieldKeyType,
        typecastRecords
      );

      const ctxs = await this.shared.generateCellContexts(tableId, fieldKeyType, preparedRecords);
      const linkDerivate = await this.linkService.planDerivateByLink(tableId, ctxs);
      const changes = await this.shared.compressAndFilterChanges(tableId, ctxs);
      const opsMap: IOpsMap = this.shared.formatChangesToOps(changes);
      const linkOpsMap: IOpsMap | undefined = linkDerivate?.cellChanges?.length
        ? this.shared.formatChangesToOps(linkDerivate.cellChanges)
        : undefined;
      // Compose base ops with link-derived ops so symmetric link updates are also published
      const composedOpsMap: IOpsMap = composeOpMaps([opsMap, linkOpsMap]);
      // Publish computed/link/lookup changes with old/new by wrapping the base update
      await this.computedOrchestrator.computeCellChangesForRecords(tableId, ctxs, async () => {
        await this.linkService.commitForeignKeyChanges(tableId, linkDerivate?.fkRecordMap);
        await this.batchService.updateRecords(composedOpsMap);
      });
      return ctxs;
    });

    const recordIds = records.map((r) => r.id);
    if (windowId) {
      const orderIndexesAfter =
        order && (await this.recordService.getRecordIndexes(tableId, recordIds, order.viewId));

      this.eventEmitterService.emitAsync(Events.OPERATION_RECORDS_UPDATE, {
        tableId,
        windowId,
        userId: this.cls.get('user.id'),
        recordIds,
        fieldIds: Object.keys(records[0]?.fields || {}),
        cellContexts,
        orderIndexesBefore,
        orderIndexesAfter,
      });
    }

    const snapshots = await this.recordService.getSnapshotBulkWithPermission(
      tableId,
      recordIds,
      undefined,
      fieldKeyType,
      undefined,
      true
    );
    return {
      records: snapshots.map((snapshot) => snapshot.data),
      cellContexts,
    };
  }

  async simpleUpdateRecords(
    tableId: string,
    updateRecordsRo: IUpdateRecordsRo & {
      records: {
        id: string;
        fields: Record<string, unknown>;
        order?: Record<string, number>;
      }[];
    }
  ) {
    const { fieldKeyType = FieldKeyType.Name, records } = updateRecordsRo;
    const preparedRecords = await this.systemFieldService.getModifiedSystemOpsMap(
      tableId,
      fieldKeyType,
      records
    );

    const cellContexts = await this.shared.generateCellContexts(
      tableId,
      fieldKeyType,
      preparedRecords
    );
    const linkDerivate = await this.linkService.planDerivateByLink(tableId, cellContexts);
    const changes = await this.shared.compressAndFilterChanges(tableId, cellContexts);
    const opsMap: IOpsMap = this.shared.formatChangesToOps(changes);
    const linkOpsMap: IOpsMap | undefined = linkDerivate?.cellChanges?.length
      ? this.shared.formatChangesToOps(linkDerivate.cellChanges)
      : undefined;
    const composedOpsMap: IOpsMap = composeOpMaps([opsMap, linkOpsMap]);
    await this.computedOrchestrator.computeCellChangesForRecords(
      tableId,
      cellContexts,
      async () => {
        await this.linkService.commitForeignKeyChanges(tableId, linkDerivate?.fkRecordMap);
        await this.batchService.updateRecords(composedOpsMap);
      }
    );
    return cellContexts;
  }
}
