import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { chunk, uniq } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { DatabaseRouter } from '../../global/database-router.service';
import { DATA_KNEX } from '../../global/knex/knex.module';

// Storage liveness deliberately ignores actor visibility: an unreadable live record
// still owns its comments, and a restored record must retain its original thread.
@Injectable()
export class RecordStoragePresenceService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly databaseRouter: DatabaseRouter,
    @InjectModel(DATA_KNEX) private readonly knex: Knex
  ) {}

  async getExistingRecordIds(tableId: string, recordIds: string[]): Promise<Set<string>> {
    const existing = new Set<string>();
    if (!recordIds.length) return existing;
    const table = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });
    for (const ids of chunk(uniq(recordIds), 1000)) {
      const query = this.knex(table.dbTableName).select('__id as id').whereIn('__id', ids);
      const rows = await this.databaseRouter.queryDataPrismaForTable<{ id: string }[]>(
        tableId,
        query.toQuery()
      );
      for (const row of rows) existing.add(row.id);
    }
    return existing;
  }
}
