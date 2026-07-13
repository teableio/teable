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

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { SettingKey } from '@teable/openapi';
import type { ISettingVo } from '@teable/openapi';
import { isArray } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { PerformanceCacheService } from '../../performance-cache';
import type { IClsStore } from '../../types/cls';
import { getPublicFullStorageUrl } from '../attachments/plugins/utils';
import { SettingModel } from '../model/setting';

@Injectable()
export class SettingService {
  private readonly logger = new Logger(SettingService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly settingModel: SettingModel,
    private readonly performanceCacheService: PerformanceCacheService
  ) {}

  // eslint-disable-next-line sonarjs/cognitive-complexity
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
        res.createdTime =
          setting.createdTime instanceof Date
            ? setting.createdTime.toISOString()
            : setting.createdTime;
      }
    }

    // Apply environment variable overrides
    this.applyEnvOverrides(res);

    return res as ISettingVo;
  }

  /**
   * Apply environment variable overrides for settings
   * - TEST_AI_CONFIG: Completely overrides aiConfig (for testing)
   * - AI_GATEWAY_API_KEY: Fallback for aiConfig.aiGatewayApiKey if not set
   */
  private applyEnvOverrides(res: Record<string, unknown>): void {
    // TEST_AI_CONFIG completely overrides aiConfig (for testing)
    const testAiConfig = process.env.TEST_AI_CONFIG;
    if (testAiConfig) {
      try {
        res[SettingKey.AI_CONFIG] = JSON.parse(testAiConfig);
      } catch {
        this.logger.warn('Failed to parse TEST_AI_CONFIG environment variable');
      }
    }

    // AI_GATEWAY_API_KEY fallback for aiConfig.aiGatewayApiKey
    const envAiGatewayApiKey = process.env.AI_GATEWAY_API_KEY;
    if (envAiGatewayApiKey) {
      const aiConfig = res[SettingKey.AI_CONFIG] as Record<string, unknown> | undefined;
      if (!aiConfig?.aiGatewayApiKey) {
        res[SettingKey.AI_CONFIG] = {
          ...aiConfig,
          aiGatewayApiKey: envAiGatewayApiKey,
        };
      }
    }
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
