import { Logger } from '@nestjs/common';
import { IdPrefix } from '@teable/core';
import type { PrismaService } from '@teable/db-main-prisma';
import {
  BASE_SHARE_ID_HEADER,
  createAxios,
  GET_TABLE_PERMISSION,
  IS_TEMPLATE_HEADER,
  urlBuilder,
} from '@teable/openapi';
import type ShareDBClass from 'sharedb';
import {
  type IViewShareDbOp,
  omitViewShareConfigFromOp,
  touchesViewShareConfig,
} from '../features/view/view-share-config';

/** Whether this ShareDB connection may read the share link and settings of views in this table. */
export type ICanReadViewShareConfig = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: any,
  tableId: string
) => Promise<boolean>;

type IOpMiddlewareContext = {
  collection: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: any;
  op: IViewShareDbOp;
};

const logger = new Logger('ViewShareConfigFilter');

/**
 * A live op on a view carries its share link or settings when sharing is turned on, the link is
 * refreshed or a setting changes, and every subscriber of the view hears it. The REST snapshot
 * gives those only to members who manage the view's share (`view|share`), so the op reaches any
 * other subscriber without them. ShareDB hands each subscriber its own shallow copy of the op,
 * so the stripped parts are replaced, never edited in place.
 */
export const createViewShareConfigFilter =
  (canRead: ICanReadViewShareConfig) =>
  (context: IOpMiddlewareContext, next: (err?: unknown) => void) => {
    const { collection, op, agent } = context;
    if (!collection.startsWith(`${IdPrefix.View}_`) || !op || !touchesViewShareConfig(op)) {
      return next();
    }
    const tableId = collection.slice(IdPrefix.View.length + 1);
    canRead(agent, tableId)
      .catch((error) => {
        logger.warn(`Could not tell who may read the share config of ${tableId}: ${error}`);
        return false;
      })
      .then((allowed) => {
        if (!allowed) Object.assign(op, omitViewShareConfigFromOp(op));
        next();
      });
  };

const PERMISSION_TTL_MS = 60_000;

/**
 * Asks the table permission route as the connection itself (its session cookie, base share or
 * template header), so roles, the authority matrix and share visits answer as they do over REST.
 * Cached per connection and table for a minute: these ops are rare, and a role change shows up
 * in the next REST read anyway.
 */
export const createCanReadViewShareConfig = (
  prismaService: PrismaService
): ICanReadViewShareConfig => {
  const axios = createAxios();
  axios.interceptors.request.use((config) => {
    config.baseURL = `http://localhost:${process.env.PORT}/api`;
    return config;
  });
  return async (agent, tableId) => {
    const custom = agent?.custom ?? {};
    const cache: Map<string, { at: number; allowed: Promise<boolean> }> =
      (custom.__viewShareConfig ??= new Map());
    const hit = cache.get(tableId);
    if (hit && Date.now() - hit.at < PERMISSION_TTL_MS) return hit.allowed;

    const allowed = (async () => {
      const { cookie, baseShareId, templateHeader } = custom;
      if (!cookie && !baseShareId && !templateHeader) return false;
      const table = await prismaService.tableMeta.findFirst({
        where: { id: tableId, deletedTime: null },
        select: { baseId: true },
      });
      if (!table) return false;
      const res = await axios.get(
        urlBuilder(GET_TABLE_PERMISSION, { baseId: table.baseId, tableId }),
        {
          headers: {
            cookie,
            ...(baseShareId ? { [BASE_SHARE_ID_HEADER]: baseShareId } : {}),
            ...(templateHeader ? { [IS_TEMPLATE_HEADER]: templateHeader } : {}),
          },
        }
      );
      return Boolean(res.data?.view?.['view|share']);
    })().catch(() => false);
    cache.set(tableId, { at: Date.now(), allowed });
    return allowed;
  };
};

export const registerViewShareConfigFilter = (
  shareDB: ShareDBClass,
  canRead: ICanReadViewShareConfig
) => {
  shareDB.use('op', createViewShareConfigFilter(canRead) as never);
};
