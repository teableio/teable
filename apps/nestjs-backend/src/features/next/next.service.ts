import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateQueryId } from '@teable/core';
import type { IQueryParamsRo, IQueryParamsVo } from '@teable/openapi';
import createServer from 'next';
import { CacheService } from '../../cache/cache.service';
import type { ICacheStore } from '../../cache/types';

@Injectable()
export class NextService implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger(NextService.name);
  public server!: ReturnType<typeof createServer>;
  constructor(
    private configService: ConfigService,
    private readonly cacheService: CacheService<ICacheStore>
  ) {}

  private async startNEXTjs() {
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    const port = this.configService.get<number>('PORT');
    const nextJsDir = this.configService.get<string>('NEXTJS_DIR');
    try {
      this.server = createServer({
        dev: nodeEnv !== 'production',
        port: port,
        dir: nextJsDir,
        hostname: 'localhost',
        turbopack: true,
      });
      await this.server.prepare();
    } catch (error) {
      this.logger.error(error);
    }
  }

  async onModuleInit() {
    if (process.env.BACKEND_SKIP_NEXT_START !== 'true') {
      await this.startNEXTjs();
    }
  }

  async onModuleDestroy() {
    await this.server?.close();
  }

  async saveQueryParams(queryParamsRo: IQueryParamsRo): Promise<IQueryParamsVo> {
    const { params } = queryParamsRo;
    const ttl = 60;
    const queryId = generateQueryId();
    const cacheKey = `query-params:${queryId}` as const;

    await this.cacheService.setDetail(cacheKey, params, ttl);

    return { queryId };
  }
}
