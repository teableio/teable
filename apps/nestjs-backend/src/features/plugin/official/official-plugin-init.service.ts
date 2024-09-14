import { join, resolve } from 'path';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generatePluginUserId, getPluginEmail } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { PluginStatus, UploadType } from '@teable/openapi';
import { createReadStream } from 'fs-extra';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import sharp from 'sharp';
import { BaseConfig, IBaseConfig } from '../../../configs/base.config';
import StorageAdapter from '../../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../../attachments/plugins/storage';
import { UserService } from '../../user/user.service';
import { generateSecret } from '../utils';
import { chartConfig } from './config/chart';

@Injectable()
export class OfficialPluginInitService implements OnModuleInit {
  private logger = new Logger(OfficialPluginInitService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly userService: UserService,
    private readonly configService: ConfigService,
    @InjectStorageAdapter() readonly storageAdapter: StorageAdapter,
    @BaseConfig() private readonly baseConfig: IBaseConfig,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  // init official plugins
  async onModuleInit() {
    const officialPlugins = [
      {
        ...chartConfig,
        secret: this.configService.get<string>('PLUGIN_CHART_SECRET') || this.baseConfig.secretKey,
        url: `${this.baseConfig.publicOrigin}/plugin/chart`,
      },
    ];
    await this.prismaService.$tx(
      async () => {
        for (const plugin of officialPlugins) {
          this.logger.log(`Creating official plugin: ${plugin.name}`);
          await this.createOfficialPlugin(plugin);
        }
      },
      { isolationLevel: 'Serializable' }
    );
  }

  async uploadLogo(id: string, filePath: string) {
    const fileStream = createReadStream(resolve(process.cwd(), filePath));
    const metaReader = sharp();
    const sharpReader = fileStream.pipe(metaReader);
    const { width, height, format = 'png', size = 0 } = await sharpReader.metadata();
    const path = join(StorageAdapter.getDir(UploadType.Plugin), id);
    const bucket = StorageAdapter.getBucket(UploadType.Plugin);
    const mimetype = `image/${format}`;
    const { hash } = await this.storageAdapter.uploadFileWidthPath(bucket, path, filePath, {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'Content-Type': mimetype,
    });
    // check if the attachment exists for locking
    const rows = await this.prismaService
      .txClient()
      .$queryRawUnsafe<
        unknown[]
      >(this.knex('attachments').select('token').where('token', id).forUpdate().toString());
    if (rows.length === 0) {
      await this.prismaService.txClient().attachments.create({
        data: {
          token: id,
          path,
          size,
          width,
          height,
          hash,
          mimetype,
          createdBy: 'system',
        },
      });
    } else {
      await this.prismaService.txClient().attachments.update({
        data: {
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
    }
    return `/${path}/${id}`;
  }

  async createOfficialPlugin(pluginConfig: typeof chartConfig & { secret: string; url: string }) {
    const {
      id: pluginId,
      name,
      description,
      detailDesc,
      logoPath,
      i18n,
      positions,
      helpUrl,
      secret,
      url,
    } = pluginConfig;

    const rows = await this.prismaService
      .txClient()
      .$queryRawUnsafe<
        unknown[]
      >(this.knex('plugin').select('name').where('id', pluginId).forUpdate().toString());

    if (rows.length > 0) {
      const { hashedSecret, maskedSecret } = await generateSecret(secret);
      return this.prismaService.txClient().plugin.update({
        where: {
          id: pluginId,
        },
        data: {
          secret: hashedSecret,
          maskedSecret,
        },
      });
    }
    // upload logo
    const logo = await this.uploadLogo(pluginId, logoPath);
    const pluginUserId = generatePluginUserId();
    const user = await this.userService.createSystemUser({
      id: pluginUserId,
      name,
      email: getPluginEmail(pluginId),
    });
    const { hashedSecret, maskedSecret } = await generateSecret(secret);
    return this.prismaService.txClient().plugin.create({
      select: {
        id: true,
        name: true,
        description: true,
        detailDesc: true,
        positions: true,
        helpUrl: true,
        logo: true,
        url: true,
        status: true,
        i18n: true,
        secret: true,
        createdTime: true,
      },
      data: {
        id: pluginId,
        name,
        description,
        detailDesc,
        positions: JSON.stringify(positions),
        helpUrl,
        url,
        logo,
        status: PluginStatus.Published,
        i18n: JSON.stringify(i18n),
        secret: hashedSecret,
        maskedSecret,
        pluginUser: user.id,
        createdBy: 'system',
      },
    });
  }
}
