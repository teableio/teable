/* eslint-disable @typescript-eslint/naming-convention */
import { SetMetadata } from '@nestjs/common';
import type { V2Feature } from '@teable/openapi';

export const USE_V2_FEATURE_KEY = 'useV2Feature';

/**
 * Decorator to mark a controller method as supporting V2 implementation.
 * Used with V2FeatureGuard to determine if V2 should be used based on canary config.
 *
 * @param feature - The V2 feature name (e.g., 'createRecord', 'updateRecord')
 *
 * @example
 * ```typescript
 * @UseV2Feature('createRecord')
 * @Post()
 * async createRecords(...) {}
 * ```
 */
export const UseV2Feature = (feature: V2Feature) => SetMetadata(USE_V2_FEATURE_KEY, feature);
