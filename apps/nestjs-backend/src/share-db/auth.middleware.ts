/* eslint-disable @typescript-eslint/no-explicit-any */
import url from 'url';
import type ShareDBClass from 'sharedb';
import type { ShareDBPermissionService } from './share-db-permission.service';

export const authMiddleware = (
  shareDB: ShareDBClass,
  shareDBPermissionService: ShareDBPermissionService
) => {
  shareDB.use('connect', async (context, callback) => {
    if (!context.req) {
      context.agent.custom.isBackend = true;
      callback();
      return;
    }
    const cookie = context.req.headers.cookie;
    context.agent.custom.cookie = cookie;

    const newUrl = new url.URL(context.req.url, 'https://example.com');
    context.agent.custom.shareId = newUrl.searchParams.get('shareId');
    await shareDBPermissionService.authMiddleware(context, callback);
  });

  shareDB.use('apply', (context, callback) =>
    shareDBPermissionService.authMiddleware(context, callback)
  );
  shareDB.use('apply', (context, callback) =>
    shareDBPermissionService.checkApplyPermissionMiddleware(context, callback)
  );

  shareDB.use('readSnapshots', (context, callback) =>
    shareDBPermissionService.authMiddleware(context, callback)
  );
  shareDB.use('readSnapshots', (context, callback) =>
    shareDBPermissionService.checkReadPermissionMiddleware(context, callback)
  );
};
