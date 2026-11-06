import {
  getActionTriggerChannel,
  getBaseNodeChannel,
  getBasePermissionUpdateChannel,
  getChatChannel,
  getCollaboratorsChannel,
  getTableButtonClickChannel,
  getTableImportChannel,
  getUserNotificationChannel,
  getWorkflowTestChannel,
} from '@teable/core';
import ShareDBClass from 'sharedb';
import type { Connection } from 'sharedb/lib/client';
import { describe, expect, it, vi } from 'vitest';
import { authMiddleware, type IAuthMiddlewareDeps } from './auth.middleware';

// --- fake backend data -------------------------------------------------------
// table -> base
const tableBase: Record<string, string> = {
  tblMine: 'bseMine',
  tblOther: 'bseOther',
  tblShared: 'bseShared',
  tblTpl: 'bseTpl',
};
// viewId -> table (for action_trigger keyed by a view id)
const viewTable: Record<string, string> = { viwShared: 'tblShared' };
// a view share: shareId -> the shared table (enableShare = true)
const viewShareTable: Record<string, string> = { shrView: 'tblShared' };
// a base share: shareId -> { baseId, enabled }
const baseShares: Record<string, { baseId: string; enabled: boolean }> = {
  shrBase: { baseId: 'bseShared', enabled: true },
};
// which bases each signed-in user can read
const userBaseAccess: Record<string, Set<string>> = { usrMe: new Set(['bseMine']) };

const createDeps = (): IAuthMiddlewareDeps => {
  // The session cookie names the user directly here.
  const sessionHandleService = {
    getSessionIdFromRequest: async (req: { headers: { cookie?: string } }) =>
      req.headers.cookie?.replace('session=', ''),
    getUserId: async (sessionId: string) => sessionId,
  };
  let currentUserId: string | undefined;
  const clsService = {
    runWith: (store: { user?: { id?: string } }, fn: () => unknown) => {
      currentUserId = store?.user?.id;
      return fn();
    },
    get: () => undefined,
  };
  const permissionService = {
    getPermissionByBaseId: vi.fn(async (baseId: string) => {
      if (currentUserId && userBaseAccess[currentUserId]?.has(baseId)) return ['base|read'];
      throw new Error('no permission');
    }),
  };
  const prismaService = {
    tableMeta: {
      findFirst: async ({ where: { id } }: { where: { id: string } }) =>
        tableBase[id] ? { baseId: tableBase[id] } : null,
    },
    view: {
      findFirst: async ({ where }: { where: { id?: string; shareId?: string } }) => {
        if (where.shareId) {
          const tableId = viewShareTable[where.shareId];
          return tableId ? { tableId } : null;
        }
        const tableId = where.id ? viewTable[where.id] : undefined;
        return tableId ? { tableId } : null;
      },
    },
    baseShare: {
      findUnique: async ({ where: { shareId } }: { where: { shareId: string } }) =>
        baseShares[shareId] ?? null,
    },
  };
  return {
    sessionHandleService: sessionHandleService as never,
    permissionService: permissionService as never,
    clsService: clsService as never,
    prismaService: prismaService as never,
  };
};

const createBackend = () => {
  const backend = new ShareDBClass({
    presence: true,
    doNotForwardSendPresenceErrorsToClient: true,
  });
  authMiddleware(backend, createDeps());
  return backend;
};

/**
 * A browser connection, signed in as `userId` and/or carrying a share id or a template preview
 * header (or anonymous).
 */
const connectBrowser = (
  backend: ShareDBClass,
  opts: { userId?: string; shareId?: string; baseShareId?: string; templateHeader?: string } = {}
): Connection => {
  const params = new URLSearchParams();
  if (opts.shareId) params.set('shareId', opts.shareId);
  if (opts.baseShareId) params.set('baseShareId', opts.baseShareId);
  if (opts.templateHeader) params.set('templateHeader', opts.templateHeader);
  const query = params.toString();
  const connection = backend.connect(undefined, {
    headers: { cookie: opts.userId ? `session=${opts.userId}` : undefined },
    url: query ? `/socket?${query}` : '/socket',
  }) as Connection & { agent: { stream: { isServer: boolean } } };
  // backend.connect() is the in-process transport; mark it remote like a WebSocket client.
  connection.agent.stream.isServer = false;
  return connection;
};

const subscribe = (connection: Connection, channel: string) => {
  const presence = connection.getPresence(channel);
  return new Promise<typeof presence>((resolve, reject) =>
    presence.subscribe((error) => (error ? reject(error) : resolve(presence)))
  );
};

const submit = (connection: Connection, channel: string, id: string, value: unknown) =>
  new Promise<void>((resolve, reject) =>
    connection
      .getPresence(channel)
      .create(id)
      .submit(value, (error) => (error ? reject(error) : resolve()))
  );

