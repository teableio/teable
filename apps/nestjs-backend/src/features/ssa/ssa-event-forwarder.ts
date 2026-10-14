/* eslint-disable @typescript-eslint/naming-convention */
import { createHash, createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { SsaConfig, ISsaConfig } from '../../configs/ssa.config';
import { safeFetch } from '../../utils/ssrf-http';

export const SSA_EVENT_VERSION = 1;
/** Records sampled into a single forwarded event (bulk operations are trimmed). */
export const SSA_MAX_SAMPLE_RECORDS = 25;
/** Cell contexts sampled for updates. */
export const SSA_MAX_CELL_CONTEXTS = 50;
/** Hard cap for the signed body; oversize payloads are rebuilt id-only. */
export const SSA_MAX_BODY_BYTES = 256 * 1024;
/** Identical bodies within this window are treated as duplicate emissions. */
export const SSA_DEDUPE_WINDOW_MS = 10_000;

export interface ISsaSampleRecord {
  id: string;
  fields: Record<string, unknown>;
}

export interface ISsaRecordEvent {
  version: number;
  /** Canonical, service-agnostic: record.created | record.updated | record.deleted */
  event: string;
  tableId: string;
  baseId?: string;
  recordIds: string[];
  recordCount: number;
  isBulk: boolean;
  truncated: boolean;
  user?: { id: string; name?: string; email?: string };
  timestamp: string;
  /** Field data samples (create: full fields; delete: last known fields). */
  records?: ISsaSampleRecord[];
  /** Update-only: touched field ids + bounded raw change samples. */
  changes?: { fieldIds: string[]; cellContexts?: unknown[] };
  /** V2-only: event source (user|form|import|...). */
  source?: string;
}

/** `sha256=<hex>` HMAC of the exact request body. */
export const signSsaPayload = (secret: string, body: string): string =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

/**
 * Forwards committed record operations to the SSA notify service as
 * HMAC-signed webhooks.
 *
 * Design rules: fire-and-forget, never blocks or fails the request path,
 * bounded body size and timeout, exact-duplicate suppression within a short
 * window (v1 and v2 paths can both observe the same operation), and completely
 * disabled when the webhook URL/secret are unset.
 */
@Injectable()
export class SsaEventForwarder {
  private readonly logger = new Logger(SsaEventForwarder.name);
  private readonly baseIdCache = new Map<string, string | undefined>();
  private readonly recentBodies = new Map<string, number>();

  constructor(
    @SsaConfig() private readonly ssaConfig: ISsaConfig,
    private readonly prismaService: PrismaService
  ) {}

  async forward(event: ISsaRecordEvent): Promise<void> {
    const { events } = this.ssaConfig;
    if (!events.webhookUrl || !events.webhookSecret || !event.tableId) {
      return;
    }
    if (events.tables.length && !events.tables.includes(event.tableId)) {
      return;
    }

    try {
      event.baseId = await this.getBaseId(event.tableId);
      let body = JSON.stringify(event);

      if (Buffer.byteLength(body) > SSA_MAX_BODY_BYTES) {
        event.records = undefined;
        event.changes = event.changes ? { fieldIds: event.changes.fieldIds } : undefined;
        body = JSON.stringify(event);
      }

      const dedupeKey = this.dedupeKey(event);
      if (this.isDuplicate(dedupeKey)) {
        return;
      }
      this.rememberBody(dedupeKey);

      await this.post(body, event.event, events.timeoutMs);
    } catch (error) {
      // Fire-and-forget: records are already committed; forwarding failures
      // must never surface to the caller.
      this.logger.warn(
        `SSA event forwarding failed for ${event.event} (${event.tableId}): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Operation-based dedupe: v1 and v2 observe the same create/delete with
   * slightly different payloads, so identity comes from the operation, not the
   * body. Updates include the changed values digest so rapid successive edits
   * to the same record survive.
   */
  private dedupeKey(event: ISsaRecordEvent): string {
    const base = `${event.event}|${event.tableId}|${[...event.recordIds].sort().join(',')}`;
    if (event.event !== 'record.updated') {
      return base;
    }
    const changes = JSON.stringify(event.changes?.cellContexts ?? []);
    return `${base}|${event.changes?.fieldIds?.join(',') ?? ''}|${createHash('sha1')
      .update(changes)
      .digest('hex')}`;
  }

  private isDuplicate(fingerprint: string): boolean {
    const seenAt = this.recentBodies.get(fingerprint);
    return seenAt != null && Date.now() - seenAt < SSA_DEDUPE_WINDOW_MS;
  }

  private rememberBody(fingerprint: string): void {
    const now = Date.now();
    this.recentBodies.set(fingerprint, now);
    if (this.recentBodies.size > 500) {
      for (const [key, seenAt] of this.recentBodies) {
        if (now - seenAt > SSA_DEDUPE_WINDOW_MS) {
          this.recentBodies.delete(key);
        }
      }
    }
  }

  private async post(body: string, eventName: string, timeoutMs: number): Promise<void> {
    const { webhookUrl, webhookSecret } = this.ssaConfig.events;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // The webhook URL is operator-configured (self-hosted companion service),
      // hence `allowPrivateNetwork`; cloud-metadata addresses stay blocked.
      const response = await safeFetch(
        webhookUrl,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-ssa-event': eventName,
            'x-ssa-signature': signSsaPayload(webhookSecret, body),
            'x-ssa-timestamp': new Date().toISOString(),
          },
          body,
          signal: controller.signal,
        },
        { allowPrivateNetwork: true }
      );
      if (!response.ok) {
        this.logger.warn(`SSA event forwarding rejected by ${webhookUrl}: HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private async getBaseId(tableId: string): Promise<string | undefined> {
    if (this.baseIdCache.has(tableId)) {
      return this.baseIdCache.get(tableId);
    }
    let baseId: string | undefined;
    try {
      const table = await this.prismaService.txClient().tableMeta.findUnique({
        where: { id: tableId },
        select: { baseId: true },
      });
      baseId = table?.baseId;
    } catch (error) {
      this.logger.debug(
        `SSA baseId lookup failed for table ${tableId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    this.baseIdCache.set(tableId, baseId);
    return baseId;
  }
}
