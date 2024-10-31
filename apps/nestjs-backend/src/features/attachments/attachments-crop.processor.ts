import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { Queue } from 'bullmq';
import type { Job } from 'bullmq';
import { AttachmentsStorageService } from '../attachments/attachments-storage.service';

interface IRecordImageJob {
  bucket: string;
  token: string;
  path: string;
  mimetype: string;
  height?: number | null;
}

export const ATTACHMENTS_CROP_QUEUE = 'attachments-crop-queue';

@Injectable()
@Processor(ATTACHMENTS_CROP_QUEUE)
export class AttachmentsCropQueueProcessor extends WorkerHost {
  private logger = new Logger(AttachmentsCropQueueProcessor.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly attachmentsStorageService: AttachmentsStorageService,
    @InjectQueue(ATTACHMENTS_CROP_QUEUE) public readonly queue: Queue<IRecordImageJob>
  ) {
    super();
  }

  public async process(job: Job<IRecordImageJob>) {
    const { bucket, token, path, mimetype, height } = job.data;
    if (mimetype.startsWith('image/') && height) {
      const existingThumbnailPath = await this.prismaService.attachments.findUnique({
        where: { token },
        select: { thumbnailPath: true },
      });
      if (existingThumbnailPath?.thumbnailPath) {
        this.logger.log(`path(${path}) image already has thumbnail`);
        return;
      }
      const { lgThumbnailPath, smThumbnailPath } =
        await this.attachmentsStorageService.cropTableImage(bucket, path, height);
      await this.prismaService.attachments.update({
        where: {
          token,
        },
        data: {
          thumbnailPath: JSON.stringify({
            lg: lgThumbnailPath,
            sm: smThumbnailPath,
          }),
        },
      });
      this.logger.log(`path(${path}) crop thumbnails success`);
      return;
    }
    this.logger.log(`path(${path}) is not a image`);
  }
}
