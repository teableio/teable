/* eslint-disable @typescript-eslint/naming-convention */
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { IBaseJson } from '@teable/openapi';
import { Queue } from 'bullmq';

export interface IBaseImportJunctionCsvJob {
  path: string;
  fieldIdMap: Record<string, string>;
  structure: IBaseJson;
}

export const BASE_IMPORT_JUNCTION_CSV_QUEUE = 'base-import-junction-csv-queue';

@Injectable()
export class BaseImportJunctionCsvJob {
  constructor(
    @InjectQueue(BASE_IMPORT_JUNCTION_CSV_QUEUE)
    public readonly queue: Queue<IBaseImportJunctionCsvJob>
  ) {}
}
