import url from 'url';
import { Logger } from '@nestjs/common';
import type { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit } from '@nestjs/websockets';
import { WebSocketGateway } from '@nestjs/websockets';
import WebSocketJSONStream from '@teamwork/websocket-json-stream';
import type { Server } from 'ws';
import { ShareDbService } from '../share-db/share-db.service';
import { WsAuthService } from '../share-db/ws-auth.service';
import type { IWebSocketWithAgentId } from '../types/socket';

@WebSocketGateway({ path: '/socket', perMessageDeflate: true })
export class WsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private logger = new Logger(WsGateway.name);
  private server?: Server;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private agentMap = new Map<string, any>();

  constructor(
    private readonly shareDb: ShareDbService,
    private readonly wsAuthService: WsAuthService
  ) {}

  handleDisconnect(client: IWebSocketWithAgentId) {
    this.logger.log('ws:on:close');
    // clear agentMap
    client.agentId && this.agentMap.delete(client.agentId);
  }

  handleConnection() {
    this.logger.log('ws:on:connection');
  }

  afterInit(server: Server) {
    this.logger.log('WsGateway afterInit');
    server.on('connection', async (webSocket: IWebSocketWithAgentId, request) => {
      try {
        const newUrl = new url.URL(request.url || '', 'https://example.com');
        const shareId = newUrl.searchParams.get('shareId');
        const cookie = request.headers.cookie;
        if (shareId) {
          await this.wsAuthService.checkShareCookie(shareId, cookie);
        } else {
          await this.wsAuthService.checkCookie(cookie);
        }
        this.logger.log('ws:on:connection');
        const stream = new WebSocketJSONStream(webSocket);
        const agent = this.shareDb.listen(stream, request);
        // set agent to agentMap
        this.agentMap.set(agent.clientId, agent);
        webSocket.agentId = agent.clientId;
      } catch (error) {
        webSocket.send(JSON.stringify({ error }));
        webSocket.close();
      }
    });
    this.server = server;
  }

  onModuleDestroy() {
    Array.from(this.agentMap.values()).map((agent) => agent?.close?.());
    this.shareDb?.close();
    this.server?.close();
  }
}
