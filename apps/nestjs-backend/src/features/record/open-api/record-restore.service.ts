import { Injectable } from '@nestjs/common';
import type { IRecord } from '@teable/core';
import { FieldKeyType, FieldType, HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { RestoreRecordsCommand, v2CoreTokens } from '@teable/v2-core';
import type { ICommandBus, RestoreRecordInput, RestoreRecordsResult } from '@teable/v2-core';
import { CustomHttpException } from '../../../custom.exception';
import { CanaryService } from '../../canary/canary.service';
import { V2ContainerService } from '../../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../../v2/v2-execution-context.factory';
import { RecordService } from '../record.service';
import { collectLinkTargetIds, isLinkEntry, parseLinkFieldOptions } from './link-cell-value.util';
import { RecordOpenApiService } from './record-open-api.service';

export type IRestorableRecordSnapshot = IRecord & {
  version?: number;
  order?: Record<string, number>;
};

// exported for tests: drops link entries whose target is not live; returns the SAME
// reference when nothing changes so callers can cheaply detect mutation. An emptied
// multi-value collapses to null, matching how the write pipeline stores "no links".
export const filterLiveLinkEntries = (
  cellValue: unknown,
  isLive: (id: string) => boolean
): unknown => {
  if (Array.isArray(cellValue)) {
    const kept = cellValue.filter((entry) => !isLinkEntry(entry) || isLive(entry.id));
    if (kept.length === cellValue.length) {
      return cellValue;
    }
    return kept.length ? kept : null;
  }
  if (isLinkEntry(cellValue)) {
    return isLive(cellValue.id) ? cellValue : null;
  }
  return cellValue;
};

// Rebuilds records from persisted snapshot rows (table trash, archive) through whichever
// engine the base's canary decision selects, so the routing and the snapshot→command
// mapping live in one place.
@Injectable()
export class RecordRestoreService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly canaryService: CanaryService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly recordService: RecordService,
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ExecutionContextFactory: V2ExecutionContextFactory
  ) {}

  async restoreRecordSnapshots(
    tableId: string,
    records: IRestorableRecordSnapshot[]
  ): Promise<void> {
    records = await this.stripDanglingLinks(tableId, records);

    if (await this.shouldRestoreRecordsWithV2(tableId)) {
      await this.restoreRecordsV2(tableId, records);
      return;
    }

    await this.recordOpenApiService.multipleCreateRecords(
      tableId,
      {
        fieldKeyType: FieldKeyType.Id,
        records,
        typecast: true,
      },
      true
    );
  }

  // A snapshot can reference records deleted after it was taken; replaying such a
  // link fails the v1 write path's consistency check and leaves v2 with orphan
  // junction rows. Restore-succeeds-first: drop dead entries up front. Records
  // restored in this same call count as live, so batch-restoring both sides of a
  // link keeps it intact.
  private async stripDanglingLinks(
    tableId: string,
    records: IRestorableRecordSnapshot[]
  ): Promise<IRestorableRecordSnapshot[]> {
    const linkFieldRaws = await this.prismaService.txClient().field.findMany({
      where: { tableId, type: FieldType.Link, isLookup: null, deletedTime: null },
      select: { id: true, options: true },
    });
    const linkFields = linkFieldRaws.flatMap((raw) => {
      const { foreignTableId } = parseLinkFieldOptions(raw.options);
      return foreignTableId ? [{ id: raw.id, foreignTableId }] : [];
    });
    if (linkFields.length === 0) {
      return records;
    }

    const targetIdsByTable = new Map<string, Set<string>>();
    for (const field of linkFields) {
      for (const record of records) {
        const targetIds = collectLinkTargetIds(record.fields?.[field.id]);
        if (targetIds.length === 0) {
          continue;
        }
        const set = targetIdsByTable.get(field.foreignTableId) ?? new Set<string>();
        targetIds.forEach((id) => set.add(id));
        targetIdsByTable.set(field.foreignTableId, set);
      }
    }
    if (targetIdsByTable.size === 0) {
      return records;
    }

    // a deleted foreign table means every link into it is dead — skip the record
    // probe instead of erroring inside it
    const liveForeignTables = new Set(
      (
        await this.prismaService.txClient().tableMeta.findMany({
          where: { id: { in: [...targetIdsByTable.keys()] }, deletedTime: null },
          select: { id: true },
        })
      ).map((table) => table.id)
    );

    const batchIds = new Set(records.map((record) => record.id));
    const liveIdsByTable = new Map<string, Set<string>>();
    const PROBE_CHUNK_SIZE = 5000;
    for (const [foreignTableId, targetIds] of targetIdsByTable) {
      const live = new Set<string>();
      if (liveForeignTables.has(foreignTableId)) {
        const ids = [...targetIds];
        for (let i = 0; i < ids.length; i += PROBE_CHUNK_SIZE) {
          const rows = await this.recordService.getRecordsHeadWithIds(
            foreignTableId,
            ids.slice(i, i + PROBE_CHUNK_SIZE)
          );
          rows.forEach((row) => live.add(row.id));
        }
      }
      if (foreignTableId === tableId) {
        batchIds.forEach((id) => live.add(id));
      }
      liveIdsByTable.set(foreignTableId, live);
    }

    return records.map((record) => {
      let changed = false;
      const fields = { ...record.fields };
      for (const field of linkFields) {
        const value = fields[field.id];
        if (value == null) {
          continue;
        }
        const live = liveIdsByTable.get(field.foreignTableId);
        if (!live) {
          continue;
        }
        const next = filterLiveLinkEntries(value, (id) => live.has(id));
        if (next !== value) {
          fields[field.id] = next as IRecord['fields'][string];
          changed = true;
        }
      }
      return changed ? { ...record, fields } : record;
    });
  }

  toV2RestoreRecord(record: IRestorableRecordSnapshot): RestoreRecordInput {
    return {
      recordId: record.id,
      fields: record.fields ?? {},
      ...(record.version !== undefined ? { version: record.version } : {}),
      ...(record.order ? { orders: record.order } : {}),
      ...(record.autoNumber !== undefined ? { autoNumber: record.autoNumber } : {}),
      ...(record.createdTime ? { createdTime: record.createdTime } : {}),
      ...(record.createdBy ? { createdBy: record.createdBy } : {}),
      ...(record.lastModifiedTime ? { lastModifiedTime: record.lastModifiedTime } : {}),
      ...(record.lastModifiedBy ? { lastModifiedBy: record.lastModifiedBy } : {}),
    };
  }

  private async shouldRestoreRecordsWithV2(tableId: string): Promise<boolean> {
    const table = await this.prismaService.txClient().tableMeta.findFirst({
      where: { id: tableId, deletedTime: null },
      select: {
        base: {
          select: {
            spaceId: true,
            v2Enabled: true,
          },
        },
      },
    });

    if (!table?.base?.spaceId) {
      return false;
    }

    const decision = await this.canaryService.shouldUseV2ForBaseWithReason(
      table.base,
      'createRecord'
    );
    return decision.useV2;
  }

  private async restoreRecordsV2(
    tableId: string,
    records: IRestorableRecordSnapshot[]
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }

    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ExecutionContextFactory.createContext(container);

    const commandResult = RestoreRecordsCommand.create({
      tableId,
      records: records.map((record) => this.toV2RestoreRecord(record)),
    });

    if (commandResult.isErr()) {
      throw new CustomHttpException(commandResult.error.message, HttpErrorCode.VALIDATION_ERROR);
    }

    const result = await commandBus.execute<RestoreRecordsCommand, RestoreRecordsResult>(
      context,
      commandResult.value
    );

    if (result.isErr()) {
      throw new CustomHttpException(result.error.message, HttpErrorCode.INTERNAL_SERVER_ERROR);
    }
  }
}
