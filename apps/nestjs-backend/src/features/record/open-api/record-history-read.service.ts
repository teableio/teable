import { Injectable, Logger } from '@nestjs/common';
import type { IAttachmentCellValue } from '@teable/core';
import { CellValueType, FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  IGetRecordHistoryQuery,
  IRecordHistoryItemVo,
  IRecordHistoryVo,
} from '@teable/openapi';
import { keyBy } from 'lodash';
import { AttachmentCellValueService } from '../../attachments/attachment-cell-value.service';
import { getPublicFullStorageUrl } from '../../attachments/plugins/utils';
import { RecordHistoryColdReadService } from '../../record-history-cold/record-history-cold-read.service';
import { RecordStoragePresenceService } from '../../record-storage/record-storage-presence.service';
import { collectLinkTargetIds, parseLinkFieldOptions } from './link-cell-value.util';

const getAllowedRecordHistoryFieldIds = (
  fieldIds?: string[],
  projectionIds?: string[]
): string[] | undefined => {
  if (!fieldIds?.length) {
    return projectionIds;
  }

  if (!projectionIds?.length) {
    return fieldIds;
  }

  return fieldIds.filter((fieldId) => projectionIds.includes(fieldId));
};

type ILinkStateRef = {
  state: IRecordHistoryItemVo['before'];
  fieldId: string;
  ids: string[];
  foreignTableId?: string;
};

const collectLinkStates = (historyList: IRecordHistoryItemVo[]): ILinkStateRef[] => {
  const linkStates: ILinkStateRef[] = [];
  for (const item of historyList) {
    for (const state of [item.before, item.after]) {
      if (state.meta.type !== FieldType.Link || ('coldTruncated' in state && state.coldTruncated)) {
        continue;
      }
      const ids = collectLinkTargetIds(state.data);
      if (!ids.length) continue;
      const options = state.meta.options;
      const foreignTableId =
        options &&
        typeof options === 'object' &&
        'foreignTableId' in options &&
        typeof options.foreignTableId === 'string'
          ? options.foreignTableId
          : undefined;
      linkStates.push({ state, fieldId: item.fieldId, ids, foreignTableId });
    }
  }
  return linkStates;
};

@Injectable()
export class RecordHistoryReadService {
  private readonly logger = new Logger(RecordHistoryReadService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly attachmentCellValueService: AttachmentCellValueService,
    private readonly recordHistoryColdReadService: RecordHistoryColdReadService,
    private readonly recordStoragePresenceService: RecordStoragePresenceService
  ) {}

