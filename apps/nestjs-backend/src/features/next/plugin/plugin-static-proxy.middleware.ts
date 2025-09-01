// plugin-static-proxy.middleware.ts
import type { NestMiddleware } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { RequestHandler } from 'http-proxy-middleware';
export class PluginStaticProxyMiddleware implements NestMiddleware {
  private proxy: RequestHandler;

  constructor() {
    const assetPrefix = process.env.NEXT_BUILD_ENV_ASSET_PREFIX;
    this.proxy = createProxyMiddleware({
      target: assetPrefix,
      changeOrigin: true,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async use(req: Request, res: Response, next: () => void): Promise<any> {
    const assetPrefix = process.env.NEXT_BUILD_ENV_ASSET_PREFIX;
    if (assetPrefix && req.path.startsWith('/plugin/_next/static/')) {
      return this.proxy(req, res, next);
    }

    next();
  }
}
