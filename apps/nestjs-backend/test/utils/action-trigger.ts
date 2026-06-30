import { getActionTriggerChannel } from '@teable/core';
import type { Connection } from 'sharedb/lib/client';
import type { ShareDbService } from '../../src/share-db/share-db.service';

export interface IActionTrigger {
  actionKey: string;
  payload?: Record<string, unknown>;
}

const createConnection = (
  shareDbService: ShareDbService,
  cookie: string,
  port: string
): Connection => {
  return shareDbService.connect(undefined, {
    url: `ws://localhost:${port}/socket`,
    headers: { cookie },
  });
};

/**
 * Subscribe to a table's action-trigger presence channel, run `act`, and
 * resolve with every action received until the `until` predicate matches or
 * the channel stays idle for `idleMs` after `act` completed.
 */
export const collectActionTriggers = async (params: {
  shareDbService: ShareDbService;
  cookie: string;
  port: string;
  tableId: string;
  act: () => Promise<unknown>;
  idleMs?: number;
  timeoutMs?: number;
  until?: (actions: ReadonlyArray<IActionTrigger>) => boolean;
}): Promise<IActionTrigger[]> => {
  const {
    shareDbService,
    cookie,
    port,
    tableId,
    act,
    idleMs = 300,
    timeoutMs = 5000,
    until,
  } = params;

  return new Promise<IActionTrigger[]>((resolve, reject) => {
    const connection = createConnection(shareDbService, cookie, port);
    const presence = connection.getPresence(getActionTriggerChannel(tableId));
    const received: IActionTrigger[] = [];
    let capture = false;
    let settled = false;
    let actCompleted = false;
    let idleTimer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      clearTimeout(timeout);
      if (idleTimer) clearTimeout(idleTimer);
      presence.removeListener('receive', onReceive);
      try {
        presence.unsubscribe();
        presence.destroy();
      } catch {
        void 0;
      }
      connection.close();
    };

    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      resolve(received);
    };

    const onReceive = (_id: string, batch: IActionTrigger[]) => {
      if (!capture) {
        return;
      }
      received.push(...batch);
      if (until?.(received)) {
        finish();
        return;
      }
      if (!actCompleted) {
        return;
      }
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish(), idleMs);
    };

    const timeout = setTimeout(() => {
      finish(new Error('Action trigger timeout'));
    }, timeoutMs);

    presence.subscribe(async (error: unknown) => {
      if (error) {
        finish(error);
        return;
      }

      presence.on('receive', onReceive);

      try {
        capture = true;
        await act();
        actCompleted = true;
        if (until?.(received)) {
          finish();
          return;
        }
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => finish(), idleMs);
      } catch (actError) {
        finish(actError);
      }
    });
  });
};
