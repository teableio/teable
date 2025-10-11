import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

export interface IBaseImportAttachmentsCsvJob {
  path: string;
  userId: string;
}

export const BASE_IMPORT_ATTACHMENTS_CSV_QUEUE = 'base-import-attachments-csv-queue';

@Injectable()
export class BaseImportAttachmentsCsvJob {
  constructor(
    @InjectQueue(BASE_IMPORT_ATTACHMENTS_CSV_QUEUE)
    public readonly queue: Queue<IBaseImportAttachmentsCsvJob>
  ) {}
}
