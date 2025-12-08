import { Injectable } from '@nestjs/common';
import type { IMakeOptional, TableDomain } from '@teable/core';
import { CellFormat, FieldKeyType, HttpErrorCode, generateRecordId } from '@teable/core';
import type { ICreateRecordsRo, ICreateRecordsVo } from '@teable/openapi';
import { ThresholdConfig, IThresholdConfig } from '../../../configs/threshold.config';
import { CustomHttpException } from '../../../custom.exception';
import { BatchService } from '../../calculation/batch.service';
import { LinkService } from '../../calculation/link.service';
import { TableDomainQueryService } from '../../table-domain';
import { ComputedOrchestratorService } from '../computed/services/computed-orchestrator.service';
import type { IRecordInnerRo } from '../record.service';
import { RecordService } from '../record.service';
import { RecordModifySharedService } from './record-modify.shared.service';

@Injectable()
export class RecordCreateService {
  constructor(
    private readonly recordService: RecordService,
    private readonly shared: RecordModifySharedService,
    private readonly batchService: BatchService,
    private readonly linkService: LinkService,
    private readonly computedOrchestrator: ComputedOrchestratorService,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    private readonly tableDomainQueryService: TableDomainQueryService
  ) {}

  async multipleCreateRecords(
    tableId: string,
    createRecordsRo: ICreateRecordsRo,
    ignoreMissingFields: boolean = false
  ): Promise<ICreateRecordsVo> {
    const { fieldKeyType = FieldKeyType.Name, records, typecast, order } = createRecordsRo;
    const table = await this.tableDomainQueryService.getTableDomainById(tableId);
    const typecastRecords = await this.shared.validateFieldsAndTypecast<
      IMakeOptional<IRecordInnerRo, 'id'>
    >(table, records, fieldKeyType, typecast, ignoreMissingFields);
    const preparedRecords = await this.shared.appendRecordOrderIndexes(
      table,
      typecastRecords,
      order
    );
    const chunkSize = this.thresholdConfig.calcChunkSize;
    const chunks: IMakeOptional<IRecordInnerRo, 'id'>[][] = [];
    for (let i = 0; i < preparedRecords.length; i += chunkSize) {
      chunks.push(preparedRecords.slice(i, i + chunkSize));
    }
    const acc: ICreateRecordsVo = { records: [] };
    for (const chunk of chunks) {
      const res = await this.createRecords(table, chunk, fieldKeyType);
      acc.records.push(...res.records);
    }
    return acc;
  }

  async createRecords(
    table: TableDomain,
    recordsRo: IMakeOptional<IRecordInnerRo, 'id'>[],
    fieldKeyType: FieldKeyType = FieldKeyType.Name,
    projection?: string[]
  ): Promise<ICreateRecordsVo> {
    if (recordsRo.length === 0) {
      throw new CustomHttpException('Create records is empty', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.record.createRecordsEmpty',
        },
      });
    }
    const records = recordsRo.map((r) => ({ ...r, id: r.id || generateRecordId() }));
    const fields = table.fieldList;
    await this.recordService.batchCreateRecords(table, records, fieldKeyType, fields);
    const recordsWithDefaults = await this.shared.appendDefaultValue(records, fieldKeyType, fields);
    const contextReadyRecords = await this.shared.ensureReferencedBaseFieldsForNewRecords(
      recordsWithDefaults,
      fieldKeyType,
      fields
    );
    const recordIds = contextReadyRecords.map((r) => r.id);
    const projectionByTable = this.buildProjectionByTable(table, fieldKeyType, contextReadyRecords);
    const createCtxs = await this.shared.generateCellContexts(
      table,
      fieldKeyType,
      contextReadyRecords,
      true
    );
    await this.linkService.getDerivateByLink(table.id, createCtxs, undefined, projectionByTable);
    const changes = this.shared.compressAndFilterChanges(table, createCtxs);
    const opsMap = this.shared.formatChangesToOps(changes);
    // Publish computed values (with old/new) around base updates
    await this.computedOrchestrator.computeCellChangesForRecords(
      table.id,
      createCtxs,
      async (tables) => {
        await this.batchService.updateRecords(opsMap, undefined, undefined, tables);
      }
    );
    const snapshots = await this.recordService.getSnapshotBulkWithPermission(
      table.id,
      recordIds,
      this.recordService.convertProjection(projection),
      fieldKeyType,
      CellFormat.Json,
      true
    );
    return { records: snapshots.map((s) => s.data) };
  }

  async createRecordsOnlySql(tableId: string, createRecordsRo: ICreateRecordsRo): Promise<void> {
    const { fieldKeyType = FieldKeyType.Name, records, typecast } = createRecordsRo;
    const table = await this.tableDomainQueryService.getTableDomainById(tableId);
    const typecastRecords = await this.shared.validateFieldsAndTypecast<
      IMakeOptional<IRecordInnerRo, 'id'>
    >(table, records, fieldKeyType, typecast);
    await this.recordService.createRecordsOnlySql(table, typecastRecords);
  }

  private buildProjectionByTable(
    table: TableDomain,
    fieldKeyType: FieldKeyType,
    records: { fields: Record<string, unknown> }[]
  ): Record<string, string[]> | undefined {
    const fieldsMap = table.getFieldsMap(fieldKeyType);
    const projectionIds = records.reduce<Set<string>>((acc, record) => {
      Object.keys(record.fields).forEach((key) => {
        const field = fieldsMap.get(key);
        if (field) {
          acc.add(field.id);
        }
      });
      return acc;
    }, new Set<string>());

    return projectionIds.size ? { [table.id]: Array.from(projectionIds) } : undefined;
  }
}
