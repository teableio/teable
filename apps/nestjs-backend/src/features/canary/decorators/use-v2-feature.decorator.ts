/* eslint-disable @typescript-eslint/naming-convention */
import { applyDecorators, SetMetadata } from '@nestjs/common';
import type { V2Feature } from '@teable/openapi';

export const USE_V2_FEATURE_KEY = 'useV2Feature';
export const ALWAYS_USE_V2_KEY = 'alwaysUseV2';

/**
 * Decorator to mark a controller method as supporting V2 implementation.
 * Used with V2FeatureGuard to determine if V2 should be used based on canary config.
 *
 * @param feature - The V2 feature name (e.g., 'createRecord', 'updateRecord')
 * @param options.always - Native-only routes bypass rollout decisions and still
 * populate request/CLS V2 attribution so interactive database cancellation works.
 * Such routes must also use V2FeatureGuard; they must not implement a V1 fallback.
 *
 * @example
 * ```typescript
 * @UseV2Feature('createRecord')
 * @Post()
 * async createRecords(...) {}
 * ```
 */
export const UseV2Feature = (feature: V2Feature, options?: { always?: boolean }) =>
  applyDecorators(
    SetMetadata(USE_V2_FEATURE_KEY, feature),
    SetMetadata(ALWAYS_USE_V2_KEY, options?.always ?? false)
  );
