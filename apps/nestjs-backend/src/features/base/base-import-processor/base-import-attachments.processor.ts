/* eslint-disable sonarjs/no-duplicate-string */
import { PassThrough } from 'stream';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { UploadType } from '@teable/openapi';
import { Queue, Job } from 'bullmq';
import * as unzipper from 'unzipper';
import StorageAdapter from '../../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../../attachments/plugins/storage';
import {
  BASE_IMPORT_ATTACHMENTS_CSV_QUEUE,
  BaseImportAttachmentsCsvQueueProcessor,
} from './base-import-attachments-csv.processor';

interface IBaseImportJob {
  path: string;
  userId: string;
}

export const BASE_IMPORT_ATTACHMENTS_QUEUE = 'base-import-attachments-queue';

@Injectable()
@Processor(BASE_IMPORT_ATTACHMENTS_QUEUE)
export class BaseImportAttachmentsQueueProcessor extends WorkerHost {
  private logger = new Logger(BaseImportAttachmentsQueueProcessor.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly baseImportAttachmentsCsvQueueProcessor: BaseImportAttachmentsCsvQueueProcessor,
    @InjectStorageAdapter() private readonly storageAdapter: StorageAdapter,
    @InjectQueue(BASE_IMPORT_ATTACHMENTS_QUEUE) public readonly queue: Queue<IBaseImportJob>
  ) {
    super();
  }

  public async process(job: Job<IBaseImportJob>) {
    try {
      await this.handleBaseImportAttachments(job);
    } catch (error) {
      this.logger.error(
        `[base import attachment] Process base import attachments failed: ${(error as Error)?.message}`,
        (error as Error)?.stack
      );
    }
  }

  getFileMimeType = (extension: string): string => {
    const ext = extension.toLowerCase().replace(/^\./, '');

    const extensionToMimeType: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      bmp: 'image/bmp',
      webp: 'image/webp',
      svg: 'image/svg+xml',

      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      flac: 'audio/x-flac',

      mp4: 'video/mp4',
      avi: 'video/x-msvideo',
      mkv: 'video/x-matroska',
      ogv: 'video/ogg',
      webm: 'video/webm',

      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      txt: 'text/plain',
      csv: 'text/csv',

      zip: 'application/zip',
      rar: 'application/x-rar-compressed',

      json: 'application/json',
      xml: 'application/xml',
      html: 'text/html',
      htm: 'text/html',
      css: 'text/css',
      js: 'text/javascript',

      md: 'text/markdown',
    };

    return extensionToMimeType[ext] || 'application/octet-stream';
  };

  private async handleBaseImportAttachments(job: Job<IBaseImportJob>) {
    const { path } = job.data;
    const zipStream = await this.storageAdapter.downloadFile(
      StorageAdapter.getBucket(UploadType.Import),
      path
    );
    const parser = unzipper.Parse({ forceStream: true });
    zipStream.pipe(parser);
    const bucket = StorageAdapter.getBucket(UploadType.Table);

    try {
      for await (const entry of parser.pipe(new PassThrough({ objectMode: true }))) {
        await this.processAttachmentEntry(entry, bucket);
      }

      this.logger.log(`[base import attachment] all finished`);
    } finally {
      zipStream.destroy();
    }
  }

  private async processAttachmentEntry(entry: unzipper.Entry, bucket: string) {
    const filePath = entry.path;
    const fileSuffix = filePath.split('.').pop() ?? '';

    if (
      !filePath.startsWith('attachments/') ||
      entry.type === 'Directory' ||
      fileSuffix === 'csv'
    ) {
      entry.autodrain();
      return;
    }

    let passThrough: PassThrough | undefined;
    try {
      const token = filePath.replace('attachments/', '').split('.')[0];
      const isThumbnail = token.includes('thumbnail__');
      const mimeType = this.getFileMimeType(fileSuffix);
      const pathDir = StorageAdapter.getDir(UploadType.Table);
      const finalPath = isThumbnail
        ? `table/${token.split('__')[1].split('.')[0]}`
        : `${pathDir}/${token}`;
      const finalToken = isThumbnail ? token.split('__')[1].split('.')[0] : token;

      this.logger.log(`[base import attachment] start upload: ${token}`);

      const existing = await this.prismaService.txClient().attachments.findUnique({
        where: { token: finalToken },
        select: { id: true },
      });

      if (existing) {
        this.logger.log(`[base import attachment]  already exists: ${token}`);
        entry.autodrain();
        return;
      }

      passThrough = new PassThrough();
      entry.pipe(passThrough);

      await this.storageAdapter.uploadFileStream(bucket, finalPath, passThrough, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': mimeType,
      });

      this.logger.log(`[base import attachment] ${token} finished: ${token}`);
    } catch (err) {
      this.logger.error(`[base import attachment] upload  error: ${(err as Error).message}`);
      if (passThrough) {
        passThrough.resume();
      } else {
        entry.autodrain();
      }
    }
  }

  @OnWorkerEvent('completed')
  async onCompleted(job: Job) {
    const { path, userId } = job.data;
    this.baseImportAttachmentsCsvQueueProcessor.queue.add(
      BASE_IMPORT_ATTACHMENTS_CSV_QUEUE,
      {
        path,
        userId,
      },
      {
        jobId: `import_attachments_csv_${path}_${userId}`,
      }
    );
  }
}
