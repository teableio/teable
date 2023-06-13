import { Logger } from '@nestjs/common';
import type { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit } from '@nestjs/websockets';
import { WebSocketGateway } from '@nestjs/websockets';
import WebSocketJSONStream from '@teamwork/websocket-json-stream';
import type { Server } from 'ws';
import { ShareDbService } from '../share-db/share-db.service';

@WebSocketGateway(parseInt(process.env.SOCKET_PORT || '3001'), { path: '/socket' })
export class WsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private logger = new Logger(WsGateway.name);

  constructor(private readonly shareDb: ShareDbService) {}

  handleDisconnect() {
    this.logger.log('client disconnect');
  }

  handleConnection(client: unknown) {
    this.logger.log({ message: 'client Connect', client });
  }

  afterInit(server: Server) {
    this.logger.log('WsGateway afterInit');
    server.on('connection', (webSocket) => {
      this.logger.log('server:on:connection');
      const stream = new WebSocketJSONStream(webSocket);
      this.shareDb.listen(stream);
    });
  }
}
