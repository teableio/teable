/* eslint-disable @typescript-eslint/no-explicit-any */
import url from 'node:url';
import {
  getActionTriggerChannel,
  getBaseNodeChannel,
  getBasePermissionUpdateChannel,
  getCellCollaboratorsChannel,
  getChatChannel,
  getCollaboratorsChannel,
  getCommentChannel,
  getTableButtonClickChannel,
  getTableCommentChannel,
  getTableImportChannel,
  getToolCallChannel,
  getUserNotificationChannel,
  getWorkflowTestChannel,
  HttpErrorCode,
  IdPrefix,
} from '@teable/core';
import type { PrismaService } from '@teable/db-main-prisma';
import type { ClsService } from 'nestjs-cls';
import type ShareDBClass from 'sharedb';
import type { PermissionService } from '../features/auth/permission.service';
import type { SessionHandleService } from '../features/auth/session/session-handle.service';
import type { IUserOrganizationResolver } from '../features/auth/user-organization-resolver';
import type { IClsStore } from '../types/cls';

// Only the in-process ShareDB transport can receive this marker. Symbols are not
// representable in client messages, cookies, URL parameters, or JSON options.
export const INTERNAL_SHAREDB_CONNECTION = Symbol('internal ShareDB connection');
const NOTIFICATION_CHANNEL_PREFIX = getUserNotificationChannel('');
// getCommentChannel(tableId, recordId) => `__record_comment_${tableId}_${recordId}`.
// Two empty ids leave a trailing separator; drop it to get the bare prefix.
const RECORD_COMMENT_PREFIX = getCommentChannel('', '').slice(0, -1);

// ShareDB presence messages: submit, subscribe, request (ask subscribers to re-send).
// Unsubscribing ('pu') needs no check.
const PRESENCE_SUBMIT = 'p';
const PRESENCE_SUBSCRIBE = 'ps';
const PRESENCE_REQUEST = 'pr';

// ShareDB snapshot fetches at a version ('nf') or a timestamp ('nt'). The library rebuilds
// such a snapshot from adapter calls that do not carry the connection, so nothing there can
// decide who may read it. No client of ours sends them.
const HISTORIC_SNAPSHOT_FETCHES = new Set(['nf', 'nt']);

export interface IAuthMiddlewareDeps {
  sessionHandleService?: SessionHandleService;
  // Presence authorization needs these; when absent (bare test harnesses) every
  // non-notification presence channel is denied, which is the safe default.
  permissionService?: PermissionService;
  clsService?: ClsService<IClsStore>;
  prismaService?: PrismaService;
  userOrganizationResolver?: IUserOrganizationResolver;
}

/**
 * Presence on `__notification_user_<id>` is how a user's notifications reach their browser, so
 * only that user's own connections may listen to it, and only the server may publish on it —
 * otherwise anyone holding a user id could read their notifications, or plant fake ones.
 * Connections the server opens in-process (`isServer`) are trusted.
 */
export const checkNotificationPresence = (
  agent: { stream?: { isServer?: boolean }; custom?: { userId?: string } },
  message: { a?: string; ch?: unknown }
): Error | undefined => {
  if (typeof message?.ch !== 'string' || !message.ch.startsWith(NOTIFICATION_CHANNEL_PREFIX)) {
    return;
  }
  if (agent.stream?.isServer) return;
  const ownChannel = agent.custom?.userId && getUserNotificationChannel(agent.custom.userId);
  if (message.a === PRESENCE_SUBMIT) {
    return new Error('Notification presence is published by the server only');
  }
  if (
    (message.a === PRESENCE_SUBSCRIBE || message.a === PRESENCE_REQUEST) &&
    message.ch !== ownChannel
  ) {
    return new Error('Notification presence is readable by its own user only');
  }
};

