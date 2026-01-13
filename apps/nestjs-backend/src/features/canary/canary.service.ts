import { Injectable } from '@nestjs/common';
import type { ICanaryConfig } from '@teable/openapi';
import { SettingKey } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { SettingService } from '../setting/setting.service';

@Injectable()
export class CanaryService {
  constructor(
    private readonly settingService: SettingService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  /**
   * Get the canary configuration
   */
  async getCanaryConfig(): Promise<ICanaryConfig | null> {
    const setting = await this.settingService.getSetting([SettingKey.CANARY_CONFIG]);
    return (setting.canaryConfig as ICanaryConfig) ?? null;
  }

  /**
   * Check if canary feature is enabled globally (via environment variable)
   */
  isCanaryFeatureEnabled(): boolean {
    return process.env.ENABLE_CANARY_FEATURE === 'true';
  }

  /**
   * Check if canary is forced via request header (x-canary: true/false)
   * Returns: true = force enable, false = force disable, undefined = no override
   */
  getHeaderCanaryOverride(): boolean | undefined {
    const canaryHeader = this.cls.get('canaryHeader');
    if (canaryHeader === 'true') return true;
    if (canaryHeader === 'false') return false;
    return undefined;
  }

  /**
   * Check if a space is in canary release
   * Priority:
   * 1. If canary feature is disabled globally, return false
   * 2. If x-canary header is set, use header value (true/false)
   * 3. Otherwise, check space against configured spaceIds
   *
   * @param spaceId - The space ID to check (caller should provide this from their context)
   */
  async isSpaceInCanary(spaceId: string): Promise<boolean> {
    // Check if canary feature is enabled globally
    if (!this.isCanaryFeatureEnabled()) {
      return false;
    }

    // Check header override first
    const headerOverride = this.getHeaderCanaryOverride();
    if (headerOverride !== undefined) {
      return headerOverride;
    }

    const config = await this.getCanaryConfig();

    // Check if canary is enabled in settings
    if (!config?.enabled) {
      return false;
    }

    // Check if space is in the canary list
    return config.spaceIds?.includes(spaceId) ?? false;
  }
}