  async getRecordHistory(
    tableId: string,
    recordId: string | undefined,
    query: IGetRecordHistoryQuery,
    projectionIds?: string[]
  ): Promise<IRecordHistoryVo> {
    const { cursor, startDate, endDate, fieldIds, createdByIds } = query;
    const limit = 20;
    const allowedFieldIds = getAllowedRecordHistoryFieldIds(fieldIds, projectionIds);
    const shouldFilterByField = Boolean(fieldIds?.length || projectionIds?.length);

    const { list, nextCursor } = await this.collectRecordHistoryRows({
      tableId,
      recordId,
      startDate,
      endDate,
      allowedFieldIds,
      shouldFilterByField,
      createdByIds,
      cursor,
      limit,
    });

    const createdBySet: Set<string> = new Set();
    const historyList: IRecordHistoryItemVo[] = [];
    const syntheticMetaCache = new Map<string, IRecordHistoryItemVo['before']['meta']>();

    for (const item of list) {
      const { id, recordId, fieldId, before, after, createdTime, createdBy } = item;

      createdBySet.add(createdBy);
      const beforeObj = JSON.parse(before as string);
      const afterObj = JSON.parse(after as string);
      // rows written by the raw-SQL import path carry {data} without meta,
      // but the response schema (and the client renderer) require it —
      // synthesize it from the field as it exists today
      if (!beforeObj.meta || !afterObj.meta) {
        const synthetic = await this.syntheticHistoryFieldMeta(fieldId, syntheticMetaCache);
        beforeObj.meta = beforeObj.meta ?? synthetic;
        afterObj.meta = afterObj.meta ?? synthetic;
      }
      const { meta: beforeMeta, data: beforeData } = beforeObj as IRecordHistoryItemVo['before'];
      const { meta: afterMeta, data: afterData } = afterObj as IRecordHistoryItemVo['after'];
      const beforeType = beforeMeta?.type;
      const afterType = afterMeta?.type;
      // a value the cold flush replaced with a "too large, truncated" marker
      // carries a plain string `data` regardless of the field's real type;
      // never run type-specific processing (e.g. attachment presigning) on it —
      // that would normalize the string as an attachment and fail the response
      const beforeTruncated = beforeObj.coldTruncated === true;
      const afterTruncated = afterObj.coldTruncated === true;

      if (beforeType === FieldType.Attachment && !beforeTruncated) {
        beforeObj.data = await this.attachmentCellValueService.getAttachmentPresignedCellValue(
          beforeData as IAttachmentCellValue
        );
      }

      if (afterType === FieldType.Attachment && !afterTruncated) {
        afterObj.data = await this.attachmentCellValueService.getAttachmentPresignedCellValue(
          afterData as IAttachmentCellValue
        );
      }

      historyList.push({
        id,
        tableId,
        recordId,
        fieldId,
        before: beforeObj,
        after: afterObj,
        createdTime: createdTime.toISOString(),
        createdBy,
      });
    }

    const [, userList] = await Promise.all([
      this.annotateDeletedLinkRecords(historyList),
      this.prismaService.user.findMany({
        where: {
          id: {
            in: Array.from(createdBySet),
          },
        },
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
        },
      }),
    ]);

    const handledUserList = userList.map((user) => {
      const { avatar } = user;
      return {
        ...user,
        avatar: avatar && getPublicFullStorageUrl(avatar),
      };
    });

