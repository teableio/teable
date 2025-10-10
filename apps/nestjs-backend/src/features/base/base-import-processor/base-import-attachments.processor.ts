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
  private processedJobs = new Set<string>();

  constructor(
    private readonly prismaService: PrismaService,
    private readonly baseImportAttachmentsCsvQueueProcessor: BaseImportAttachmentsCsvQueueProcessor,
    @InjectStorageAdapter() private readonly storageAdapter: StorageAdapter,
    @InjectQueue(BASE_IMPORT_ATTACHMENTS_QUEUE) public readonly queue: Queue<IBaseImportJob>
  ) {
    super();
  }

  public async process(job: Job<IBaseImportJob>) {
    const jobId = String(job.id);
    if (this.processedJobs.has(jobId)) {
      this.logger.log(`Job ${jobId} already processed, skipping`);
      return;
    }

    this.processedJobs.add(jobId);

    try {
      await this.handleBaseImportAttachments(job);
    } catch (error) {
      this.logger.error(
        `Process base import attachments failed: ${(error as Error)?.message}`,
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
    const parser = unzipper.Parse();
    zipStream.pipe(parser);
    const bucket = StorageAdapter.getBucket(UploadType.Table);

    return new Promise((resolve, reject) => {
      let processingFiles = 0;
      let hasError = false;

      parser.on('entry', (entry) => {
        const filePath = entry.path;
        const fileSuffix = filePath.split('.').pop();
        if (
          filePath.startsWith('attachments/') &&
          entry.type !== 'Directory' &&
          fileSuffix !== 'csv'
        ) {
          processingFiles++;

          const passThrough = new PassThrough();
          entry.pipe(passThrough);

          const token = filePath.replace('attachments/', '').split('.')[0];
          const isThumbnail = token.includes('thumbnail__');
          const fileSuffix = filePath.replace('attachments/', '').split('.').pop();
          const pathDir = StorageAdapter.getDir(UploadType.Table);
          const mimeTypeFromExtension = this.getFileMimeType(fileSuffix);

          const finalPath = isThumbnail
            ? `table/${token.split('__')[1].split('.')[0]}`
            : `${pathDir}/${token}`;

          const finalToken = isThumbnail ? token.split('__')[1].split('.')[0] : token;

          this.logger.log(`start upload attachment: ${token}`);

          // this.storageAdapter
          //   .uploadFile(bucket, finalPath, passThrough, {
          //     // eslint-disable-next-line @typescript-eslint/naming-convention
          //     'Content-Type': mimeTypeFromExtension,
          //   })
          //   .then(() => {
          //     this.logger.log(`attachment finished: ${token}`);
          //     processingFiles--;
          //     checkComplete();
          //   })
          //   .catch((err) => {
          //     this.logger.error(`attachment upload error ${token}: ${err.message}`);
          //     hasError = true;
          //     processingFiles--;
          //     checkComplete();
          //   });

          // if the token file is existed, skip the upload
          this.prismaService
            .txClient()
            .attachments.findUnique({
              where: {
                token: finalToken,
              },
              select: {
                id: true,
              },
            })
            .then(async (res) => {
              if (res) {
                this.logger.log(`attachment already exists: ${token}`);
                processingFiles--;
                checkComplete();
                return;
              }
              // update attachment
              await this.storageAdapter.uploadFileStream(bucket, finalPath, passThrough, {
                // eslint-disable-next-line @typescript-eslint/naming-convention
                'Content-Type': mimeTypeFromExtension,
              });

              this.logger.log(`attachment finished: ${token}`);
              processingFiles--;
              checkComplete();
            })
            .catch((err) => {
              this.logger.error(`attachment upload error ${token}: ${err.message}`);
              hasError = true;
              processingFiles--;
              checkComplete();
            });
        } else {
          entry.autodrain();
        }
      });

      const checkComplete = () => {
        if (processingFiles === 0) {
          if (hasError) {
            reject(new Error('upload attachments error'));
          } else {
            parser.end();
            parser.destroy();
            zipStream.destroy();
          }

          if (parser.closed) {
            resolve(true);
          }
        }
      };

      parser.on('close', () => {
        this.logger.log(`import attachments success`);
        if (processingFiles === 0) {
          resolve(true);
        }
      });

      parser.on('error', (err) => {
        this.logger.error(`import attachments error: ${err.message}`);
        hasError = true;
        reject(err);
      });
    });
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
