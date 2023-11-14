/* eslint-disable @typescript-eslint/no-explicit-any */
import url from 'url';
import type ShareDBClass from 'sharedb';
import type { ShareDbPermissionService } from './share-db-permission.service';

export const authMiddleware = (
  shareDB: ShareDBClass,
  shareDbPermissionService: ShareDbPermissionService
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
    await shareDbPermissionService.authMiddleware(context, callback);
  });

  shareDB.use('apply', (context, callback) =>
    shareDbPermissionService.authMiddleware(context, callback)
  );
  shareDB.use('apply', (context, callback) =>
    shareDbPermissionService.checkApplyPermissionMiddleware(context, callback)
  );

  shareDB.use('query', (context, callback) =>
    shareDbPermissionService.authMiddleware(context, callback)
  );
  shareDB.use('readSnapshots', (context, callback) =>
    shareDbPermissionService.checkReadPermissionMiddleware(context, callback)
  );
};
