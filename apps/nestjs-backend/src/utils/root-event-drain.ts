import type { Server } from 'node:http';
import { Logger } from '@nestjs/common';
import type { DiscoveryService } from '@nestjs/core';
import type { ComputedReliabilityReconciliationService } from '../features/v2/computed-outbox-trigger/computed-reliability-reconciliation.service';
import type { V2ContainerService } from '../features/v2/v2-container.service';
import { forceCloseQueueWorkers, pauseQueueWorkers } from './queue-processor';

type EventDrainer = Pick<V2ContainerService, 'drainEvents'>;
const rootDrains = new WeakMap<EventDrainer, Promise<void>>();

function closeHttpServer(server: Server | undefined): Promise<void> {
  // The backend's ES2022 library target does not declare Promise.withResolvers.
  return new Promise<void>((resolve, reject) => {
    if (!server) return resolve();
    // Node waits for accepted HTTP work; Nest can safely close this server again later.
    server.close((error?: NodeJS.ErrnoException) => {
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
      else resolve();
    });
  });
}

/** Run from the actual root module, before imported/global dependencies are destroyed. */
export function drainRootEvents(
  container: EventDrainer,
  server: Server | undefined,
  discovery: DiscoveryService,
  reconciliation: Pick<ComputedReliabilityReconciliationService, 'stop'>
): Promise<void> {
  const existing = rootDrains.get(container);
  if (existing) return existing;

  // Defer producer creation until the memo is installed: EE also destroys the CE root module.
  const drain = Promise.resolve().then(async () => {
    let drained = false;
    try {
      drained = await container.drainEvents([
        closeHttpServer(server),
        ...pauseQueueWorkers(discovery),
        Promise.resolve().then(() => reconciliation.stop()),
      ]);
    } catch (error) {
      new Logger('RootEventDrain').error('Event drain failed', error);
    }
    if (!drained) {
      const logger = new Logger('RootEventDrain');
      logger.error(
        'Event drain did not finish; force closing queue workers before dependency teardown'
      );
      const closed = await Promise.allSettled(forceCloseQueueWorkers(discovery));
      for (const result of closed) {
        if (result.status === 'rejected')
          logger.error('Force closing queue worker failed', result.reason);
      }
    }
  });
  rootDrains.set(container, drain);
  return drain;
}
