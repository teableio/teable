import { Injectable } from '@nestjs/common';
import type { TableDomain } from '@teable/core';
import { FieldKeyType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IRecordInsertOrderRo } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { EventEmitterService } from '../../../event-emitter/event-emitter.service';
import { Events } from '../../../event-emitter/events';
import type { IClsStore } from '../../../types/cls';
import { retryOnDeadlock } from '../../../utils/retry-decorator';
import { Timing } from '../../../utils/timing';
import { BatchService } from '../../calculation/batch.service';
import { LinkService } from '../../calculation/link.service';
import { SystemFieldService } from '../../calculation/system-field.service';
import { composeOpMaps, type IOpsMap } from '../../calculation/utils/compose-maps';
import { TableDomainQueryService } from '../../table-domain';
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
    private readonly tableDomainQueryService: TableDomainQueryService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  @Timing({
    key: 'updateRecords',
    thresholdMs: 2000,
    reportToSentry: true,
    sentryTag: 'record-update',
    sentryContext: (args) => {
      const [tableId, updateRecordsRo, windowId] = args as [
        string,
        Partial<IUpdateRecordsInternalRo>,
        string | undefined,
      ];
      return {
        tableId,
        windowId,
        recordCount: updateRecordsRo?.records?.length,
        fieldIds: updateRecordsRo?.fieldIds,
        typecast: updateRecordsRo?.typecast,
      };
    },
  })
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

    const table = await this.tableDomainQueryService.getTableDomainById(tableId);
    const scopedRecords = this.filterRecordsByFieldKeys(records, fieldIds);
    const orderIndexesBefore =
      order != null && windowId
        ? await this.recordService.getRecordIndexes(
            table,
            records.map((r) => r.id),
            (order as IRecordInsertOrderRo).viewId
          )
        : undefined;

    const cellContexts = await this.prismaService.$tx(async () => {
      if (order != null) {
        const { viewId, anchorId, position } = order as IRecordInsertOrderRo;
        await this.viewOpenApiService.updateRecordOrders(table, viewId, {
          anchorId,
          position,
          recordIds: records.map((r) => r.id),
        });
      }

      const typecastRecords = await this.shared.validateFieldsAndTypecast(
        table,
        scopedRecords,
        fieldKeyType,
        typecast
      );

      const preparedRecords = await this.systemFieldService.getModifiedSystemOpsMap(
        table,
        fieldKeyType,
        typecastRecords
      );

      const projectionFields = this.collectProjectionFields(preparedRecords);
      const projectionByTable = this.toProjectionByTable(table, fieldKeyType, projectionFields);
      const ctxs = await this.shared.generateCellContexts(
        table,
        fieldKeyType,
        preparedRecords,
        false,
        projectionFields
      );
      // Publish computed/link/lookup changes with old/new by wrapping the base update
      await this.computedOrchestrator.computeCellChangesForRecords(
        tableId,
        ctxs,
        async (tables) => {
          const linkDerivate = await this.linkService.planDerivateByLink(
            tableId,
            ctxs,
            undefined,
            tables,
            projectionByTable
          );
          const changes = this.shared.compressAndFilterChanges(table, ctxs);
          const opsMap: IOpsMap = this.shared.formatChangesToOps(changes);
          const linkOpsMap: IOpsMap | undefined = linkDerivate?.cellChanges?.length
            ? this.shared.formatChangesToOps(linkDerivate.cellChanges)
            : undefined;
          // Compose base ops with link-derived ops so symmetric link updates are also published
          const composedOpsMap: IOpsMap = composeOpMaps([opsMap, linkOpsMap]);

          await this.linkService.commitForeignKeyChanges(
            tableId,
            linkDerivate?.fkRecordMap,
            tables
          );
          await this.batchService.updateRecords(composedOpsMap, undefined, undefined, tables);
        }
      );
      return ctxs;
    });

    const recordIds = records.map((r) => r.id);
    if (windowId) {
      const orderIndexesAfter =
        order && (await this.recordService.getRecordIndexes(table, recordIds, order.viewId));

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
    const table = await this.tableDomainQueryService.getTableDomainById(tableId);

    const { fieldKeyType = FieldKeyType.Name, records, fieldIds } = updateRecordsRo;
    const scopedRecords = this.filterRecordsByFieldKeys(records, fieldIds);
    const preparedRecords = await this.systemFieldService.getModifiedSystemOpsMap(
      table,
      fieldKeyType,
      scopedRecords
    );

    const projectionFields = this.collectProjectionFields(preparedRecords);
    const projectionByTable = this.toProjectionByTable(table, fieldKeyType, projectionFields);
    const cellContexts = await this.shared.generateCellContexts(
      table,
      fieldKeyType,
      preparedRecords,
      false,
      projectionFields
    );
    await this.computedOrchestrator.computeCellChangesForRecords(
      tableId,
      cellContexts,
      async (tables) => {
        const linkDerivate = await this.linkService.planDerivateByLink(
          tableId,
          cellContexts,
          undefined,
          tables,
          projectionByTable
        );
        const changes = this.shared.compressAndFilterChanges(table, cellContexts);
        const opsMap: IOpsMap = this.shared.formatChangesToOps(changes);
        const linkOpsMap: IOpsMap | undefined = linkDerivate?.cellChanges?.length
          ? this.shared.formatChangesToOps(linkDerivate.cellChanges)
          : undefined;
        const composedOpsMap: IOpsMap = composeOpMaps([opsMap, linkOpsMap]);

        await this.linkService.commitForeignKeyChanges(tableId, linkDerivate?.fkRecordMap, tables);
        await this.batchService.updateRecords(composedOpsMap, undefined, undefined, tables);
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

  private collectProjectionFields(records: { fields: Record<string, unknown> }[]): string[] {
    const projection = new Set<string>();
    records.forEach((record) => {
      Object.keys(record.fields).forEach((fieldKey) => projection.add(fieldKey));
    });
    return Array.from(projection);
  }

  private toProjectionByTable(
    table: TableDomain,
    fieldKeyType: FieldKeyType,
    projectionFields: string[]
  ): Record<string, string[]> | undefined {
    if (!projectionFields.length) {
      return undefined;
    }
    const fieldsMap = table.getFieldsMap(fieldKeyType);
    const ids = projectionFields.reduce<Set<string>>((acc, key) => {
      const field = fieldsMap.get(key);
      if (field) {
        acc.add(field.id);
      }
      return acc;
    }, new Set<string>());
    return ids.size ? { [table.id]: Array.from(ids) } : undefined;
  }
}
