import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import createServer from 'next';
import type { NextServer } from 'next/dist/server/next';

@Injectable()
export class NextService implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger(NextService.name);
  public server!: NextServer;
  constructor(private configService: ConfigService) {}

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
      });
      await this.server.prepare();
    } catch (error) {
      this.logger.error(error);
    }
  }

  async onModuleInit() {
    await this.startNEXTjs();
  }

  async onModuleDestroy() {
    await this.server?.close();
  }
}
