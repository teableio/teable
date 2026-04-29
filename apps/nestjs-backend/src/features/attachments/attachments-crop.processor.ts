import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { NestWorkerOptions } from '@nestjs/bullmq/dist/interfaces/worker-options.interface';
import { Injectable, Logger } from '@nestjs/common';
import { isImage, isPdf } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Queue } from 'bullmq';
import type { Job } from 'bullmq';
import sharp from 'sharp';
import { EventEmitterService } from '../../event-emitter/event-emitter.service';
import { Events } from '../../event-emitter/events';
import { AttachmentsStorageService } from '../attachments/attachments-storage.service';
import { renderPdfFirstPageAsImage } from './pdf-thumbnail';
import StorageAdapter from './plugins/adapter';
import { InjectStorageAdapter } from './plugins/storage';

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
    @InjectStorageAdapter() private readonly storageAdapter: StorageAdapter,
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

    const existing = await this.prismaService.attachments.findUnique({
      where: { token },
      select: { thumbnailPath: true },
    });
    if (!existing) {
      this.logger.log(`Attachment with token(${token}) does not exist.`);
      return;
    }
    if (existing.thumbnailPath) {
      this.logger.log(`path(${path}) already has thumbnail`);
      return;
    }

    let lgThumbnailPath: string | undefined;
    let smThumbnailPath: string | undefined;

    if (isImage(mimetype) && height) {
      ({ lgThumbnailPath, smThumbnailPath } = await this.attachmentsStorageService.cropTableImage(
        bucket,
        path,
        height
      ));
    } else if (isPdf(mimetype)) {
      try {
        const stream = await this.storageAdapter.downloadFile(bucket, path);
        const chunks: Buffer[] = [];
        for await (const chunk of stream as AsyncIterable<Buffer>) {
          chunks.push(Buffer.from(chunk));
        }
        const pdfBuffer = Buffer.concat(chunks);
        const { buffer, height: imgHeight } = await renderPdfFirstPageAsImage(pdfBuffer);

        const isBlank = await this.isBlankImage(buffer);
        if (isBlank) {
          this.logger.warn(`PDF thumbnail for ${path} is blank, skipping storage`);
          return;
        }

        ({ lgThumbnailPath, smThumbnailPath } =
          await this.attachmentsStorageService.uploadTableImageThumbnailsFromBuffer(
            bucket,
            path,
            buffer,
            imgHeight
          ));
      } catch (error) {
        this.logger.error(`PDF thumbnail failed for ${path}`, error);
        // Non-fatal: frontend falls back to PDF icon
        return;
      }
    } else {
      this.logger.log(`path(${path}) is not a supported type for thumbnails`);
      return;
    }

    await this.prismaService.attachments.update({
      where: { token },
      data: {
        thumbnailPath: JSON.stringify({ lg: lgThumbnailPath, sm: smThumbnailPath }),
      },
    });
    this.logger.log(`path(${path}) crop thumbnails success`);
  }

  private async isBlankImage(pngBuffer: Buffer): Promise<boolean> {
    const { channels } = await sharp(pngBuffer).stats();
    return channels.slice(0, 3).every((ch) => ch.min >= 250);
  }
}
