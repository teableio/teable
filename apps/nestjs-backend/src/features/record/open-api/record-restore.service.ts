import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { RestoreRecordInput } from '@teable/v2-core';
import { CanaryService } from '../../canary/canary.service';
import { RecordRestoreNativeService, toV2RestoreRecord } from './record-restore-native.service';
import type { IRestorableRecordSnapshot } from './record-restore-native.service';
import { RecordRestoreV1CompatibilityService } from './record-restore-v1-compatibility.service';

// Table trash keeps the base's canary-selected engine; archive restores use the native
// restore service directly. Both routes share its snapshot preparation and mapping.
@Injectable()
export class RecordRestoreService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly canaryService: CanaryService,
    private readonly recordRestoreNativeService: RecordRestoreNativeService,
    private readonly recordRestoreV1CompatibilityService: RecordRestoreV1CompatibilityService
  ) {}

  async restoreRecordSnapshots(
    tableId: string,
    records: IRestorableRecordSnapshot[],
    options?: { cleanupAttachmentRefs?: boolean }
  ): Promise<void> {
    if (await this.shouldRestoreRecordsWithV2(tableId)) {
      await this.recordRestoreNativeService.restoreRecordSnapshots(tableId, records, options);
      return;
    }

    const prepared = await this.recordRestoreNativeService.stripDanglingLinks(tableId, records);
    await this.recordRestoreV1CompatibilityService.restoreRecordSnapshots(tableId, prepared);
  }

  toV2RestoreRecord(record: IRestorableRecordSnapshot): RestoreRecordInput {
    return toV2RestoreRecord(record);
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
}