describe('notification presence is private to its user', () => {
  it('lets a user subscribe to their own notifications', async () => {
    const backend = createBackend();
    await expect(
      subscribe(connectBrowser(backend, { userId: 'usrMe' }), getUserNotificationChannel('usrMe'))
    ).resolves.toBeDefined();
  });

  it("refuses another user's notifications", async () => {
    const backend = createBackend();
    await expect(
      subscribe(
        connectBrowser(backend, { userId: 'usrMe' }),
        getUserNotificationChannel('usrOther')
      )
    ).rejects.toMatchObject({ message: expect.stringContaining('own user only') });
  });

  it('refuses anonymous connections', async () => {
    const backend = createBackend();
    await expect(
      subscribe(connectBrowser(backend), getUserNotificationChannel('usrMe'))
    ).rejects.toBeDefined();
  });

  it('refuses a browser publishing onto a notification channel, even its own', async () => {
    const backend = createBackend();
    const channel = getUserNotificationChannel('usrMe');
    await expect(
      submit(connectBrowser(backend, { userId: 'usrMe' }), channel, 'notFake', { message: 'fake' })
    ).rejects.toMatchObject({ message: expect.stringContaining('server only') });
  });

  it('delivers what the server publishes to the owner', async () => {
    const backend = createBackend();
    const channel = getUserNotificationChannel('usrMe');
    const mine = await subscribe(connectBrowser(backend, { userId: 'usrMe' }), channel);
    const received = new Promise((resolve) => mine.on('receive', (_id, value) => resolve(value)));

    await submit(backend.connect(), channel, 'notReal', { message: 'hello' });
    await expect(received).resolves.toEqual({ message: 'hello' });
  });
});

describe('non-notification presence requires read access to the channel resource', () => {
  it('rejects an anonymous connection subscribing to a table presence channel', async () => {
    const backend = createBackend();
    await expect(
      subscribe(connectBrowser(backend), getCollaboratorsChannel('tblMine'))
    ).rejects.toBeDefined();
  });

  it('rejects an anonymous connection publishing fake presence', async () => {
    const backend = createBackend();
    await expect(
      submit(connectBrowser(backend), getCollaboratorsChannel('tblMine'), 'me', { name: 'x' })
    ).rejects.toBeDefined();
  });

  it('lets a user with base access subscribe to that base’s table presence', async () => {
    const backend = createBackend();
    await expect(
      subscribe(connectBrowser(backend, { userId: 'usrMe' }), getCollaboratorsChannel('tblMine'))
    ).resolves.toBeDefined();
  });

  it('rejects a signed-in user subscribing to another tenant’s table presence', async () => {
    const backend = createBackend();
    await expect(
      subscribe(connectBrowser(backend, { userId: 'usrMe' }), getCollaboratorsChannel('tblOther'))
    ).rejects.toBeDefined();
  });

  it('rejects an unused channel even for a signed-in user', async () => {
    const backend = createBackend();
    await expect(
      subscribe(connectBrowser(backend, { userId: 'usrMe' }), getChatChannel('chtX'))
    ).rejects.toBeDefined();
  });
});

describe('presence on a deleted or nonexistent resource is allowed (nothing to protect)', () => {
  // Regression guard: when a table a collaborator had open is deleted out from under them, the
  // client still tears down presence for the now-gone table. That channel no longer resolves to a
  // base (tblGone is absent from the fixture, like a row with deletedTime set), so there is no data
  // to protect and denying it only makes the collaborator's page throw "Presence channel access
  // denied". A channel that points at live data always resolves and stays gated by the tests above.
  it('lets a signed-in collaborator subscribe to a deleted table’s presence channel', async () => {
    const backend = createBackend();
    await expect(
      subscribe(connectBrowser(backend, { userId: 'usrMe' }), getCollaboratorsChannel('tblGone'))
    ).resolves.toBeDefined();
  });

  it('lets a signed-in collaborator publish presence onto a deleted table’s channel', async () => {
    const backend = createBackend();
    await expect(
      submit(
        connectBrowser(backend, { userId: 'usrMe' }),
        getCollaboratorsChannel('tblGone'),
        'me',
        {
          name: 'x',
        }
      )
    ).resolves.toBeUndefined();
  });
});

