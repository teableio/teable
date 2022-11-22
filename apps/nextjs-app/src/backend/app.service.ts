import type { OnModuleInit } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import createServer from 'next';
import type { NextServer } from 'next/dist/server/next';
import { DEFAULT_PORT } from './const';

@Injectable()
export class AppService implements OnModuleInit {
  private server!: NextServer;
  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    try {
      this.server = createServer({
        dev: this.configService.get<string>('NODE_ENV') !== 'production',
        port: DEFAULT_PORT,
        hostname: 'localhost',
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
