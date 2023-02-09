import type { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit } from '@nestjs/websockets';
import { WebSocketGateway } from '@nestjs/websockets';
import WebSocketJSONStream from '@teamwork/websocket-json-stream';
import type { Server } from 'ws';
import { ShareDbService } from '../share-db/share-db.service';

@WebSocketGateway()
export class WsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  constructor(private readonly shareDb: ShareDbService) {}

  handleDisconnect() {
    console.log('client disconnect');
  }

  handleConnection(client: unknown) {
    console.log('client Connect'), client;
  }

  afterInit(server: Server) {
    console.log('WsGateway afterInit');
    server.on('connection', (webSocket) => {
      console.log('server:on:connection');
      const stream = new WebSocketJSONStream(webSocket);
      this.shareDb.listen(stream);
    });
  }
}