// A presence channel names a resource. `share` records whether a public share client
// legitimately uses it, and over which share surface (single-view share, whole-base
// share, or both) — anything else is authenticated-only or denied outright.
type IPresenceChannelKind = 'table' | 'view' | 'tableOrView' | 'base' | 'authedOnly' | 'deny';
interface IPresenceChannelSpec {
  kind: IPresenceChannelKind;
  // The resource id carried by the channel (tableId / viewId / baseId), or '' for deny/authedOnly.
  id: string;
  share: 'view' | 'base' | 'both' | 'none';
}

// Prefix table, derived from the channel helpers so it stays in sync with core.
// Order does not matter: every prefix below is distinct (no one is a prefix of another).
const PRESENCE_CHANNELS: {
  prefix: string;
  kind: IPresenceChannelKind;
  share: IPresenceChannelSpec['share'];
}[] = [
  // live cursors — gated off in shares (isReadOnlyPreview), authenticated app only
  { prefix: getCellCollaboratorsChannel(''), kind: 'table', share: 'none' },
  // header presence avatars — authenticated app only: share pages hide the header actions that
  // show them, and each entry carries a viewer's name and email, which a share visitor must not
  // see (the same reason comments are hidden on share links)
  { prefix: getCollaboratorsChannel(''), kind: 'table', share: 'none' },
  // record/view/table live updates — both share surfaces
  { prefix: getActionTriggerChannel(''), kind: 'tableOrView', share: 'both' },
  { prefix: getBasePermissionUpdateChannel(''), kind: 'base', share: 'base' },
  // the table header's import spinner, which a base share shows too (an allowEdit share hands a
  // signed-in visitor table|import); it carries only `{ loading }`
  { prefix: getTableImportChannel(''), kind: 'table', share: 'base' },
  { prefix: RECORD_COMMENT_PREFIX, kind: 'table', share: 'none' },
  { prefix: getTableCommentChannel(''), kind: 'table', share: 'none' },
  // shared views can run buttons via shareViewButtonClick — both surfaces
  { prefix: getTableButtonClickChannel(''), kind: 'table', share: 'both' },
  { prefix: getBaseNodeChannel(''), kind: 'base', share: 'base' },
  // EE automation test panel — authenticated app only; its workflowId is not
  // resolvable to a base in the community schema, so require a signed-in user.
  { prefix: getWorkflowTestChannel(''), kind: 'authedOnly', share: 'none' },
  // no client subscriber anywhere — never legitimate from a browser
  { prefix: getChatChannel(''), kind: 'deny', share: 'none' },
  { prefix: getToolCallChannel(''), kind: 'deny', share: 'none' },
];

const parsePresenceChannel = (ch: string): IPresenceChannelSpec | undefined => {
  for (const { prefix, kind, share } of PRESENCE_CHANNELS) {
    if (ch.startsWith(prefix)) {
      // record_comment carries `${tableId}_${recordId}`; take the tableId.
      const rest = ch.slice(prefix.length);
      const id = prefix === RECORD_COMMENT_PREFIX ? rest.split('_')[0] : rest;
      return { kind, id, share };
    }
  }
  return undefined;
};

const DENIED = Object.assign(new Error('Presence channel access denied'), {
  code: HttpErrorCode.RESTRICTED_RESOURCE,
});
const HISTORIC_SNAPSHOT_DENIED = Object.assign(
  new Error('Snapshots at a version or a timestamp are not served'),
  { code: HttpErrorCode.RESTRICTED_RESOURCE }
);
const LISTEN_ONLY = Object.assign(
  new Error('Presence channel is listen-only for this connection'),
  {
    code: HttpErrorCode.RESTRICTED_RESOURCE,
  }
);

// What a connection may do on a channel: subscribe and publish, only subscribe, or nothing.
type IPresenceGrant = 'full' | 'listen' | 'none';

/**
 * Authorize a presence subscribe/submit/request on a non-notification channel. Every presence
 * channel names a table/base; a connection may use it only if it can READ that resource — via its
 * signed-in user's role, or via a public share whose scope contains the resource. Anonymous
 * connections with neither are rejected. Without this, any WebSocket client could subscribe to any
 * tenant's presence channels by id and read real-time record/field/comment/base metadata, or plant
 * fake presence.
 *
 * Access that comes only from a share link is listen-only. Share pages never publish presence
 * (their header avatars and cell cursors are hidden), while what a share visitor could publish
 * reaches the members who have the same table open: a forged action trigger, say, drops records
 * from their grid until they reload.
 */
