import { join, resolve } from 'path';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { UploadType } from '@teable/openapi';
import { createReadStream } from 'fs-extra';
import sharp from 'sharp';
import StorageAdapter from '../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../attachments/plugins/storage';

@Injectable()
export class UserInitService implements OnModuleInit {
  private logger = new Logger(UserInitService.name);

  constructor(
    private readonly prismaService: PrismaService,
    @InjectStorageAdapter() readonly storageAdapter: StorageAdapter
  ) {}

  async onModuleInit() {
    await this.uploadStatic(
      'automationRobot',
      'static/system/automation-robot.png',
      UploadType.Avatar
    );
    await this.uploadStatic('anonymous', 'static/system/anonymous.png', UploadType.Avatar);

    this.logger.log('System users initialized');
  }

  async uploadStatic(id: string, filePath: string, type: UploadType) {
    const fileStream = createReadStream(resolve(process.cwd(), filePath));
    const metaReader = sharp();
    const sharpReader = fileStream.pipe(metaReader);
    const { width, height, format = 'png', size = 0 } = await sharpReader.metadata();
    const path = join(StorageAdapter.getDir(type), id);
    const bucket = StorageAdapter.getBucket(type);
    const mimetype = `image/${format}`;
    const { hash } = await this.storageAdapter.uploadFileWidthPath(bucket, path, filePath, {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'Content-Type': mimetype,
    });
    await this.prismaService.txClient().attachments.upsert({
      create: {
        token: id,
        path,
        size,
        width,
        height,
        hash,
        mimetype,
        createdBy: 'system',
      },
      update: {
        size,
        width,
        height,
        hash,
        mimetype,
        lastModifiedBy: 'system',
      },
      where: {
        token: id,
        deletedTime: null,
      },
    });
    return `/${path}`;
  }
}
