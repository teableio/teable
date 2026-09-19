import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { IPgPoolLease } from '@teable/db-main-prisma';
import { PgPoolRegistry } from '@teable/db-main-prisma';
import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import {
  DomainEventOutboxWorker,
  v2RecordRepositoryPostgresTokens,
} from '@teable/v2-adapter-table-repository-postgres';
import { ProjectionMessageCodecRegistry } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { PinoLogger } from 'nestjs-pino';

import { CacheService } from '../../../cache/cache.service';
import {
  DataDbClientManager,
  type IComputedOutboxMaintenanceTarget,
} from '../../../global/data-db-client-manager.service';
import { V2ContainerService } from '../v2-container.service';
import { PinoLoggerAdapter } from '../v2-logger.adapter';

const RELAY_INTERVAL_MS = 5_000;
const MAINTENANCE_INTERVAL_MS = 60_000;

@Injectable()
export class DomainEventOutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DomainEventOutboxRelayService.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private maintenanceTimer: ReturnType<typeof setInterval> | undefined;
  private polling = false;
  private maintaining = false;
  private readonly maintenanceCodecs = ProjectionMessageCodecRegistry.create([])._unsafeUnwrap();
  private readonly maintenanceLogger: PinoLoggerAdapter;

  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly dataDbClientManager: DataDbClientManager,
    private readonly cache: CacheService,
    private readonly pgPoolRegistry: PgPoolRegistry,
    pinoLogger: PinoLogger
  ) {
    this.maintenanceLogger = new PinoLoggerAdapter(pinoLogger);
  }

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.pollAllContainers();
    }, RELAY_INTERVAL_MS);
    this.timer.unref?.();
    this.maintenanceTimer = setInterval(() => {
      void this.maintainAllContainers();
    }, MAINTENANCE_INTERVAL_MS);
    this.maintenanceTimer.unref?.();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    clearInterval(this.maintenanceTimer);
  }

  private async pollAllContainers(): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      const targets = await this.dataDbClientManager.listComputedOutboxMaintenanceTargets();
      for (const target of targets) {
        await this.pollTarget(target);
      }
    } catch (error) {
      this.logger.warn('domain_event:relay_list_failed', {
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
    } finally {
      this.polling = false;
    }
  }

  private async pollTarget(target: IComputedOutboxMaintenanceTarget): Promise<void> {
    try {
      const hasWork = await this.dataDbClientManager.peekDueDomainEventWork(target);
      if (!hasWork) {
        return;
      }
      const container = await this.v2ContainerService.getContainerForMaintenanceTarget(target);
      const worker = container.resolve<DomainEventOutboxWorker>(
        v2RecordRepositoryPostgresTokens.domainEventOutboxWorker
      );
      const result = await worker.pollOnce();
      if (result.isErr()) {
        this.logger.warn('domain_event:relay_poll_failed', {
          cacheKey: target.cacheKey,
          errorCode: result.error.code,
        });
      }
    } catch (error) {
      this.logger.warn('domain_event:relay_failed', {
        cacheKey: target.cacheKey,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  private async maintainAllContainers(): Promise<void> {
    if (this.maintaining) {
      return;
    }
    this.maintaining = true;
    try {
      const targets = await this.dataDbClientManager.listComputedOutboxMaintenanceTargets();
      for (const target of targets) {
        await this.maintainTarget(target);
      }
    } catch (error) {
      this.logger.warn('domain_event:maintenance_list_failed', {
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
    } finally {
      this.maintaining = false;
    }
  }

  private async maintainTarget(target: IComputedOutboxMaintenanceTarget): Promise<void> {
    let lease: IPgPoolLease | undefined;
    let db: Kysely<V1TeableDatabase> | undefined;
    try {
      // Retain the pacing key until expiry, including on failure and SQL lock contention.
      // Memory-cache pacing is process-local; the database lock still prevents overlap.
      const admitted = await this.cache.setnx(
        `lock:domain-event:maintenance:pace:${target.cacheKey}`,
        '1',
        60
      );
      if (!admitted) {
        return;
      }
      try {
        // Maintenance must not populate the runtime cache: eviction could destroy a
        // Kysely handle still in use by a delivery on another target.
        const connectionString = target.connectionUrl ?? target.url;
        lease = this.pgPoolRegistry.acquire(connectionString, {
          applicationName: 'teable-domain-event-maintenance',
          connectionTimeoutMillis: 5_000,
          max: 1,
          poolName: 'domain-event-maintenance',
        });
        db = await createV2PostgresDb<V1TeableDatabase>(
          { pg: { connectionString, schema: target.internalSchema } },
          { pool: lease.pool }
        );
        const worker = new DomainEventOutboxWorker(
          db,
          new Map(),
          this.maintenanceCodecs,
          this.maintenanceLogger,
          target.internalSchema
        );
        const result = await worker.maintainOnce();
        if (result.isErr()) {
          this.logger.warn('domain_event:maintenance_failed', {
            cacheKey: target.cacheKey,
            errorCode: result.error.code,
          });
        }
      } finally {
        // The injected pool is externally owned: destroy only this Kysely handle,
        // then let the registry close the pool after its final lease is released.
        try {
          await db?.destroy();
        } finally {
          await lease?.release();
        }
      }
    } catch (error) {
      this.logger.warn('domain_event:maintenance_failed', {
        cacheKey: target.cacheKey,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }
}
