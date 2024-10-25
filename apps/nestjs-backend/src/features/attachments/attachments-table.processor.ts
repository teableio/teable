import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { UploadType } from '@teable/openapi';
import { Queue } from 'bullmq';
import type { Job } from 'bullmq';
import { AttachmentsStorageService } from '../attachments/attachments-storage.service';
import StorageAdapter from '../attachments/plugins/adapter';

export enum AttachmentJobName {
  CropImage = 'cropImage',
}

interface IRecordImageJob {
  tableId: string;
  attachmentItem?: {
    path: string;
    mimetype: string;
    lgThumbnailUrl?: string;
    smThumbnailUrl?: string;
  };
}

export const ATTACHMENTS_TABLE_QUEUE = 'attachments-table-queue';

@Injectable()
@Processor(ATTACHMENTS_TABLE_QUEUE)
export class AttachmentsTableQueueProcessor {
  private logger = new Logger(AttachmentsTableQueueProcessor.name);
  constructor(
    private readonly attachmentsStorageService: AttachmentsStorageService,
    @InjectQueue(ATTACHMENTS_TABLE_QUEUE) public readonly queue: Queue<IRecordImageJob>
  ) {}

  public async process(job: Job<IRecordImageJob>) {
    const { tableId, attachmentItem } = job.data;
    if (!attachmentItem) {
      return;
    }
    const tableBucket = StorageAdapter.getBucket(UploadType.Table);
    const { path, mimetype, lgThumbnailUrl, smThumbnailUrl } = attachmentItem;
    if (mimetype.startsWith('image/') && !smThumbnailUrl && !lgThumbnailUrl) {
      await this.attachmentsStorageService.cropTableImage(tableBucket, path);
      this.logger.log(`crop table(${tableId}) path(${path}) thumbnails success`);
      return;
    }
    this.logger.log(`table(${tableId}) path(${path}) image is not a image`);
  }
}
