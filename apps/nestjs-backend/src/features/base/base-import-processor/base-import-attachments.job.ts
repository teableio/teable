import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

export interface IBaseImportJob {
  path: string;
  userId: string;
}

export const BASE_IMPORT_ATTACHMENTS_QUEUE = 'base-import-attachments-queue';

@Injectable()
export class BaseImportAttachmentsJob {
  constructor(
    @InjectQueue(BASE_IMPORT_ATTACHMENTS_QUEUE) public readonly queue: Queue<IBaseImportJob>
  ) {}
}
