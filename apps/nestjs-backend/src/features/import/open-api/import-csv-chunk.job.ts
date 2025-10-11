import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { FieldType } from '@teable/core';
import type { IImportOptionRo, IImportColumn } from '@teable/openapi';
import { Queue } from 'bullmq';

export interface ITableImportChunkJob {
  baseId: string;
  table: {
    id: string;
    name: string;
  };
  userId: string;
  importerParams: Pick<IImportOptionRo, 'attachmentUrl' | 'fileType'> & {
    maxRowCount?: number;
  };
  options: {
    skipFirstNLines: number;
    sheetKey: string;
    notification: boolean;
  };
  recordsCal: {
    columnInfo?: IImportColumn[];
    fields: { id: string; type: FieldType }[];
    sourceColumnMap?: Record<string, number | null>;
  };
}

export const TABLE_IMPORT_CSV_CHUNK_QUEUE = 'import-table-csv-chunk-queue';
export const TABLE_IMPORT_CSV_CHUNK_QUEUE_CONCURRENCY = 6;

@Injectable()
export class ImportTableCsvChunkJob {
  constructor(
    @InjectQueue(TABLE_IMPORT_CSV_CHUNK_QUEUE) public readonly queue: Queue<ITableImportChunkJob>
  ) {}
}
