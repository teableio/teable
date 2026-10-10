import { randomUUID } from 'node:crypto';
import { NoopLogger, type DomainError, type ILogger } from '@teable/v2-core';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import type ShareDbClass from 'sharedb';
import type { Connection } from 'sharedb/lib/client';
import type { LocalPresence, Presence } from 'sharedb/lib/sharedb';

import type { IShareDbPresencePublisher } from './ShareDbPresencePublisher';

/** Channels cached per backend connection before the connection is recycled. */
const DEFAULT_MAX_CACHED_CHANNELS = 2048;
/** Best-effort signal: a stalled ShareDB round trip must not stall after-commit work. */
const DEFAULT_PUBLISH_TIMEOUT_MS = 2_000;

export interface ShareDbPresencePublisherOptions {
  maxCachedChannels?: number;
  publishTimeoutMs?: number;
}

type CachedPresence = {
  presence: Presence<unknown>;
  local: LocalPresence<unknown>;
};

/**
 * Publishes presence messages through the ShareDB backend, which broadcasts
 * them to every subscriber of the channel. One connection is reused and each
 * channel keeps one local presence whose version advances per signal.
 *
 * The presence id is unique per publisher incarnation: two publishers sharing a
 * version sequence would make subscribers drop the lower one.
 */
export class ShareDbBackendPresencePublisher implements IShareDbPresencePublisher {
  private connection?: Connection;
  private readonly presences = new Map<string, CachedPresence>();
  private instanceId = randomUUID();
  private readonly maxCachedChannels: number;
  private readonly publishTimeoutMs: number;
  private readonly logger: ILogger;

  constructor(
    private readonly backend: ShareDbClass,
    logger?: ILogger,
    options: ShareDbPresencePublisherOptions = {}
  ) {
    this.logger = (logger ?? new NoopLogger()).scope('realtime', { transport: 'sharedb-presence' });
    this.maxCachedChannels = options.maxCachedChannels ?? DEFAULT_MAX_CACHED_CHANNELS;
    this.publishTimeoutMs = options.publishTimeoutMs ?? DEFAULT_PUBLISH_TIMEOUT_MS;
  }

  async publish(channel: string, data: unknown): Promise<Result<void, DomainError>> {
    const { local } = this.presenceFor(channel);

    // Executor form: `Promise.withResolvers` is outside the lib target the EE
    // typecheck compiles this package with.
    return new Promise<Result<void, DomainError>>((resolve) => {
      let settled = false;
      const settle = (result: Result<void, DomainError>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
        this.logger.warn('presence signal timed out', { channel });
        settle(ok(undefined));
      }, this.publishTimeoutMs);

      local.submit(data, (error) => {
        if (error) {
          // Best effort: subscribers still refetch on their poll interval.
          this.logger.warn('presence signal failed', { channel, error: error.message });
        }
        settle(ok(undefined));
      });
    });
  }

  /** Releases the backend connection and its local presences. */
  dispose(): void {
    this.recycleConnection();
  }

  private presenceFor(channel: string): CachedPresence {
    const cached = this.presences.get(channel);
    if (cached) {
      return cached;
    }

    if (this.presences.size >= this.maxCachedChannels) {
      // ShareDB's backend keeps per-agent presence state for every channel id
      // and releases it only when the agent connection closes, so evicting a
      // single presence would still leak. Recycle the whole connection.
      this.recycleConnection();
    }

    const connection = (this.connection ??= this.backend.connect());
    const presence = connection.getPresence(channel);
    const entry: CachedPresence = {
      presence,
      local: presence.create(`${channel}#${this.instanceId}`),
    };
    this.presences.set(channel, entry);
    return entry;
  }

  private recycleConnection(): void {
    this.connection?.close();
    this.connection = undefined;
    this.presences.clear();
    // A fresh id per incarnation: subscribers keep the previous incarnation's
    // presence version, and a reused id would make them drop the lower one.
    this.instanceId = randomUUID();
  }
}
