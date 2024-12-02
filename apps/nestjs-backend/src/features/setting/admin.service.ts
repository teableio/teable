import { Session } from 'node:inspector';
import { Readable } from 'node:stream';
import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { PluginStatus, UploadType } from '@teable/openapi';
import { Response } from 'express';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { Timing } from '../../utils/timing';
import { AttachmentsCropQueueProcessor } from '../attachments/attachments-crop.processor';
import StorageAdapter from '../attachments/plugins/adapter';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  constructor(
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    private readonly attachmentsCropQueueProcessor: AttachmentsCropQueueProcessor
  ) {}

  async publishPlugin(pluginId: string) {
    return this.prismaService.plugin.update({
      where: { id: pluginId, status: PluginStatus.Reviewing },
      data: { status: PluginStatus.Published },
    });
  }

  async repairTableAttachmentThumbnail() {
    // once handle 1000 attachments
    const take = 1000;
    let total = 0;
    for (let skip = 0; ; skip += take) {
      const sqlNative = this.knex('attachments_table')
        .select(
          'attachments.token',
          'attachments.height',
          'attachments.mimetype',
          'attachments.path'
        )
        .leftJoin('attachments', 'attachments_table.token', 'attachments.token')
        .whereNotNull('attachments.height')
        .whereNull('attachments.deleted_time')
        .whereNull('attachments.thumbnail_path')
        .limit(take)
        .offset(skip)
        .toSQL()
        .toNative();
      const attachments = await this.prismaService.$queryRawUnsafe<
        { token: string; height?: number; mimetype: string; path: string }[]
      >(sqlNative.sql, ...sqlNative.bindings);
      this.logger.log('attachments', attachments, sqlNative.sql);
      if (attachments.length === 0) {
        break;
      }
      total += attachments.length;
      await this.attachmentsCropQueueProcessor.queue.addBulk(
        attachments.map((attachment) => ({
          name: 'admin_attachment_crop_image',
          data: {
            ...attachment,
            bucket: StorageAdapter.getBucket(UploadType.Table),
          },
        }))
      );
      this.logger.log(`Processed ${attachments.length} attachments`);
    }
    this.logger.log(`Total processed ${total} attachments`);
  }

  @Timing()
  async getHeapSnapshot(res: Response) {
    const podName = process.env.HOSTNAME || 'unknown';
    const session = new Session();
    const timestamp = new Date().toISOString();
    const filename = `heap-${podName}-${timestamp}.heapsnapshot`;
    try {
      const snapshotStream = new Readable({
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        read() {},
      });

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      session.connect();
      session.on('HeapProfiler.addHeapSnapshotChunk', (m) => {
        snapshotStream.push(m.params.chunk);
      });

      const snapshotPromise = new Promise<void>((resolve, reject) => {
        session.post('HeapProfiler.takeHeapSnapshot', undefined, (err) => {
          if (err) {
            reject(err);
          } else {
            snapshotStream.push(null);
            resolve();
          }
        });
      });

      snapshotStream.on('error', (error) => {
        this.logger.error(`Stream error for pod ${podName}:`, error);
        throw new InternalServerErrorException(`Stream error: ${error.message}`);
      });

      snapshotStream.pipe(res);

      await new Promise<void>((resolve, reject) => {
        res.on('finish', () => {
          this.logger.log(`Heap snapshot streaming completed for pod ${podName}`);
          resolve();
        });

        res.on('error', (error) => {
          this.logger.error(`Response error for pod ${podName}:`, error);
          reject(error);
        });

        snapshotStream.on('error', reject);
      });

      await snapshotPromise;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      throw new InternalServerErrorException(
        `Failed to get heap snapshot: ${error.message}, podName: ${podName}, timestamp: ${timestamp}`
      );
    } finally {
      session.disconnect();
      this.logger.log(`Session disconnected for pod ${podName}`);
    }
  }
}
