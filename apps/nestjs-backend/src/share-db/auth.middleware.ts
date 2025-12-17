/* eslint-disable @typescript-eslint/no-explicit-any */
import url from 'url';
import type ShareDBClass from 'sharedb';

export const authMiddleware = (shareDB: ShareDBClass) => {
  const runWithCls = async (context: ShareDBClass.middleware.QueryContext, callback: any) => {
    const cookie = context.agent.custom.cookie;
    const shareId = context.agent.custom.shareId;
    const templateHeader = context.agent.custom.templateHeader;
    if (context.options) {
      context.options = { ...context.options, cookie, shareId, templateHeader };
    } else {
      context.options = { cookie, shareId, templateHeader };
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
    const templateHeader = newUrl.searchParams.get('templateHeader');
    context.agent.custom.templateHeader = templateHeader;
    context.agent.custom.shareId = shareId;
    callback();
  });

  shareDB.use('query', (context, callback) => runWithCls(context, callback));
};
