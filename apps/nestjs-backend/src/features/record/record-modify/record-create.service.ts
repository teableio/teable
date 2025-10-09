import { BadRequestException, Injectable } from '@nestjs/common';
import type { IMakeOptional } from '@teable/core';
import { FieldKeyType, generateRecordId, CellFormat } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ICreateRecordsRo, ICreateRecordsVo } from '@teable/openapi';
import { ThresholdConfig, IThresholdConfig } from '../../../configs/threshold.config';
import { BatchService } from '../../calculation/batch.service';
import { LinkService } from '../../calculation/link.service';
import { ComputedOrchestratorService } from '../computed/services/computed-orchestrator.service';
import type { IRecordInnerRo } from '../record.service';
import { RecordService } from '../record.service';
import { RecordModifySharedService } from './record-modify.shared.service';

@Injectable()
export class RecordCreateService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService,
    private readonly shared: RecordModifySharedService,
    private readonly batchService: BatchService,
    private readonly linkService: LinkService,
    private readonly computedOrchestrator: ComputedOrchestratorService,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
  ) {}

  async multipleCreateRecords(
    tableId: string,
    createRecordsRo: ICreateRecordsRo,
    ignoreMissingFields: boolean = false
  ): Promise<ICreateRecordsVo> {
    const { fieldKeyType = FieldKeyType.Name, records, typecast, order } = createRecordsRo;
    const typecastRecords = await this.shared.validateFieldsAndTypecast<
      IMakeOptional<IRecordInnerRo, 'id'>
    >(tableId, records, fieldKeyType, typecast, ignoreMissingFields);
    const preparedRecords = await this.shared.appendRecordOrderIndexes(
      tableId,
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
      const res = await this.createRecords(tableId, chunk, fieldKeyType);
      acc.records.push(...res.records);
    }
    return acc;
  }

  async createRecords(
    tableId: string,
    recordsRo: IMakeOptional<IRecordInnerRo, 'id'>[],
    fieldKeyType: FieldKeyType = FieldKeyType.Name,
    projection?: string[]
  ): Promise<ICreateRecordsVo> {
    if (recordsRo.length === 0) throw new BadRequestException('Create records is empty');
    const records = recordsRo.map((r) => ({ ...r, id: r.id || generateRecordId() }));
    const fieldRaws = await this.prismaService.txClient().field.findMany({
      where: { tableId, deletedTime: null },
      select: {
        id: true,
        name: true,
        type: true,
        options: true,
        unique: true,
        notNull: true,
        isComputed: true,
        isLookup: true,
        isConditionalLookup: true,
        dbFieldName: true,
      },
    });
    await this.recordService.batchCreateRecords(tableId, records, fieldKeyType, fieldRaws);
    const plainRecords = await this.shared.appendDefaultValue(records, fieldKeyType, fieldRaws);
    const recordIds = plainRecords.map((r) => r.id);
    const createCtxs = await this.shared.generateCellContexts(
      tableId,
      fieldKeyType,
      plainRecords,
      true
    );
    await this.linkService.getDerivateByLink(tableId, createCtxs);
    const changes = await this.shared.compressAndFilterChanges(tableId, createCtxs);
    const opsMap = this.shared.formatChangesToOps(changes);
    // Publish computed values (with old/new) around base updates
    await this.computedOrchestrator.computeCellChangesForRecords(tableId, createCtxs, async () => {
      await this.batchService.updateRecords(opsMap);
    });
    const snapshots = await this.recordService.getSnapshotBulkWithPermission(
      tableId,
      recordIds,
      this.recordService.convertProjection(projection),
      fieldKeyType,
      CellFormat.Json,
      false
    );
    return { records: snapshots.map((s) => s.data) };
  }

  async createRecordsOnlySql(tableId: string, createRecordsRo: ICreateRecordsRo): Promise<void> {
    const { fieldKeyType = FieldKeyType.Name, records, typecast } = createRecordsRo;
    const typecastRecords = await this.shared.validateFieldsAndTypecast<
      IMakeOptional<IRecordInnerRo, 'id'>
    >(tableId, records, fieldKeyType, typecast);
    await this.recordService.createRecordsOnlySql(tableId, typecastRecords);
  }
}
