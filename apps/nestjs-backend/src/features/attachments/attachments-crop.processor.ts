import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { NestWorkerOptions } from '@nestjs/bullmq/dist/interfaces/worker-options.interface';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { Queue } from 'bullmq';
import type { Job } from 'bullmq';
import { EventEmitterService } from '../../event-emitter/event-emitter.service';
import { Events } from '../../event-emitter/events';
import { AttachmentsStorageService } from '../attachments/attachments-storage.service';

interface IRecordImageJob {
  bucket: string;
  token: string;
  path: string;
  mimetype: string;
  height?: number | null;
}

export const ATTACHMENTS_CROP_QUEUE = 'attachments-crop-queue';

const queueOptions: NestWorkerOptions = {
  removeOnComplete: {
    count: 2000,
  },
  removeOnFail: {
    count: 2000,
  },
};
@Injectable()
@Processor(ATTACHMENTS_CROP_QUEUE, queueOptions)
export class AttachmentsCropQueueProcessor extends WorkerHost {
  private logger = new Logger(AttachmentsCropQueueProcessor.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly attachmentsStorageService: AttachmentsStorageService,
    private readonly eventEmitterService: EventEmitterService,
    @InjectQueue(ATTACHMENTS_CROP_QUEUE) public readonly queue: Queue<IRecordImageJob>
  ) {
    super();
  }

  public async process(job: Job<IRecordImageJob>) {
    await this.handleCropImage(job);
    await this.eventEmitterService.emitAsync(Events.CROP_IMAGE_COMPLETE, {
      token: job.data.token,
    });
  }

  private async handleCropImage(job: Job<IRecordImageJob>) {
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
