import { Injectable } from '@nestjs/common';
import { generateOperationId } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import { EventEmitterService } from '../../../event-emitter/event-emitter.service';
import { Events } from '../../../event-emitter/events';
import type { IClsStore } from '../../../types/cls';
import { LinkService } from '../../calculation/link.service';
import { ComputedOrchestratorService } from '../computed/services/computed-orchestrator.service';
import { RecordService } from '../record.service';

@Injectable()
export class RecordDeleteService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService,
    private readonly linkService: LinkService,
    private readonly eventEmitterService: EventEmitterService,
    private readonly computedOrchestrator: ComputedOrchestratorService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  async deleteRecord(tableId: string, recordId: string, windowId?: string) {
    const result = await this.deleteRecords(tableId, [recordId], windowId);
    return result.records[0];
  }

  async deleteRecords(tableId: string, recordIds: string[], windowId?: string) {
    const { records, orders } = await this.prismaService.$tx(async () => {
      const records = await this.recordService.getRecordsById(tableId, recordIds, false);
      const cellContextsByTableId = await this.linkService.getDeleteRecordUpdateContext(
        tableId,
        records.records
      );

      // Prepare sources for multi-orchestrator run
      const sources: {
        tableId: string;
        cellContexts: {
          recordId: string;
          fieldId: string;
          newValue?: unknown;
          oldValue?: unknown;
        }[];
      }[] = [];
      for (const effectedTableId in cellContextsByTableId) {
        const cellContexts = cellContextsByTableId[effectedTableId];
        await this.linkService.getDerivateByLink(effectedTableId, cellContexts);
        // Exclude the table being deleted from (we only publish to related tables)
        if (effectedTableId !== tableId) {
          sources.push({ tableId: effectedTableId, cellContexts });
        }
      }

      const orders = windowId
        ? await this.recordService.getRecordIndexes(tableId, recordIds)
        : undefined;

      // Publish computed/link changes with old/new around the actual delete
      await this.computedOrchestrator.computeCellChangesForRecordsMulti(sources, async () => {
        await this.recordService.batchDeleteRecords(tableId, recordIds);
      });

      return { records, orders };
    });

    this.eventEmitterService.emitAsync(Events.OPERATION_RECORDS_DELETE, {
      operationId: generateOperationId(),
      windowId,
      tableId,
      userId: this.cls.get('user.id'),
      records: records.records.map((record, index) => ({
        ...record,
        order: orders?.[index],
      })),
    });

    return records;
  }
}
