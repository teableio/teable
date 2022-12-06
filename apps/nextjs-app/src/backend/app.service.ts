import type { OnModuleInit } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import createServer from 'next';
import type { NextServer } from 'next/dist/server/next';
import * as appInterface from './app.interface';

@Injectable()
export class AppService implements OnModuleInit {
  private server!: NextServer;
  constructor(
    @Inject('APP_CONFIG') private config: appInterface.IAppConfig,
    private configService: ConfigService
  ) {}

  async onModuleInit() {
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    try {
      this.server = createServer({
        dev: nodeEnv !== 'production',
        port: this.config.port,
        dir: this.config.dir,
        hostname: 'localhost',
        customServer: true,
      });
      await this.server.prepare();
    } catch (error) {
      console.error(error);
    }
  }

  handler(req: Request, res: Response) {
    return this.server.getRequestHandler()(req, res);
  }
}
