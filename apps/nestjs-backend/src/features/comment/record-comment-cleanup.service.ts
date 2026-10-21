import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { chunk } from 'lodash';
import { RecordService } from '../record/record.service';

const BATCH_SIZE = 1000;

// Comments live on the meta DB keyed by (tableId, recordId) with no cascade from the
// record. Deleting/archiving a record keeps them so a restore brings them back; only a
// permanent purge of the removed record (trash reset, archive delete/reset) may drop them.
@Injectable()
export class RecordCommentCleanupService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService
  ) {}

  // Record ids of the table that still own comments or comment subscriptions.
  async getCommentedRecordIds(tableId: string): Promise<string[]> {
    const prisma = this.prismaService.txClient();
    const [comments, subscriptions] = await Promise.all([
      prisma.comment.groupBy({ by: ['recordId'], where: { tableId } }),
      prisma.commentSubscription.groupBy({ by: ['recordId'], where: { tableId } }),
    ]);
    return [...new Set([...comments, ...subscriptions].map(({ recordId }) => recordId))];
  }

  // Drops comments and subscriptions of permanently purged records. Ids that are live
  // again (restored meanwhile) are skipped, so a caller over-matching never hits a live
  // record's thread.
  async purgeRecordComments(tableId: string, recordIds: string[]): Promise<void> {
    if (recordIds.length === 0) {
      return;
    }
    const liveIds = await this.recordService.getExistingRecordIds(tableId, recordIds);
    const deadIds = [...new Set(recordIds)].filter((recordId) => !liveIds.has(recordId));
    const prisma = this.prismaService.txClient();
    for (const batch of chunk(deadIds, BATCH_SIZE)) {
      await prisma.comment.deleteMany({ where: { tableId, recordId: { in: batch } } });
      await prisma.commentSubscription.deleteMany({ where: { tableId, recordId: { in: batch } } });
    }
  }
}