describe('public-share presence is scoped to the share', () => {
  it('lets a base-share visitor use a base channel for the shared base', async () => {
    const backend = createBackend();
    await expect(
      subscribe(
        connectBrowser(backend, { baseShareId: 'shrBase' }),
        getBaseNodeChannel('bseShared')
      )
    ).resolves.toBeDefined();
  });

  // Every channel a base (or node) share page subscribes to; the table header's import spinner
  // included, since an allowEdit share lets a signed-in visitor import.
  it.each([
    getBasePermissionUpdateChannel('bseShared'),
    getBaseNodeChannel('bseShared'),
    getActionTriggerChannel('tblShared'),
    getActionTriggerChannel('viwShared'),
    getTableButtonClickChannel('tblShared'),
    getTableImportChannel('tblShared'),
  ])('lets a base-share visitor subscribe to %s', async (ch) => {
    const backend = createBackend();
    await expect(
      subscribe(connectBrowser(backend, { baseShareId: 'shrBase' }), ch)
    ).resolves.toBeDefined();
  });

  // Header avatars carry the name and email of every member viewing the table; share pages
  // never show them.
  it.each([{ baseShareId: 'shrBase' }, { shareId: 'shrView' }])(
    'refuses header-avatar presence to a share visitor (%o)',
    async (share) => {
      const backend = createBackend();
      await expect(
        subscribe(connectBrowser(backend, share), getCollaboratorsChannel('tblShared'))
      ).rejects.toBeDefined();
    }
  );

  it('rejects a base-share visitor reaching a base outside the share', async () => {
    const backend = createBackend();
    await expect(
      subscribe(connectBrowser(backend, { baseShareId: 'shrBase' }), getBaseNodeChannel('bseOther'))
    ).rejects.toBeDefined();
  });

  it('lets a view-share visitor use the shared table’s action-trigger channel', async () => {
    const backend = createBackend();
    await expect(
      subscribe(
        connectBrowser(backend, { shareId: 'shrView' }),
        getActionTriggerChannel('tblShared')
      )
    ).resolves.toBeDefined();
  });

  it('rejects a view-share visitor reaching a base-only channel', async () => {
    const backend = createBackend();
    await expect(
      subscribe(connectBrowser(backend, { shareId: 'shrView' }), getBaseNodeChannel('bseShared'))
    ).rejects.toBeDefined();
  });
});

describe('template preview connections get no presence', () => {
  // A template preview shows a frozen snapshot, so its page opens no presence channel
  // (usePresenceConnection). The template header authorizes document reads only: it must never
  // become a way onto a base's live channels.
  it.each([getBaseNodeChannel('bseTpl'), getActionTriggerChannel('tblTpl')])(
    'refuses %s to an anonymous template preview',
    async (ch) => {
      const backend = createBackend();
      await expect(
        subscribe(connectBrowser(backend, { templateHeader: 'tplHeader' }), ch)
      ).rejects.toMatchObject({ message: 'Presence channel access denied' });
    }
  );
});

describe('share-granted presence is listen-only', () => {
  // Share pages never publish presence; a publish from one would reach the members who have the
  // same table open.
  it.each([
    getActionTriggerChannel('tblShared'),
    getTableButtonClickChannel('tblShared'),
    getTableImportChannel('tblShared'),
    getBaseNodeChannel('bseShared'),
    getBasePermissionUpdateChannel('bseShared'),
  ])('refuses a base-share visitor publishing onto %s', async (ch) => {
    const backend = createBackend();
    await expect(
      submit(connectBrowser(backend, { baseShareId: 'shrBase' }), ch, 'fake', { x: 1 })
    ).rejects.toMatchObject({ message: expect.stringContaining('listen-only') });
  });

  it('refuses a view-share visitor publishing onto the shared table', async () => {
    const backend = createBackend();
    await expect(
      submit(
        connectBrowser(backend, { shareId: 'shrView' }),
        getActionTriggerChannel('tblShared'),
        'fake',
        [{ actionKey: 'deleteRecord' }]
      )
    ).rejects.toMatchObject({ message: expect.stringContaining('listen-only') });
  });

  it('still delivers what members publish to a subscribed share visitor', async () => {
    const backend = createBackend();
    const channel = getActionTriggerChannel('tblShared');
    const visitor = await subscribe(connectBrowser(backend, { baseShareId: 'shrBase' }), channel);
    const received = new Promise((resolve) =>
      visitor.on('receive', (_id, value) => resolve(value))
    );

    await submit(backend.connect(), channel, 'srv', [{ actionKey: 'setRecord' }]);
    await expect(received).resolves.toEqual([{ actionKey: 'setRecord' }]);
  });

  it('lets a base member publish presence on their own table', async () => {
    const backend = createBackend();
    await expect(
      submit(
        connectBrowser(backend, { userId: 'usrMe' }),
        getCollaboratorsChannel('tblMine'),
        'me',
        { name: 'me' }
      )
    ).resolves.toBeUndefined();
  });
});

describe('workflow-test presence requires a signed-in user', () => {
  it('rejects an anonymous connection', async () => {
    const backend = createBackend();
    await expect(
      subscribe(connectBrowser(backend), getWorkflowTestChannel('wflX'))
    ).rejects.toBeDefined();
  });

  it('allows a signed-in user', async () => {
    const backend = createBackend();
    await expect(
      subscribe(connectBrowser(backend, { userId: 'usrMe' }), getWorkflowTestChannel('wflX'))
    ).resolves.toBeDefined();
  });
});
