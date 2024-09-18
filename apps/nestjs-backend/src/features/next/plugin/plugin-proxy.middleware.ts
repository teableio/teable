// proxy.middleware.ts
import type { NestMiddleware } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { RequestHandler } from 'http-proxy-middleware';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { BaseConfig, IBaseConfig } from '../../../configs/base.config';

export class PluginProxyMiddleware implements NestMiddleware {
  private proxy: RequestHandler;

  constructor(@BaseConfig() private readonly baseConfig: IBaseConfig) {
    this.proxy = createProxyMiddleware({
      target: `http://localhost:${baseConfig.pluginServerPort}`,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async use(req: Request, res: Response, next: () => void): Promise<any> {
    this.proxy(req, res, next);
  }
}
