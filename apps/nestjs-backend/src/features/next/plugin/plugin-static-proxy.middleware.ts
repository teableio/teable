// plugin-static-proxy.middleware.ts
import path from 'path';
import type { NestMiddleware } from '@nestjs/common';
import type { Request, Response } from 'express';

export class PluginStaticProxyMiddleware implements NestMiddleware {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async use(req: Request, res: Response, next: () => void): Promise<any> {
    const assetPrefix = process.env.NEXT_BUILD_ENV_ASSET_PREFIX;
    console.log('PluginStaticProxyMiddleware assetPrefix', assetPrefix);
    console.log('PluginStaticProxyMiddleware req.path', req.path);
    if (assetPrefix && req.path.startsWith('/plugin/_next/static/')) {
      const assetUrl = path.join(assetPrefix, req.path);
      console.log('PluginStaticProxyMiddleware assetUrl', assetUrl);
      return res.redirect(302, assetUrl);
    }

    next();
  }
}
