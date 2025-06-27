import { join, resolve } from 'path';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getPluginEmail } from '@teable/core';
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
import { sheetFormConfig } from './config/sheet-form-view';
import type { IOfficialPluginConfig } from './config/types';

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
        url: `/plugin/chart`,
      },
      {
        ...sheetFormConfig,
        secret:
          this.configService.get<string>('PLUGIN_SHEETFORMVIEW_SECRET') ||
          this.baseConfig.secretKey,
        url: `/plugin/sheet-form-view`,
      },
    ];

    try {
      await this.prismaService.$tx(async () => {
        for (const plugin of officialPlugins) {
          this.logger.log(`Creating official plugin: ${plugin.name}`);
          await this.createOfficialPlugin(plugin);
        }
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      if (error.code !== 'P2002') {
        throw error;
      }
    }
    this.logger.log('Official plugins initialized');
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

  async createOfficialPlugin(
    pluginConfig: IOfficialPluginConfig & { secret: string; url: string }
  ) {
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
      pluginUserId,
      avatarPath,
    } = pluginConfig;

    const rows = await this.prismaService.txClient().plugin.count({ where: { id: pluginId } });
    // upload logo
    const logo = await this.uploadStatic(pluginId, logoPath, UploadType.Plugin);
    const { hashedSecret, maskedSecret } = await generateSecret(secret);
    let userId: string | undefined;
    if (pluginUserId) {
      const userEmail = getPluginEmail(pluginId);
      // create plugin user
      const user = await this.prismaService
        .txClient()
        .user.findFirst({ where: { id: pluginUserId, email: userEmail } });
      let avatar: string | undefined;
      if (avatarPath) {
        // upload user avatar
        avatar = await this.uploadStatic(pluginUserId, avatarPath, UploadType.Avatar);
      }
      if (!user) {
        await this.userService.createSystemUser({
          id: pluginUserId,
          name,
          avatar,
          email: userEmail,
        });
      }
      userId = pluginUserId;
    }
    if (rows > 0) {
      return this.prismaService.txClient().plugin.update({
        where: {
          id: pluginId,
        },
        data: {
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
          pluginUser: userId || pluginUserId,
          createdBy: 'system',
        },
      });
    }
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
        pluginUser: userId || pluginUserId,
        createdBy: 'system',
      },
    });
  }
}
