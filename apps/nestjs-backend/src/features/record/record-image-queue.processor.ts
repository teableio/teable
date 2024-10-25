import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { IAttachmentItem } from '@teable/core';
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
  attachmentItem?: IAttachmentItem;
}

export const RECORD_IMAGE_QUEUE = 'record-image-queue';

@Injectable()
@Processor(RECORD_IMAGE_QUEUE)
export class RecordImageQueueProcessor {
  private logger = new Logger(RecordImageQueueProcessor.name);
  constructor(
    private readonly attachmentsStorageService: AttachmentsStorageService,
    @InjectQueue(RECORD_IMAGE_QUEUE) public readonly queue: Queue<IRecordImageJob>
  ) {}

  public async process(job: Job<IRecordImageJob>) {
    const { tableId, attachmentItem } = job.data;
    if (!attachmentItem) {
      return;
    }
    const tableBucket = StorageAdapter.getBucket(UploadType.Table);
    const { path, mimetype, width, height, lgThumbnailUrl, smThumbnailUrl } = attachmentItem;
    if (mimetype.startsWith('image/') && width && height && !smThumbnailUrl && !lgThumbnailUrl) {
      await this.attachmentsStorageService.cropTableImage(tableBucket, path, width, height);
      this.logger.log(`crop table(${tableId}) path(${path}) thumbnails success`);
      return;
    }
    this.logger.log(`table(${tableId}) path(${path}) image is not a image`);
  }
}
