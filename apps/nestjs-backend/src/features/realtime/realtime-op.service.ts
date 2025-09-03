import { Injectable, Logger } from '@nestjs/common';
import { IdPrefix, RecordOpBuilder } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { chunk } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { RawOpType } from '../../share-db/interface';
import { BatchService } from '../calculation/batch.service';
import { RecordService } from '../record/record.service';
import { TableDomainQueryService } from '../table-domain/table-domain-query.service';

@Injectable()
export class RealtimeOpService {
  private readonly logger = new Logger(RealtimeOpService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService,
    private readonly batchService: BatchService,
    private readonly tableDomainQueryService: TableDomainQueryService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  private async getRecordVersionMap(dbTableName: string, recordIds: string[]) {
    if (!recordIds.length) return {} as Record<string, number>;
    const rows = await this.prismaService
      .txClient()
      .$queryRawUnsafe<
        { __id: string; __version: number }[]
      >(this.knex(dbTableName).select({ __id: '__id', __version: '__version' }).whereIn('__id', recordIds).toQuery());
    return Object.fromEntries(rows.map((r) => [r.__id, r.__version])) as Record<string, number>;
  }

  /**
   * Publish computed values for a newly created formula field.
   * - Reads latest values via select (no JS topo compute)
   * - Builds record edit ops to set the field for each record
   * - Saves raw ops into CLS so ShareDB publisher broadcasts after tx commit
   */
  async publishOnFieldCreate(tableId: string, fieldIds: string[]): Promise<void> {
    if (!fieldIds.length) return;

    // Build table domain; avoid direct field reads
    const tableDomain = await this.tableDomainQueryService.getTableDomainById(tableId);
    const dbTableName = tableDomain.dbTableName;

    // Get all record ids to publish
    const { ids: allIds } = await this.recordService.getDocIdsByQuery(tableId, { take: -1 });
    if (!allIds.length) return;

    // Use a transaction so raw ops are published after commit by ShareDbService binding
    await this.prismaService.$tx(async () => {
      for (const idChunk of chunk(allIds, 500)) {
        const projection = fieldIds.reduce<Record<string, boolean>>((acc, id) => {
          acc[id] = true;
          return acc;
        }, {});

        const snapshots = await this.recordService.getSnapshotBulk(tableId, idChunk, projection);
        if (!snapshots.length) continue;

        const versionMap = await this.getRecordVersionMap(dbTableName, idChunk);

        const opDataList = snapshots
          .map((s) => {
            const ops = fieldIds.map((fid) =>
              RecordOpBuilder.editor.setRecord.build({
                fieldId: fid,
                newCellValue: s.data.fields[fid],
                oldCellValue: undefined,
              })
            );
            const version = versionMap[s.id];
            if (version == null) return null;
            return { docId: s.id, version, data: ops };
          })
          .filter(Boolean) as { docId: string; version: number; data: unknown }[];

        if (!opDataList.length) continue;

        await this.batchService.saveRawOps(tableId, RawOpType.Edit, IdPrefix.Record, opDataList);
      }
    });
  }
}
