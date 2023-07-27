import type { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import WebSocketJSONStream from '@teamwork/websocket-json-stream';
import type { WebSocket } from 'ws';
import { Server } from 'ws';
import { ShareDbService } from '../share-db/share-db.service';

@Injectable()
export class DevWsGateway implements OnModuleInit {
  private logger = new Logger(DevWsGateway.name);

  server!: Server;

  constructor(
    private readonly shareDb: ShareDbService,
    private readonly configService: ConfigService
  ) {}

  handleConnection = (webSocket: WebSocket) => {
    this.logger.log('ws:on:connection');
    const stream = new WebSocketJSONStream(webSocket);
    this.shareDb.listen(stream);
  };

  handleError = (error: Error) => {
    this.logger.error('ws:on:error', error);
  };

  handleClose = () => {
    this.logger.error('ws:on:close');
  };

  onModuleInit() {
    const port = this.configService.get<number>('SOCKET_PORT');

    this.server = new Server({ port, path: '/socket' });

    this.server.on('connection', this.handleConnection);

    this.server.on('error', this.handleError);

    this.server.on('close', this.handleClose);
  }
}
