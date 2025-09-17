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

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { SettingKey, type ISettingVo } from '@teable/openapi';
import { isArray } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { getPublicFullStorageUrl } from '../attachments/plugins/utils';
import { SettingModel } from '../model/setting';

@Injectable()
export class SettingService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly settingModel: SettingModel
  ) {}

  async getSetting(names?: string[]): Promise<ISettingVo> {
    const settings = await this.settingModel.getSetting();
    const res: Record<string, unknown> = {
      instanceId: '',
    };
    if (!isArray(settings)) {
      return res as ISettingVo;
    }

    const nameSet = names ? new Set(names) : new Set(settings.map((setting) => setting.name));
    for (const setting of settings) {
      if (!nameSet.has(setting.name)) {
        continue;
      }
      const value = this.parseSettingContent(setting.content);
      if (setting.name === SettingKey.BRAND_LOGO) {
        res[setting.name] = value ? getPublicFullStorageUrl(value as string) : value;
      } else {
        res[setting.name] = value;
      }

      if (setting.name === SettingKey.INSTANCE_ID) {
        res.createdTime = setting.createdTime;
      }
    }

    return res as ISettingVo;
  }

  async updateSetting(updateSettingRo: Partial<ISettingVo>): Promise<ISettingVo> {
    const userId = this.cls.get('user.id');
    const updates = Object.entries(updateSettingRo).map(([name, value]) => ({
      where: { name },
      update: { content: JSON.stringify(value ?? null), lastModifiedBy: userId },
      create: {
        name,
        content: JSON.stringify(value ?? null),
        createdBy: userId,
      },
    }));

    const results = await Promise.all(
      updates.map((update) => this.prismaService.txClient().setting.upsert(update))
    );

    const res: Record<string, unknown> = {};
    for (const setting of results) {
      const value = this.parseSettingContent(setting.content);
      res[setting.name] = value;
    }

    return res as ISettingVo;
  }

  private parseSettingContent(content: string | null): unknown {
    if (!content) return null;

    try {
      return JSON.parse(content);
    } catch (error) {
      // If parsing fails, return the original content
      return content;
    }
  }
}
