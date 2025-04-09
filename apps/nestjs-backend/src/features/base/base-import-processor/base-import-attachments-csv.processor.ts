import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Attachments } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { UploadType } from '@teable/openapi';
import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import * as csvParser from 'csv-parser';
import * as unzipper from 'unzipper';
import StorageAdapter from '../../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../../attachments/plugins/storage';
import { BatchProcessor } from '../BatchProcessor.class';

interface IBaseImportAttachmentsCsvJob {
  path: string;
  userId: string;
}

export const BASE_IMPORT_ATTACHMENTS_CSV_QUEUE = 'base-import-attachments-csv-queue';

@Injectable()
@Processor(BASE_IMPORT_ATTACHMENTS_CSV_QUEUE)
export class BaseImportAttachmentsCsvQueueProcessor extends WorkerHost {
  private logger = new Logger(BaseImportAttachmentsCsvQueueProcessor.name);

  private processedJobs = new Set<string>();

  constructor(
    private readonly prismaService: PrismaService,
    @InjectStorageAdapter() private readonly storageAdapter: StorageAdapter,
    @InjectQueue(BASE_IMPORT_ATTACHMENTS_CSV_QUEUE)
    public readonly queue: Queue<IBaseImportAttachmentsCsvJob>
  ) {
    super();
  }

  public async process(job: Job<IBaseImportAttachmentsCsvJob>) {
    const jobId = String(job.id);
    if (this.processedJobs.has(jobId)) {
      this.logger.log(`Job ${jobId} already processed, skipping`);
      return;
    }

    this.processedJobs.add(jobId);

    try {
      await this.handleBaseImportAttachmentsCsv(job);
    } catch (error) {
      this.logger.error(
        `Process base import attachment csv failed: ${(error as Error)?.message}`,
        (error as Error)?.stack
      );
    }
  }

  private async handleBaseImportAttachmentsCsv(job: Job<IBaseImportAttachmentsCsvJob>) {
    const { path, userId } = job.data;
    const csvStream = await this.storageAdapter.downloadFile(
      StorageAdapter.getBucket(UploadType.Import),
      path
    );

    const parser = unzipper.Parse();
    csvStream.pipe(parser);

    return new Promise<{ success: boolean }>((resolve, reject) => {
      parser.on('entry', (entry) => {
        const filePath = entry.path;

        const fileSuffix = filePath.split('.').pop();

        if (
          filePath.startsWith('attachments/') &&
          entry.type !== 'Directory' &&
          fileSuffix === 'csv'
        ) {
          const batchProcessor = new BatchProcessor<Attachments>((chunk) =>
            this.handleChunk(chunk, userId)
          );

          entry
            .pipe(
              csvParser.default({
                // strict: true,
                mapValues: ({ value }) => {
                  return value;
                },
                mapHeaders: ({ header }) => {
                  return header;
                },
              })
            )
            .pipe(batchProcessor)
            .on('error', (error: Error) => {
              this.logger.error(
                `process csv attachments import error: ${error.message}`,
                error.stack
              );
              reject(error);
            })
            .on('end', () => {
              this.logger.log(`attachments csv finished`);
              resolve({ success: true });
            });
        } else {
          entry.autodrain();
        }
      });

      parser.on('close', () => {
        this.logger.log('import csv completed');
        resolve({ success: true });
      });

      parser.on('error', (error) => {
        this.logger.error(`ZIP parser error: ${error.message}`, error.stack);
        reject(error);
      });
    });
  }

  private async handleChunk(results: Attachments[], userId: string) {
    for (const result of results) {
      const att = await this.prismaService.attachments.findUnique({
        where: {
          id: result.id,
        },
      });

      if (att) {
        continue;
      }

      await this.prismaService.attachments.create({
        data: {
          id: result.id,
          token: result.token,
          hash: result.hash,
          size: Number(result.size),
          mimetype: result.mimetype,
          path: result.path,
          width: result.width ? Number(result.width) : null,
          height: result.height ? Number(result.height) : null,
          thumbnailPath: result.thumbnailPath,
          createdBy: userId,
        },
      });
    }
  }
}
