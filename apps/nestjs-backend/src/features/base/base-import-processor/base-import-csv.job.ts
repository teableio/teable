/* eslint-disable @typescript-eslint/naming-convention */
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { IBaseJson } from '@teable/openapi';
import { Queue } from 'bullmq';
export interface IBaseImportCsvJob {
  path: string;
  userId: string;
  tableIdMap: Record<string, string>;
  fieldIdMap: Record<string, string>;
  viewIdMap: Record<string, string>;
  fkMap: Record<string, string>;
  structure: IBaseJson;
}

export const BASE_IMPORT_CSV_QUEUE = 'base-import-csv-queue';

@Injectable()
export class BaseImportCsvJob {
  constructor(
    @InjectQueue(BASE_IMPORT_CSV_QUEUE) public readonly queue: Queue<IBaseImportCsvJob>
  ) {}
}
