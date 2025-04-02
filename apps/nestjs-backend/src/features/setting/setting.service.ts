/**
 * IMPORTANT LEGAL NOTICE:
 *
 * This file is part of Teable, licensed under the GNU Affero General Public License (AGPL).
 *
 * While Teable is open source software, the brand assets (including but not limited to
 * the Teable name, logo, and brand identity) are protected intellectual property.
 * Modification, replacement, or removal of these brand assets is strictly prohibited
 * and constitutes a violation of our trademark rights and the terms of the AGPL license.
 *
 * Under Section 7(e) of AGPLv3, we explicitly reserve all rights to the
 * Teable brand assets. Any unauthorized modification, redistribution, or use
 * of these assets, including creating derivative works that remove or replace
 * the brand assets, may result in legal action.
 */

import { join } from 'path';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { UploadType, type ISettingVo, type IUpdateSettingRo } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { BaseConfig, IBaseConfig } from '../../configs/base.config';
import type { IClsStore } from '../../types/cls';
import StorageAdapter from '../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../attachments/plugins/storage';
import { getFullStorageUrl } from '../attachments/plugins/utils';

@Injectable()
export class SettingService {
  constructor(
    private readonly prismaService: PrismaService,
    @BaseConfig() private readonly baseConfig: IBaseConfig,
    @InjectStorageAdapter() readonly storageAdapter: StorageAdapter,
    private readonly cls: ClsService<IClsStore>
  ) {}

  async getSetting(): Promise<ISettingVo> {
    return await this.prismaService.setting
      .findFirstOrThrow({
        select: {
          instanceId: true,
          disallowSignUp: true,
          disallowSpaceCreation: true,
          disallowSpaceInvitation: true,
          enableEmailVerification: true,
          aiConfig: true,
          brandName: true,
          brandLogo: true,
        },
      })
      .then((setting) => ({
        ...setting,
        aiConfig: setting.aiConfig ? JSON.parse(setting.aiConfig as string) : null,
        brandLogo: setting.brandLogo
          ? getFullStorageUrl(StorageAdapter.getBucket(UploadType.Logo), setting.brandLogo)
          : null,
      }))
      .catch(() => {
        throw new NotFoundException('Setting not found');
      });
  }

  async getServerBrand(): Promise<{ brandName: string; brandLogo: string }> {
    return {
      brandName: 'Teable',
      brandLogo: `${this.baseConfig.publicOrigin}/images/favicon/apple-touch-icon.png`,
    };
  }

  async uploadLogo(file: Express.Multer.File) {
    const token = 'brand';
    const path = join(StorageAdapter.getDir(UploadType.Logo), 'brand');
    const bucket = StorageAdapter.getBucket(UploadType.Logo);
    const { hash } = await this.storageAdapter.uploadFileWidthPath(bucket, path, file.path, {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'Content-Type': file.mimetype,
    });
    const { size, mimetype } = file;
    const setting = await this.getSetting();

    await this.prismaService.txClient().attachments.upsert({
      create: {
        hash,
        size,
        mimetype,
        token,
        path,
        createdBy: this.cls.get('user.id'),
      },
      update: {
        hash,
        size,
        mimetype,
        path,
      },
      where: {
        token,
        deletedTime: null,
      },
    });

    await this.prismaService.setting.update({
      where: { instanceId: setting.instanceId },
      data: {
        brandLogo: path,
      },
    });

    return {
      url: getFullStorageUrl(StorageAdapter.getBucket(UploadType.Logo), path),
    };
  }

  async updateSetting(updateSettingRo: IUpdateSettingRo) {
    const setting = await this.getSetting();

    const data: object = updateSettingRo;
    if ('aiConfig' in data) {
      // if statement to prevent "aiConfig" removal in case that field is not provided
      data['aiConfig'] = updateSettingRo.aiConfig ? JSON.stringify(updateSettingRo.aiConfig) : null;
    }

    return await this.prismaService.setting.update({
      where: { instanceId: setting.instanceId },
      data,
    });
  }
}
