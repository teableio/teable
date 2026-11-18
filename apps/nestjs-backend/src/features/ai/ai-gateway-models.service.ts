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
// In-process copy on top of the cache: callers such as per-request AI billing read the
// list on every request, and each cache read re-parses the whole list.
const gatewayModelsMemoTtl = ms('10m');
// Past the memo TTL a list is still served while it refreshes in the background, but only
// for this long after its last successful load; after that callers wait for the refresh. A
// gateway price change therefore reaches a pod after at most cache TTL + memo TTL + grace
// (about 80 minutes), and pods may disagree for up to memo TTL + grace. If that refresh
// fails, the old list is still served: for billing a stale reference price beats none (no
// price is billed as 0 credits).
const gatewayModelsStaleGrace = ms('10m');
// While this instance's fetch is backing off, the cache is checked again after at most
// this long, so a list another instance has written to it is picked up quickly.
const gatewayModelsBackoffRecheck = ms('30s');

// Must match the key literal registered in IPerformanceCacheStore
export const AI_GATEWAY_MODELS_CACHE_KEY = 'ai-gateway:models' as const;

const EMPTY_MODELS: readonly IGatewayApiModel[] = Object.freeze([]);

/** Thrown by the fetcher while it is inside its backoff window. */
class GatewayModelsBackoffError extends Error {
  constructor() {
    super('AI Gateway fetch is backing off after earlier failures');
  }
}

type LoadResult = { ok: true; models: readonly IGatewayApiModel[] } | { ok: false };

/**
 * Live model list (pricing, context windows, tags) from the Vercel AI Gateway,
 * cached in Redis and briefly in process memory. Never rejects: returns [] so
 * callers fall back to built-in model data. The returned list and its models are
 * frozen, since every caller in this process shares them.
 */
@Injectable()
export class AiGatewayModelsService {
  private readonly logger = new Logger(AiGatewayModelsService.name);

  private fetchBackoffMs = 0;
  private nextFetchAt = 0;
  // freshUntil only moves on a successful load; recheckAt only during a fetch backoff.
  private memo?: { models: readonly IGatewayApiModel[]; freshUntil: number; recheckAt: number };
  private inflight?: Promise<LoadResult>;

  constructor(private readonly performanceCacheService: PerformanceCacheService) {}

  async getGatewayModels(): Promise<readonly IGatewayApiModel[]> {
    const now = Date.now();
    const memo = this.memo;
    if (memo && now < memo.freshUntil) {
      return memo.models;
    }
    // Backing off after a cache miss: serve what we have (an old list or the empty
    // fallback) until it is time to check the cache again.
    if (memo && now < memo.recheckAt) {
      return memo.models;
    }
    if (memo?.models.length && now < memo.freshUntil + gatewayModelsStaleGrace) {
      // Keep serving the last list while one background load refreshes it.
      void this.sharedLoad();
      return memo.models;
    }

    const joined = this.inflight !== undefined;
    let result = await this.sharedLoad();
    // A failed load is not handed to callers that only joined it: they retry once through
    // the same shared slot, so the retry and any calls arriving meanwhile share one load.
    if (!result.ok && joined) {
      result = await this.sharedLoad();
    }
    if (result.ok) {
      return result.models;
    }
    return this.memo?.models ?? EMPTY_MODELS;
  }

  private sharedLoad(): Promise<LoadResult> {
    this.inflight ??= this.load().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async load(): Promise<LoadResult> {
    try {
      const models = freezeModels(
        await this.performanceCacheService.wrap(
          AI_GATEWAY_MODELS_CACHE_KEY,
          () => this.fetchGatewayModels(),
          { ttl: gatewayModelsCacheTtlSeconds }
        )
      );
      this.memo = { models, freshUntil: Date.now() + gatewayModelsMemoTtl, recheckAt: 0 };
      return { ok: true, models };
    } catch (error) {
      if (!(error instanceof GatewayModelsBackoffError)) {
        // Cache or lock errors, or a fetch that just failed (logged in fetchGatewayModels):
        // nothing is cached, so the next call tries again.
        return { ok: false };
      }
      // The cache missed and this instance's fetch is backing off. Keep the list we have
      // (or the empty fallback) and only schedule the next cache check: freshness is left
      // alone, so the grace period still counts from the last successful load.
      const models = this.memo?.models ?? EMPTY_MODELS;
      this.memo = {
        models,
        freshUntil: this.memo?.freshUntil ?? 0,
        recheckAt: Math.min(this.nextFetchAt, Date.now() + gatewayModelsBackoffRecheck),
      };
      return { ok: true, models };
    }
  }

  // Only runs on cache miss
  private async fetchGatewayModels(): Promise<IGatewayApiModel[]> {
    const now = Date.now();
    if (now < this.nextFetchAt) {
      throw new GatewayModelsBackoffError();
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

function freezeModels(models: IGatewayApiModel[]): readonly IGatewayApiModel[] {
  for (const model of models) deepFreeze(model);
  return Object.freeze(models);
}

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
}
