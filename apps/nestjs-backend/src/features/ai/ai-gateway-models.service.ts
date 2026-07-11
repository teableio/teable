import { Injectable, Logger } from '@nestjs/common';
import { convertGatewayApiModel } from '@teable/openapi';
import type { IGatewayApiModel, IGatewayApiModelRaw } from '@teable/openapi';
import axios from 'axios';
import ms from 'ms';
import { PerformanceCacheService } from '../../performance-cache';

// wrap() takes seconds
const gatewayModelsCacheTtlSeconds = ms('1h') / 1000;
// Not shorter: a spurious timeout opens a backoff window of built-in data
const gatewayModelsFetchTimeout = ms('5s');
// Failed fetches back off exponentially, capped at one retry per hour
const gatewayModelsRetryBaseDelay = ms('1m');
const gatewayModelsRetryMaxDelay = ms('1h');

// Must match the key literal registered in IPerformanceCacheStore
export const AI_GATEWAY_MODELS_CACHE_KEY = 'ai-gateway:models' as const;

/**
 * Live model list (pricing, context windows, tags) from the Vercel AI Gateway,
 * cached in Redis. Never rejects: returns [] so callers fall back to built-in
 * model data.
 */
@Injectable()
export class AiGatewayModelsService {
  private readonly logger = new Logger(AiGatewayModelsService.name);

  private fetchBackoffMs = 0;
  private nextFetchAt = 0;

  constructor(private readonly performanceCacheService: PerformanceCacheService) {}

  async getGatewayModels(): Promise<IGatewayApiModel[]> {
    try {
      return await this.performanceCacheService.wrap(
        AI_GATEWAY_MODELS_CACHE_KEY,
        () => this.fetchGatewayModels(),
        { ttl: gatewayModelsCacheTtlSeconds }
      );
    } catch (error) {
      // Fetch failures are already logged in fetchGatewayModels
      return [];
    }
  }

  // Only runs on cache miss
  private async fetchGatewayModels(): Promise<IGatewayApiModel[]> {
    const now = Date.now();
    if (now < this.nextFetchAt) {
      throw new Error('AI Gateway fetch is backing off after earlier failures');
    }

    try {
      const response = await axios.get<{ data: IGatewayApiModelRaw[] }>(
        'https://ai-gateway.vercel.sh/v1/models',
        { timeout: gatewayModelsFetchTimeout }
      );
      const models = (response.data?.data || []).map(convertGatewayApiModel);
      this.fetchBackoffMs = 0;
      return models;
    } catch (error) {
      this.fetchBackoffMs = Math.min(
        Math.max(this.fetchBackoffMs * 2, gatewayModelsRetryBaseDelay),
        gatewayModelsRetryMaxDelay
      );
      this.nextFetchAt = now + this.fetchBackoffMs;
      this.logger.warn(
        `Failed to fetch live gateway models, falling back to built-in model data (next retry in ${
          this.fetchBackoffMs / 1000
        }s): ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }
}
