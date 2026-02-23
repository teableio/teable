/* eslint-disable @typescript-eslint/no-explicit-any */
import url from 'url';
import type ShareDBClass from 'sharedb';

export const authMiddleware = (shareDB: ShareDBClass) => {
  const runWithCls = async (context: ShareDBClass.middleware.QueryContext, callback: any) => {
    const cookie = context.agent.custom.cookie;
    const shareId = context.agent.custom.shareId;
    const baseShareId = context.agent.custom.baseShareId;
    const templateHeader = context.agent.custom.templateHeader;
    if (context.options) {
      context.options = { ...context.options, cookie, shareId, baseShareId, templateHeader };
    } else {
      context.options = { cookie, shareId, baseShareId, templateHeader };
    }
    callback();
  };

  shareDB.use('connect', async (context, callback) => {
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
    callback();
  });

  shareDB.use('query', (context, callback) => runWithCls(context, callback));
};
