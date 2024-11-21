import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import WebSocketJSONStream from '@teamwork/websocket-json-stream';
import type { Request } from 'express';
import type { WebSocket } from 'ws';
import { Server } from 'ws';
import { ShareDbService } from '../share-db/share-db.service';

@Injectable()
export class DevWsGateway implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger(DevWsGateway.name);

  server!: Server;

  constructor(
    private readonly shareDb: ShareDbService,
    private readonly configService: ConfigService
  ) {}

  handleConnection = async (webSocket: WebSocket, request: Request) => {
    this.logger.log('ws:on:connection');
    try {
      const stream = new WebSocketJSONStream(webSocket);
      this.shareDb.listen(stream, request);
    } catch (error) {
      webSocket.send(JSON.stringify({ error }));
      webSocket.close();
    }
  };

  handleError = (error: Error) => {
    this.logger.error('ws:on:error', error?.stack);
  };

  handleClose = () => {
    this.logger.log('ws:on:close');
  };

  onModuleInit() {
    const port = this.configService.get<number>('SOCKET_PORT');

    this.server = new Server({ port, path: '/socket' });
    this.logger.log(`DevWsGateway afterInit, Port:${port}`);

    this.server.on('connection', this.handleConnection);

    this.server.on('error', this.handleError);

    this.server.on('close', this.handleClose);
  }

  async onModuleDestroy() {
    try {
      this.logger.log('Starting graceful shutdown...');
      this.server?.clients.forEach((client) => {
        client.terminate();
      });

      await Promise.all([
        new Promise((resolve) => {
          this.shareDb.close((err) => {
            if (err) {
              this.logger.error('ShareDb close error', err?.stack);
            } else {
              this.logger.log('ShareDb closed successfully');
            }
            resolve(null);
          });
        }),

        new Promise((resolve) => {
          this.server.close((err) => {
            if (err) {
              this.logger.error('DevWsGateway close error', err?.stack);
            } else {
              this.logger.log('WebSocket server closed successfully');
            }
            resolve(null);
          });
        }),
      ]);

      this.logger.log('Graceful had shutdown completed');
      process.exit(0);
    } catch (err) {
      this.logger.error('dev module close error: ' + (err as Error).message, (err as Error)?.stack);
    }
  }
}
