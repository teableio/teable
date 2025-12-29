import { Logger } from '@nestjs/common';
import type { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit } from '@nestjs/websockets';
import { WebSocketGateway } from '@nestjs/websockets';
import { ShareDbWebSocketServer } from '@teable/v2-adapter-realtime-sharedb';
import type { Request } from 'express';
import type WebSocketLib from 'ws';
import { ShareDbService } from '../share-db/share-db.service';

@WebSocketGateway({ path: '/socket', perMessageDeflate: true })
export class WsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private logger = new Logger(WsGateway.name);
  private readonly shareDbWebSocket: ShareDbWebSocketServer;

  constructor(private readonly shareDb: ShareDbService) {
    this.shareDbWebSocket = new ShareDbWebSocketServer(shareDb);
  }

  handleDisconnect() {
    this.logger.log('ws:on:close');
  }

  handleConnection(client: unknown) {
    this.logger.log('ws:on:connection', client);
  }

  afterInit(server: WebSocketLib.Server) {
    this.logger.log('WsGateway afterInit');
    server.on('connection', async (webSocket, request: Request) => {
      try {
        this.logger.log('ws:on:connection');
        this.shareDbWebSocket.handleConnection(webSocket, request);
      } catch (error) {
        webSocket.send(JSON.stringify({ error }));
        webSocket.close();
      }
    });
  }

  async onModuleDestroy() {
    try {
      this.logger.log('Starting graceful shutdown....');
      // 修改 ShareDB 关闭方式为回调形式
      await new Promise<void>((resolve, reject) => {
        this.shareDb.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });

      this.logger.log('Graceful had shutdown completed');
    } catch (err) {
      this.logger.error('dev module close error: ' + (err as Error).message, (err as Error)?.stack);
    }
  }
}
