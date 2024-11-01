import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { PluginStatus, UploadType } from '@teable/openapi';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
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
      console.log('attachments', attachments, sqlNative.sql);
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
}
