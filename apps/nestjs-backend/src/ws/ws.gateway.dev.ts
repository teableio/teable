import url from 'url';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import WebSocketJSONStream from '@teamwork/websocket-json-stream';
import type { Request } from 'express';
import type { WebSocket } from 'ws';
import { Server } from 'ws';
import { SessionHandleService } from '../features/auth/session/session-handle.service';
import { ShareDbService } from '../share-db/share-db.service';
import { WsAuthService } from '../share-db/ws-auth.service';

@Injectable()
export class DevWsGateway implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger(DevWsGateway.name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private agents: any[] = [];

  server!: Server;

  constructor(
    private readonly shareDb: ShareDbService,
    private readonly configService: ConfigService,
    private readonly wsAuthService: WsAuthService,
    private readonly sessionHandleService: SessionHandleService
  ) {}

  handleConnection = async (webSocket: WebSocket, request: Request) => {
    this.logger.log('ws:on:connection');
    try {
      const newUrl = new url.URL(request.url, 'https://example.com');
      const shareId = newUrl.searchParams.get('shareId');
      if (shareId) {
        const cookie = request.headers.cookie;
        await this.wsAuthService.checkShareCookie(shareId, cookie);
      } else {
        const sessionId = await this.sessionHandleService.getSessionIdFromRequest(request);
        await this.wsAuthService.checkSession(sessionId);
      }
      const stream = new WebSocketJSONStream(webSocket);
      const agent = this.shareDb.listen(stream, request);
      this.agents.push(agent);
    } catch (error) {
      webSocket.send(JSON.stringify({ error }));
      webSocket.close();
    }
  };

  handleError = (error: Error) => {
    this.logger.error('ws:on:error', error?.stack);
  };

  handleClose = () => {
    this.logger.error('ws:on:close');
  };

  onModuleInit() {
    const port = this.configService.get<number>('SOCKET_PORT');

    this.server = new Server({ port, path: '/socket' });
    this.logger.log(`DevWsGateway afterInit, Port:${port}`);

    this.server.on('connection', this.handleConnection);

    this.server.on('error', this.handleError);

    this.server.on('close', this.handleClose);
  }

  onModuleDestroy() {
    this.agents?.map((agent) => agent?.close());
    this.shareDb.close();
    this.server.close((err) => {
      if (err) {
        this.logger.error('DevWsGateway close error', err?.stack);
      }
    });
  }
}
