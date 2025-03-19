import { PassThrough } from 'stream';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { UploadType } from '@teable/openapi';
import { Queue } from 'bullmq';
import type { Job } from 'bullmq';
import * as unzipper from 'unzipper';
import StorageAdapter from '../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../attachments/plugins/storage';

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
    @InjectStorageAdapter() private readonly storageAdapter: StorageAdapter,
    @InjectQueue(BASE_IMPORT_ATTACHMENTS_QUEUE) public readonly queue: Queue<IBaseImportJob>
  ) {
    super();
  }

  public async process(job: Job<IBaseImportJob>) {
    this.handleBaseImportAttachments(job);
  }

  private async handleBaseImportAttachments(job: Job<IBaseImportJob>) {
    const { path, userId } = job.data;
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
        if (filePath.startsWith('attachments/') && entry.type !== 'Directory') {
          processingFiles++;

          const passThrough = new PassThrough();
          entry.pipe(passThrough);

          const token = filePath.replace('attachments/', '').split('.')[0];
          const pathDir = StorageAdapter.getDir(UploadType.Table);

          this.logger.log(`start upload attachment: ${token}`);

          // if the token file is existed, skip the upload
          this.prismaService
            .txClient()
            .attachments.findUnique({
              where: {
                token,
              },
              select: {
                id: true,
              },
            })
            .then((res) => {
              if (res) {
                this.logger.log(`attachment already exists: ${token}`);
                processingFiles--;
                checkComplete();
                return;
              }
              // update attachment
              this.storageAdapter
                .uploadFile(bucket, `${pathDir}/${token}`, passThrough)
                .then(({ path }) => {
                  return this.storageAdapter.getObjectMeta(bucket, path, token);
                })
                .then(({ hash, size, mimetype, width, height }) => {
                  return this.prismaService.txClient().attachments.create({
                    data: {
                      hash,
                      size,
                      mimetype,
                      token,
                      path: `${pathDir}/${token}`,
                      width,
                      height,
                      createdBy: userId,
                    },
                    select: {
                      token: true,
                      size: true,
                      mimetype: true,
                      width: true,
                      height: true,
                      path: true,
                    },
                  });
                })
                .then(() => {
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
            resolve(true);
          }
        }
      };

      parser.on('close', () => {
        this.logger.log(`resolve zip file success`);
        if (processingFiles === 0) {
          checkComplete();
        }
      });

      parser.on('error', (err) => {
        this.logger.error(`resolve zip file error: ${err.message}`);
        hasError = true;
        reject(err);
      });
    });
  }
}
