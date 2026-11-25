import { Injectable } from '@nestjs/common';
import type { IRecord } from '@teable/core';
import { FieldType, HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { mapDomainErrorToHttpStatus } from '@teable/v2-contract-http';
import { RestoreRecordsCommand, v2CoreTokens } from '@teable/v2-core';
import type { ICommandBus, RestoreRecordInput, RestoreRecordsResult } from '@teable/v2-core';
import { CustomHttpException } from '../../../custom.exception';
import { RecordStoragePresenceService } from '../../record-storage/record-storage-presence.service';
import { V2ContainerService } from '../../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../../v2/v2-execution-context.factory';
import { throwV2Error } from '../../v2/v2-http-error';
import { collectLinkTargetIds, isLinkEntry, parseLinkFieldOptions } from './link-cell-value.util';

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

export const toV2RestoreRecord = (record: IRestorableRecordSnapshot): RestoreRecordInput => ({
  recordId: record.id,
  fields: record.fields ?? {},
  ...(record.version !== undefined ? { version: record.version } : {}),
  ...(record.order ? { orders: record.order } : {}),
  ...(record.autoNumber !== undefined ? { autoNumber: record.autoNumber } : {}),
  ...(record.createdTime ? { createdTime: record.createdTime } : {}),
  ...(record.createdBy ? { createdBy: record.createdBy } : {}),
  ...(record.lastModifiedTime ? { lastModifiedTime: record.lastModifiedTime } : {}),
  ...(record.lastModifiedBy ? { lastModifiedBy: record.lastModifiedBy } : {}),
});

@Injectable()
export class RecordRestoreNativeService {
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ExecutionContextFactory: V2ExecutionContextFactory,
    private readonly prismaService: PrismaService,
    private readonly recordStoragePresenceService: RecordStoragePresenceService
  ) {}

  async restoreRecordSnapshots(
    tableId: string,
    records: IRestorableRecordSnapshot[],
    options?: { cleanupAttachmentRefs?: boolean }
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }

    records = await this.stripDanglingLinks(tableId, records);

    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ExecutionContextFactory.createContext(container);
    const commandResult = RestoreRecordsCommand.create(
      { tableId, records: records.map(toV2RestoreRecord) },
      {
        cleanupAttachmentRefs: options?.cleanupAttachmentRefs,
        trustedCreatedActorsByRecordId: new Map(
          records.map((record) => [
            record.id,
            record.createdByActorType && record.createdByActorId
              ? { type: record.createdByActorType, id: record.createdByActorId }
              : null,
          ])
        ),
      }
    );

    if (commandResult.isErr()) {
      throw new CustomHttpException(commandResult.error.message, HttpErrorCode.VALIDATION_ERROR);
    }

    const result = await commandBus.execute<RestoreRecordsCommand, RestoreRecordsResult>(
      context,
      commandResult.value
    );
    if (result.isErr()) {
      // Preserve plugin denial status, including forbidden foreign-table access.
      throwV2Error(result.error, mapDomainErrorToHttpStatus(result.error));
    }
  }

  // A snapshot can reference records deleted after it was taken; replaying such a
  // link fails the v1 write path's consistency check and leaves v2 with orphan
  // junction rows. Restore-succeeds-first: drop dead entries up front. Records
  // restored in this same call count as live, so batch-restoring both sides of a
  // link keeps it intact.
  async stripDanglingLinks(
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
    const liveIdsByTable = await this.probeLiveLinkTargetIds(
      tableId,
      batchIds,
      liveForeignTables,
      targetIdsByTable
    );

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

  private async probeLiveLinkTargetIds(
    tableId: string,
    batchIds: ReadonlySet<string>,
    liveForeignTables: ReadonlySet<string>,
    targetIdsByTable: ReadonlyMap<string, Set<string>>
  ): Promise<Map<string, Set<string>>> {
    const liveIdsByTable = new Map<string, Set<string>>();
    for (const [foreignTableId, targetIds] of targetIdsByTable) {
      const live = new Set<string>();
      if (liveForeignTables.has(foreignTableId)) {
        const existingIds = await this.recordStoragePresenceService.getExistingRecordIds(
          foreignTableId,
          [...targetIds]
        );
        existingIds.forEach((id) => live.add(id));
      }
      if (foreignTableId === tableId) {
        batchIds.forEach((id) => live.add(id));
      }
      liveIdsByTable.set(foreignTableId, live);
    }
    return liveIdsByTable;
  }
}
