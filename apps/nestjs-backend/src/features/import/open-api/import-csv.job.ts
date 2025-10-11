/* eslint-disable @typescript-eslint/naming-convention */
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import {
  getActionTriggerChannel,
  getRandomString,
  getTableImportChannel,
  type FieldType,
} from '@teable/core';
import { type IImportColumn } from '@teable/openapi';
import { Queue } from 'bullmq';
import type { LocalPresence } from 'sharedb/lib/client';
import { ShareDbService } from '../../../share-db/share-db.service';

export interface ITableImportCsvJob {
  baseId: string;
  userId: string;
  path: string;
  columnInfo?: IImportColumn[];
  fields: { id: string; type: FieldType }[];
  sourceColumnMap?: Record<string, number | null>;
  table: { id: string; name: string };
  range: [number, number];
  notification?: boolean;
  lastChunk?: boolean;
  parentJobId: string;
}

export const TABLE_IMPORT_CSV_QUEUE = 'import-table-csv-queue';

@Injectable()
export class ImportTableCsvJob {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private presences: LocalPresence<any>[] = [];
  private logger = new Logger(ImportTableCsvJob.name);

  constructor(
    private readonly shareDbService: ShareDbService,
    @InjectQueue(TABLE_IMPORT_CSV_QUEUE) public readonly queue: Queue<ITableImportCsvJob>
  ) {}

  public getChunkImportJobIdPrefix(parentId: string) {
    return `${parentId}_import_${getRandomString(6)}`;
  }

  public getChunkImportJobId(jobId: string, range: [number, number]) {
    const prefix = this.getChunkImportJobIdPrefix(jobId);
    return `${prefix}_[${range[0]},${range[1]}]`;
  }

  setImportStatus(presence: LocalPresence<unknown>, loading: boolean) {
    presence.submit(
      {
        loading,
      },
      (error) => {
        error && this.logger.error(error);
      }
    );
  }

  createImportPresence(tableId: string, type: 'rowCount' | 'status' = 'status') {
    const channel =
      type === 'rowCount' ? getActionTriggerChannel(tableId) : getTableImportChannel(tableId);
    const existPresence = this.presences.find(({ presence }) => {
      return presence.channel === channel;
    });
    if (existPresence) {
      return existPresence;
    }
    const presence = this.shareDbService.connect().getPresence(channel);
    const localPresence = presence.create(channel);
    this.presences.push(localPresence);
    return localPresence;
  }

  deleteImportPresence(presenceId: string) {
    this.presences = this.presences.filter((presence) => presence.presenceId !== presenceId);
  }
}
