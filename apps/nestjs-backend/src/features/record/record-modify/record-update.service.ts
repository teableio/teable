import { Injectable } from '@nestjs/common';
import { FieldKeyType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IRecordInsertOrderRo } from '@teable/openapi';
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
import { IUpdateRecordsInternalRo } from '../type';
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
    updateRecordsRo: IUpdateRecordsInternalRo,
    windowId?: string
  ) {
    const {
      records,
      order,
      fieldKeyType = FieldKeyType.Name,
      typecast,
      fieldIds,
    } = updateRecordsRo;

    const scopedRecords = this.filterRecordsByFieldKeys(records, fieldIds);
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
        scopedRecords,
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
        fieldIds: fieldIds?.length ? fieldIds : Object.keys(scopedRecords[0]?.fields || {}),
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

  async simpleUpdateRecords(tableId: string, updateRecordsRo: IUpdateRecordsInternalRo) {
    const { fieldKeyType = FieldKeyType.Name, records, fieldIds } = updateRecordsRo;
    const scopedRecords = this.filterRecordsByFieldKeys(records, fieldIds);
    const preparedRecords = await this.systemFieldService.getModifiedSystemOpsMap(
      tableId,
      fieldKeyType,
      scopedRecords
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

  private filterRecordsByFieldKeys<
    T extends { fields: Record<string, unknown> } & Record<string, unknown>,
  >(records: T[], fieldKeys?: string[]): T[] {
    if (!fieldKeys?.length) {
      return records;
    }
    const keySet = new Set(fieldKeys);
    return records.map((record) => {
      const filteredFields: Record<string, unknown> = {};
      let same = true;
      for (const [key, value] of Object.entries(record.fields)) {
        if (keySet.has(key)) {
          filteredFields[key] = value;
        } else {
          same = false;
        }
      }
      if (same) {
        return record;
      }
      return {
        ...record,
        fields: filteredFields,
      } as T;
    });
  }
}