    return {
      historyList,
      userMap: keyBy(handledUserList, 'id'),
      nextCursor,
    };
  }

  // history keeps link titles as written; mark ids whose record is gone at read
  // time so the client labels them deleted
  private async annotateDeletedLinkRecords(historyList: IRecordHistoryItemVo[]): Promise<void> {
    const linkStates = collectLinkStates(historyList);
    if (!linkStates.length) return;

    await this.resolveForeignTableIds(linkStates);

    const idsByTable = new Map<string, Set<string>>();
    for (const { foreignTableId, ids } of linkStates) {
      if (!foreignTableId) continue;
      const tableIds = idsByTable.get(foreignTableId) ?? new Set<string>();
      ids.forEach((recordId) => tableIds.add(recordId));
      idsByTable.set(foreignTableId, tableIds);
    }
    if (!idsByTable.size) return;

    const existingIds = await this.getExistingRecordIds(idsByTable);

    for (const { state, foreignTableId, ids } of linkStates) {
      if (!foreignTableId) continue;
      const deletedRecordIds = ids.filter((id) => !existingIds.has(id));
      if (deletedRecordIds.length) {
        state.deletedRecordIds = deletedRecordIds;
      }
    }
  }

  // legacy v2-written rows carry options: null — resolve their foreign table from
  // the field as it exists now (assumes the link target table is unchanged)
  private async resolveForeignTableIds(linkStates: ILinkStateRef[]): Promise<void> {
    const missingFieldIds = [
      ...new Set(linkStates.filter((s) => !s.foreignTableId).map((s) => s.fieldId)),
    ];
    if (!missingFieldIds.length) return;

    const fields = await this.prismaService.field.findMany({
      where: { id: { in: missingFieldIds } },
      select: { id: true, options: true },
    });
    const foreignTableIdByFieldId = new Map(
      fields.map(
        (field) => [field.id, parseLinkFieldOptions(field.options).foreignTableId] as const
      )
    );
    for (const linkState of linkStates) {
      linkState.foreignTableId ??= foreignTableIdByFieldId.get(linkState.fieldId);
    }
  }

  private async getExistingRecordIds(idsByTable: Map<string, Set<string>>): Promise<Set<string>> {
    // a deleted foreign table means every link into it is dead — skip its probe
    const liveForeignTables = await this.prismaService.tableMeta.findMany({
      where: { id: { in: [...idsByTable.keys()] }, deletedTime: null },
      select: { id: true },
    });
    const existingIds = new Set<string>();
    await Promise.all(
      liveForeignTables.map(async ({ id: foreignTableId }) => {
        const ids = [...(idsByTable.get(foreignTableId) ?? [])];
        try {
          const liveIds = await this.recordStoragePresenceService.getExistingRecordIds(
            foreignTableId,
            ids
          );
          liveIds.forEach((id) => existingIds.add(id));
        } catch (error) {
          // a failed probe must not mislabel links as deleted (or fail the whole
          // request) — treat this table's ids as alive and keep the stale titles
          ids.forEach((id) => existingIds.add(id));
          this.logger.warn(
            `record history deleted-link probe failed for table ${foreignTableId}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      })
    );
    return existingIds;
  }

  /**
   * field meta for history rows that were written without one (raw-SQL
   * import): use the field as it exists now (even soft-deleted), and fall
   * back to a plain-text placeholder when the field row is gone entirely —
   * a degraded label beats hiding the entry or crashing the renderer
   */
  private async syntheticHistoryFieldMeta(
    fieldId: string,
    cache: Map<string, IRecordHistoryItemVo['before']['meta']>
  ): Promise<IRecordHistoryItemVo['before']['meta']> {
    const cached = cache.get(fieldId);
    if (cached) return cached;
    const field = await this.prismaService.field.findFirst({
      where: { id: fieldId },
      select: { name: true, type: true, cellValueType: true, isLookup: true, options: true },
    });
    const meta: IRecordHistoryItemVo['before']['meta'] = field
      ? {
          name: field.name,
          type: field.type as IRecordHistoryItemVo['before']['meta']['type'],
          cellValueType: field.cellValueType as CellValueType,
          ...(field.isLookup ? { isLookup: field.isLookup } : {}),
          options: field.options ? JSON.parse(field.options) : undefined,
        }
      : {
          name: fieldId,
          type: FieldType.SingleLineText,
          cellValueType: CellValueType.String,
          options: undefined,
        };
    cache.set(fieldId, meta);
    return meta;
  }

  private async collectRecordHistoryRows(input: {
    tableId: string;
    recordId: string | undefined;
    startDate?: string;
    endDate?: string;
    allowedFieldIds?: string[];
    shouldFilterByField: boolean;
    createdByIds?: string[];
    cursor?: string | null;
    limit: number;
  }): Promise<{
    list: {
      id: string;
      recordId: string;
      fieldId: string;
      before: string;
      after: string;
      createdTime: Date;
      createdBy: string;
    }[];
    nextCursor: string | undefined;
  }> {
    const {
      tableId,
      recordId,
      startDate,
      endDate,
      allowedFieldIds,
      shouldFilterByField,
      createdByIds,
      cursor,
      limit,
    } = input;

    // ALWAYS the merged read (PG write buffer + S3 cold parts): reading is
    // not part of the migration process, it is how migrated data stays
    // visible. The kill switch stops flushing/compaction/deletion only —
    // a switched-off process (e.g. a staging environment sharing the
    // production database) must still serve history that another
    // environment's flusher has already moved to cold storage. On a
    // never-migrated instance this costs at most an empty prefix LIST on
    // pages the buffer cannot fill.
    const merged = await this.recordHistoryColdReadService.collectHistoryRows({
      tableId,
      recordId,
      startDate,
      endDate,
      allowedFieldIds,
      shouldFilterByField,
      createdByIds,
      cursor,
      limit,
    });
    return { list: merged.rows, nextCursor: merged.nextCursor };
  }
}
