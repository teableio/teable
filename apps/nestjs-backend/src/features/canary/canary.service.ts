import { Injectable } from '@nestjs/common';
import type { ICanaryConfig, V2Feature } from '@teable/openapi';
import { SettingKey } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore, V2Reason } from '../../types/cls';
import { SettingService } from '../setting/setting.service';

export interface IV2Decision {
  useV2: boolean;
  reason: V2Reason;
}

export interface IBaseV2DecisionContext {
  spaceId?: string | null;
  v2Enabled?: boolean | null;
}

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
   * Check if V2 is forced globally via environment variable (FORCE_V2_ALL=true)
   * This is the fallback priority for bases that are not explicitly marked as new-base V2.
   */
  isForceV2AllEnabled(): boolean {
    return process.env.FORCE_V2_ALL === 'true';
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

  /**
   * Determine if V2 implementation should be used for a specific feature
   * Priority:
   * 1. FORCE_V2_ALL env var (highest priority for space-only checks)
   * 2. If canary feature is disabled globally, return false
   * 3. forceV2All in config (database setting)
   * 4. x-canary header override
   * 5. Space in canary list (all V2 features enabled for canary spaces)
   *
   * @param spaceId - The space ID to check
   * @param feature - The V2 feature name (e.g., 'createRecord', 'updateRecord')
   */
  async shouldUseV2(spaceId: string, _feature: V2Feature): Promise<boolean> {
    // Priority 1: Environment variable FORCE_V2_ALL (highest priority)
    if (this.isForceV2AllEnabled()) {
      return true;
    }

    // Check if canary feature is enabled globally
    if (!this.isCanaryFeatureEnabled()) {
      return false;
    }

    const config = await this.getCanaryConfig();

    // Priority 2: forceV2All in config (database)
    if (config?.forceV2All) {
      return true;
    }

    // Priority 3: Header override
    const headerOverride = this.getHeaderCanaryOverride();
    if (headerOverride !== undefined) {
      return headerOverride;
    }

    // Priority 4: Space in canary list (all V2 features enabled for canary spaces)
    if (!config?.enabled) {
      return false;
    }

    return config.spaceIds?.includes(spaceId) ?? false;
  }

  /**
   * New bases are V2-first regardless of canary, request headers, or rollout config.
   * Unsupported features still do not call this path because they have no @UseV2Feature marker.
   */
  async shouldUseV2ForBaseWithReason(
    base: IBaseV2DecisionContext | null | undefined,
    feature: V2Feature
  ): Promise<IV2Decision> {
    if (base?.v2Enabled) {
      return { useV2: true, reason: 'new_base' };
    }

    return base?.spaceId
      ? this.shouldUseV2WithReason(base.spaceId, feature)
      : this.shouldUseV2WithReason('', feature);
  }

  /**
   * Determine if V2 implementation should be used for a specific feature,
   * with detailed reason information.
   *
   * Priority:
   * 1. FORCE_V2_ALL env var (highest priority for space-only checks)
   * 2. If canary feature is disabled globally, return false
   * 3. forceV2All in config (database setting)
   * 4. x-canary header override
   * 5. Space in canary list (all V2 features enabled for canary spaces)
   *
   * @param spaceId - The space ID to check
   * @param feature - The V2 feature name (e.g., 'createRecord', 'updateRecord')
   */
  async shouldUseV2WithReason(spaceId: string, _feature: V2Feature): Promise<IV2Decision> {
    // Priority 1: Environment variable FORCE_V2_ALL (highest priority)
    if (this.isForceV2AllEnabled()) {
      return { useV2: true, reason: 'env_force_v2_all' };
    }

    // Check if canary feature is enabled globally
    if (!this.isCanaryFeatureEnabled()) {
      return { useV2: false, reason: 'disabled' };
    }

    const config = await this.getCanaryConfig();

    // Priority 2: forceV2All in config (database)
    if (config?.forceV2All) {
      return { useV2: true, reason: 'config_force_v2_all' };
    }

    // Priority 3: Header override
    const headerOverride = this.getHeaderCanaryOverride();
    if (headerOverride !== undefined) {
      return { useV2: headerOverride, reason: 'header_override' };
    }

    // Priority 4: Space in canary list (all V2 features enabled for canary spaces)
    if (!config?.enabled) {
      return { useV2: false, reason: 'disabled' };
    }

    const inCanarySpace = config.spaceIds?.includes(spaceId) ?? false;

    if (inCanarySpace) {
      return { useV2: true, reason: 'space_feature' };
    }

    return { useV2: false, reason: 'feature_not_enabled' };
  }
}
