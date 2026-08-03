import { Inject } from '@nestjs/common';
import { AGGREGATION_SERVICE_SYMBOL } from './aggregation.service.symbol';

/**
 * Decorator for injecting the aggregation service
 * Use this decorator instead of directly injecting the AggregationService class
 *
 * @example
 * ```typescript
 * constructor(
 *   @InjectAggregationService() private readonly aggregationService: IAggregationService
 * ) {}
 * ```
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const InjectAggregationService = () => Inject(AGGREGATION_SERVICE_SYMBOL);
