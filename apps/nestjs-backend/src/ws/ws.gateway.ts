import url from 'url';
import { Logger } from '@nestjs/common';
import type { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit } from '@nestjs/websockets';
import { WebSocketGateway } from '@nestjs/websockets';
import WebSocketJSONStream from '@teamwork/websocket-json-stream';
import type { Request } from 'express';
import type { Server } from 'ws';
import { SessionHandleService } from '../features/auth/session/session-handle.service';
import { ShareDbService } from '../share-db/share-db.service';
import { WsAuthService } from '../share-db/ws-auth.service';

@WebSocketGateway({ path: '/socket', perMessageDeflate: true })
export class WsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private logger = new Logger(WsGateway.name);

  constructor(
    private readonly shareDb: ShareDbService,
    private readonly wsAuthService: WsAuthService,
    private readonly sessionHandleService: SessionHandleService
  ) {}

  handleDisconnect() {
    this.logger.log('ws:on:close');
  }

  handleConnection(client: unknown) {
    this.logger.log('ws:on:connection', client);
  }

  afterInit(server: Server) {
    this.logger.log('WsGateway afterInit');
    server.on('connection', async (webSocket, request: Request) => {
      try {
        const newUrl = new url.URL(request.url || '', 'https://example.com');
        const shareId = newUrl.searchParams.get('shareId');
        if (shareId) {
          const cookie = request.headers.cookie;
          await this.wsAuthService.checkShareCookie(shareId, cookie);
        } else {
          const sessionId = await this.sessionHandleService.getSessionIdFromRequest(request);
          await this.wsAuthService.checkSession(sessionId);
        }
        this.logger.log('ws:on:connection');
        const stream = new WebSocketJSONStream(webSocket);
        this.shareDb.listen(stream, request);
      } catch (error) {
        webSocket.send(JSON.stringify({ error }));
        webSocket.close();
      }
    });
  }
}