const createPresenceAuthorizer = (deps: IAuthMiddlewareDeps) => {
  const { permissionService, clsService, prismaService: prisma, userOrganizationResolver } = deps;

  const tableToBaseId = async (tableId: string): Promise<string | undefined> =>
    (
      await prisma!.tableMeta.findFirst({
        where: { id: tableId, deletedTime: null },
        select: { baseId: true },
      })
    )?.baseId;

  const viewToTableId = async (viewId: string): Promise<string | undefined> =>
    (
      await prisma!.view.findFirst({
        where: { id: viewId, deletedTime: null },
        select: { tableId: true },
      })
    )?.tableId;

  // Resolve the channel's resource to { tableId?, baseId }. baseId drives every access check;
  // tableId is kept so a single-view share can be pinned to its one table.
  const resolveResource = async (
    spec: IPresenceChannelSpec
  ): Promise<{ tableId?: string; baseId: string } | undefined> => {
    if (spec.kind === 'base') {
      return spec.id.startsWith(IdPrefix.Base) ? { baseId: spec.id } : undefined;
    }
    let tableId: string | undefined;
    if (spec.kind === 'table') {
      tableId = spec.id.startsWith(IdPrefix.Table) ? spec.id : undefined;
    } else if (spec.kind === 'view') {
      tableId = spec.id.startsWith(IdPrefix.View) ? await viewToTableId(spec.id) : undefined;
    } else if (spec.kind === 'tableOrView') {
      if (spec.id.startsWith(IdPrefix.Table)) tableId = spec.id;
      else if (spec.id.startsWith(IdPrefix.View)) tableId = await viewToTableId(spec.id);
    }
    if (!tableId) return undefined;
    const baseId = await tableToBaseId(tableId);
    return baseId ? { tableId, baseId } : undefined;
  };

  const userCanRead = async (userId: string, baseId: string): Promise<boolean> => {
    try {
      // Throws when the user has no role on the base (or its space); reuse the same
      // resolution the HTTP layer uses so cross-tenant users are rejected identically.
      await clsService!.runWith({ user: { id: userId } } as IClsStore, async () => {
        if (userOrganizationResolver) {
          const organization = await userOrganizationResolver.getUserOrganization(userId);
          clsService!.set('organization', organization ?? undefined);
        }
        return permissionService!.getPermissionByBaseId(baseId);
      });
      return true;
    } catch {
      return false;
    }
  };

  // Per-connection, edition-agnostic share-scope lookups (base/table/view metadata rows carry
  // the same share ids in v1 and v2, so no useV2 resolution is needed here).
  //
  // A share with a password has no scope for a connection that has not presented it. The
  // connection carries the visitor's cookies, and the token the password page hands out is one
  // of them: the pages and the records of the share are refused without it, and so is hearing
  // what changes in them.
  const viewShareScope = async (
    agent: any,
    shareId: string
  ): Promise<{ tableId: string; baseId: string } | undefined> => {
    const cache = (agent.custom.__viewShareScope ??= new Map<string, any>());
    if (!cache.has(shareId)) {
      const view = await prisma!.view.findFirst({
        where: { shareId, enableShare: true, deletedTime: null },
        select: { tableId: true },
      });
      const presented = view
        ? await permissionService!.shareViewPasswordPresented(shareId, agent.custom.cookie)
        : false;
      const baseId = view && presented ? await tableToBaseId(view.tableId) : undefined;
      cache.set(shareId, view && baseId ? { tableId: view.tableId, baseId } : undefined);
    }
    return cache.get(shareId);
  };

  const baseShareScope = async (
    agent: any,
    baseShareId: string
  ): Promise<{ baseId: string } | undefined> => {
    const cache = (agent.custom.__baseShareScope ??= new Map<string, any>());
    if (!cache.has(baseShareId)) {
      const share = await prisma!.baseShare.findUnique({
        where: { shareId: baseShareId },
        select: { baseId: true, enabled: true },
      });
      const presented = share?.enabled
        ? await permissionService!.baseSharePasswordPresented(baseShareId, agent.custom.cookie)
        : false;
      cache.set(baseShareId, share && presented ? { baseId: share.baseId } : undefined);
    }
    return cache.get(baseShareId);
  };

  // Whether a base share covers a table, as the HTTP layer resolves it: every table of the base
  // for a whole-base share; for a share of one node, the tables under it.
  const baseShareCoversTable = async (baseShareId: string, tableId: string): Promise<boolean> => {
    try {
      await clsService!.runWith({} as IClsStore, () =>
        permissionService!.getBaseSharePermissions(baseShareId, tableId)
      );
      return true;
    } catch {
      return false;
    }
  };

  const shareAllows = async (
    agent: any,
    spec: IPresenceChannelSpec,
    resource: { tableId?: string; baseId: string }
  ): Promise<boolean> => {
    const { shareId, baseShareId } = agent.custom ?? {};
    // Base share: the base's own channels serve any share of it, a table's channels only a
    // share that covers the table. Without the second check a share of one table hears what
    // changes in every other table of the base: record and field ids, and on v1 the whole
    // definition of a field as it is added or edited.
    if (baseShareId && (spec.share === 'base' || spec.share === 'both')) {
      const scope = await baseShareScope(agent, baseShareId);
      if (
        scope?.baseId === resource.baseId &&
        (!resource.tableId || (await baseShareCoversTable(baseShareId, resource.tableId)))
      ) {
        return true;
      }
    }
    // Single-view share: only the one shared table (base-level channels are 'base' scope only,
    // so they never reach here with a shareId).
    if (shareId && (spec.share === 'view' || spec.share === 'both')) {
      const scope = await viewShareScope(agent, shareId);
      if (scope && resource.tableId && scope.tableId === resource.tableId) return true;
    }
    return false;
  };

  const authorizeChannel = async (agent: any, ch: string): Promise<IPresenceGrant> => {
    if (!permissionService || !clsService || !prisma) return 'none';
    const spec = parsePresenceChannel(ch);
    if (!spec || spec.kind === 'deny') return 'none';
    if (spec.kind === 'authedOnly') return agent.custom?.userId ? 'full' : 'none';

    // A channel whose resource cannot be resolved — a deleted/nonexistent table or view, or a
    // malformed id — exposes no data: nothing live publishes there. Denying it would only make a
    // collaborator's page throw when a table it had open is deleted out from under it, as the
    // client still tears down presence for the now-gone resource. Any channel that points at real
    // data DOES resolve here and is gated below, so allowing the unresolvable case never widens
    // access. (A genuine lookup failure throws out of resolveResource and is caught fail-closed by
    // the receive wrapper, so this branch is reached only for a clean "no such resource".)
    const resource = await resolveResource(spec);
    if (!resource) return 'full';

    const userId: string | undefined = agent.custom?.userId;
    if (userId && (await userCanRead(userId, resource.baseId))) return 'full';
    if (await shareAllows(agent, spec, resource)) return 'listen';
    return 'none';
  };

  return async (
    agent: { stream?: { isServer?: boolean }; custom?: any },
    message: { a?: string; ch?: unknown }
  ): Promise<Error | undefined> => {
    const { a, ch } = message;
    if (typeof ch !== 'string') return;
    if (a !== PRESENCE_SUBMIT && a !== PRESENCE_SUBSCRIBE && a !== PRESENCE_REQUEST) return;
    if (agent.stream?.isServer) return;
    if (ch.startsWith(NOTIFICATION_CHANNEL_PREFIX))
      return checkNotificationPresence(agent, message);

    // One authorization per channel per connection; presence re-sends ('pr') and publishes ('p')
    // reuse the subscribe grant.
    const cache: Map<string, IPresenceGrant> = (agent.custom.__presenceAuth ??= new Map());
    let grant = cache.get(ch);
    if (grant === undefined) {
      grant = await authorizeChannel(agent, ch);
      cache.set(ch, grant);
    }
    if (grant === 'none') return DENIED;
    if (grant === 'listen' && a === PRESENCE_SUBMIT) return LISTEN_ONLY;
    return undefined;
  };
};

