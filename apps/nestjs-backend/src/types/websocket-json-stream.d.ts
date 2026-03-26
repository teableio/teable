declare module '@teamwork/websocket-json-stream' {
  import { Duplex } from 'stream';

  class WebSocketJSONStream extends Duplex {
    constructor(ws: unknown);
  }

  export default WebSocketJSONStream;
}
