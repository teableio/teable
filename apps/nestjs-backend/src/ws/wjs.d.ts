/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/naming-convention */
declare module '@teamwork/websocket-json-stream' {
  import { Duplex } from 'stream';
  import type WebSocket from 'ws';

  declare class WebSocketJSONStream extends Duplex {
    private _emittedClose;
    private ws;
    constructor(ws: WebSocket);
    _read(): void;
    _write(object: any, encoding: string, callback: (error?: Error | null) => void): void;
    _send(json: string, callback: (error?: Error | null) => void): void;
    _final(callback: (error?: Error | null) => void): void;
    _destroy(error: any, callback: (error: Error | null) => void): void;
    _closeWebSocket(code: number, reason?: string, callback?: (error?: Error | null) => void): void;
  }

  export default WebSocketJSONStream;
}