export const authMiddleware = (shareDB: ShareDBClass, deps: IAuthMiddlewareDeps = {}) => {
  const { sessionHandleService } = deps;
  const authorizePresence = createPresenceAuthorizer(deps);

  const runWithCls = async (context: ShareDBClass.middleware.QueryContext, callback: any) => {
    const cookie = context.agent.custom.cookie;
    const shareId = context.agent.custom.shareId;
    const baseShareId = context.agent.custom.baseShareId;
    const templateHeader = context.agent.custom.templateHeader;
    const lang = context.agent.custom.lang;
    const acceptLanguage = context.agent.custom.acceptLanguage;
    const requestInfo = { cookie, shareId, baseShareId, templateHeader, lang, acceptLanguage };
    if (context.options) {
      context.options = { ...context.options, ...requestInfo };
    } else {
      context.options = requestInfo;
    }
    callback();
  };

  shareDB.use('connect', async (context, callback) => {
    if (!context.req && context.agent.stream.isServer === true) {
      Object.defineProperty(context.agent.custom, INTERNAL_SHAREDB_CONNECTION, { value: true });
    }
    if (!context.req) {
      callback();
      return;
    }
    const cookie = context.req.headers.cookie;
    context.agent.custom.cookie = cookie;

    const newUrl = new url.URL(context.req.url, 'https://example.com');
    const shareId = newUrl.searchParams.get('shareId');
    const baseShareIdParam = newUrl.searchParams.get('baseShareId');
    // Only set baseShareId if explicitly provided, don't fallback to shareId
    // This allows view share (shareId only) and base share (baseShareId) to work independently
    const baseShareId = baseShareIdParam || null;
    const templateHeader = newUrl.searchParams.get('templateHeader');
    context.agent.custom.templateHeader = templateHeader;
    context.agent.custom.shareId = shareId;
    context.agent.custom.baseShareId = baseShareId;
    // The page's own language (sent by the SDK) and the browser's, for localizing errors.
    context.agent.custom.lang = newUrl.searchParams.get('lang');
    context.agent.custom.acceptLanguage = context.req.headers['accept-language'];

    // The signed-in user, from the session cookie. Notification channels are authorized by it.
    if (sessionHandleService && cookie) {
      try {
        // Hand express-session the cookie alone: SockJS keeps its own session id (from the URL)
        // on `req.session`, which express-session takes for a session already loaded, so it
        // would never read the cookie and every browser connection would stay anonymous.
        const sessionId = await sessionHandleService.getSessionIdFromRequest({
          headers: { cookie },
          url: context.req.url,
        } as any);
        if (sessionId) {
          const userId = await sessionHandleService.getUserId(sessionId);
          context.agent.custom.userId = userId;
        }
      } catch {
        // The connection still opens, anonymous: it can listen to no notification channel
      }
    }

    callback();
  });

  shareDB.use('query', (context, callback) => runWithCls(context, callback));

  shareDB.use('receive', (context, callback) => {
    const action = (context.data as { a?: unknown } | undefined)?.a;
    if (
      typeof action === 'string' &&
      HISTORIC_SNAPSHOT_FETCHES.has(action) &&
      context.agent.custom[INTERNAL_SHAREDB_CONNECTION] !== true
    ) {
      return callback(HISTORIC_SNAPSHOT_DENIED);
    }
    authorizePresence(context.agent, context.data as { a?: string; ch?: unknown }).then(
      (error) => callback(error),
      // A lookup failure must fail closed, not open the channel.
      () => callback(DENIED)
    );
  });
};
