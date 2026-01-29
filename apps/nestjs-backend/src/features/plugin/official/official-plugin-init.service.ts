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

interface IUploadResult {
  id: string;
  path: string;
  url: string;
  size: number;
  width?: number;
  height?: number;
  hash: string;
  mimetype: string;
}

interface IPreparedPlugin {
  config: IOfficialPluginConfig & { secret: string; url: string };
  logo: IUploadResult;
  avatar?: IUploadResult;
  hashedSecret: string;
  maskedSecret: string;
}

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
      // Phase 1: Upload files to storage (outside transaction)
      const preparedPlugins: IPreparedPlugin[] = [];
      for (const plugin of officialPlugins) {
        this.logger.log(`Creating official plugin: ${plugin.name}`);
        const prepared = await this.preparePlugin(plugin);
        preparedPlugins.push(prepared);
      }

      // Phase 2: Database operations (inside transaction)
      await this.prismaService.$tx(async () => {
        for (const prepared of preparedPlugins) {
          await this.savePlugin(prepared);
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

  private async uploadToStorage(
    id: string,
    filePath: string,
    type: UploadType
  ): Promise<IUploadResult> {
    const path = join(StorageAdapter.getDir(type), id);

    if (process.env.NODE_ENV === 'test') {
      return { id, path, url: `/${path}`, size: 0, hash: '', mimetype: 'image/png' };
    }

    const fileStream = createReadStream(resolve(process.cwd(), filePath));
    const metaReader = sharp();
    const sharpReader = fileStream.pipe(metaReader);
    const { width, height, format = 'png', size = 0 } = await sharpReader.metadata();
    const bucket = StorageAdapter.getBucket(type);
    const mimetype = `image/${format}`;
    const { hash } = await this.storageAdapter.uploadFileWidthPath(bucket, path, filePath, {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'Content-Type': mimetype,
    });

    return { id, path, url: `/${path}`, size, width, height, hash, mimetype };
  }

  private async saveAttachment(upload: IUploadResult): Promise<void> {
    const { id, path, size, width, height, hash, mimetype } = upload;
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
  }

  private async preparePlugin(
    pluginConfig: IOfficialPluginConfig & { secret: string; url: string }
  ): Promise<IPreparedPlugin> {
    const { id: pluginId, logoPath, avatarPath, pluginUserId, secret } = pluginConfig;

    const logo = await this.uploadToStorage(pluginId, logoPath, UploadType.Plugin);
    const { hashedSecret, maskedSecret } = await generateSecret(secret);

    let avatar: IUploadResult | undefined;
    if (pluginUserId && avatarPath) {
      avatar = await this.uploadToStorage(pluginUserId, avatarPath, UploadType.Avatar);
    }

    return { config: pluginConfig, logo, avatar, hashedSecret, maskedSecret };
  }

  private async savePlugin(prepared: IPreparedPlugin): Promise<void> {
    const { config, logo, avatar, hashedSecret, maskedSecret } = prepared;
    const {
      id: pluginId,
      name,
      description,
      detailDesc,
      i18n,
      positions,
      helpUrl,
      url,
      pluginUserId,
    } = config;

    // Save attachments
    await this.saveAttachment(logo);
    if (avatar) {
      await this.saveAttachment(avatar);
    }

    // Create plugin user if needed
    let userId: string | undefined;
    if (pluginUserId) {
      const userEmail = getPluginEmail(pluginId);
      const user = await this.prismaService
        .txClient()
        .user.findFirst({ where: { id: pluginUserId, email: userEmail } });

      if (!user) {
        await this.userService.createSystemUser({
          id: pluginUserId,
          name,
          avatar: avatar?.url,
          email: userEmail,
        });
      }
      userId = pluginUserId;
    }

    // Create or update plugin
    const pluginData = {
      name,
      description,
      detailDesc,
      positions: JSON.stringify(positions),
      helpUrl,
      url,
      logo: logo.url,
      status: PluginStatus.Published,
      i18n: JSON.stringify(i18n),
      secret: hashedSecret,
      maskedSecret,
      pluginUser: userId || pluginUserId,
      createdBy: 'system',
    };

    const exists = await this.prismaService.txClient().plugin.count({ where: { id: pluginId } });

    if (exists > 0) {
      await this.prismaService.txClient().plugin.update({
        where: { id: pluginId },
        data: pluginData,
      });
    } else {
      await this.prismaService.txClient().plugin.create({
        data: { id: pluginId, ...pluginData },
      });
    }
  }
}
