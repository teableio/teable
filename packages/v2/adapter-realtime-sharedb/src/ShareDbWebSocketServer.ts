import type { ILogger } from '@teable/v2-core';
import { NoopLogger } from '@teable/v2-core';
import WebSocketJSONStream from '@teamwork/websocket-json-stream';
import type ShareDbClass from 'sharedb';

export type WebSocketServer = {
  on(event: 'connection', listener: (socket: unknown, request: unknown) => void): void;
};

export class ShareDbWebSocketServer {
  private readonly logger: ILogger;

  constructor(
    private readonly shareDb: ShareDbClass,
    logger?: ILogger
  ) {
    this.logger = logger ?? new NoopLogger();
  }

  attach(server: WebSocketServer): void {
    server.on('connection', (socket, request) => {
      this.handleConnection(socket, request);
    });
  }

  handleConnection(socket: unknown, request: unknown): void {
    const stream = new WebSocketJSONStream(socket as never);
    this.logger.debug('ShareDB websocket connection opened');
    stream.on('error', (error: unknown) => {
      if (error instanceof Error && error.message === 'WebSocket CLOSING or CLOSED.') {
        return;
      }
      this.logger.warn('ShareDB websocket stream error', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    this.shareDb.listen(stream, request as never);
  }
}
