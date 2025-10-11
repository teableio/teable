import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

export interface IRecordImageJob {
  bucket: string;
  token: string;
  path: string;
  mimetype: string;
  height?: number | null;
}

export const ATTACHMENTS_CROP_QUEUE = 'attachments-crop-queue';

@Injectable()
export class AttachmentsCropJob {
  constructor(@InjectQueue(ATTACHMENTS_CROP_QUEUE) public readonly queue: Queue<IRecordImageJob>) {}

  addAttachmentCropImage(data: IRecordImageJob) {
    return this.queue.add('attachment_crop_image', data);
  }
}
