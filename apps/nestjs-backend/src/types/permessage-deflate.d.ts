/* eslint-disable @typescript-eslint/naming-convention */
declare module 'permessage-deflate' {
  /**
   * RFC 7692 permessage-deflate extension for websocket-driver, as consumed by
   * faye-websocket (and therefore sockjs `faye_server_options.extensions`).
   *
   * Option names mirror the RFC's server_/client_ parameter split: the bare
   * options constrain this endpoint's own deflater, the `request*` options ask
   * the peer to constrain theirs.
   */
  export interface IPermessageDeflateOptions {
    /** zlib compression level, 0-9. */
    level?: number;
    /** zlib memLevel, 1-9. */
    memLevel?: number;
    /** zlib strategy. */
    strategy?: number;
    /** Reset our deflate context between messages (`server_no_context_takeover`). */
    noContextTakeover?: boolean;
    /** Cap our own deflate window, 8-15 (`server_max_window_bits`). */
    maxWindowBits?: number;
    /** Ask the peer to reset its context (`client_no_context_takeover`). */
    requestNoContextTakeover?: boolean;
    /**
     * Ask the peer to cap its deflate window, 8-15 (`client_max_window_bits`).
     * This is what sizes our inflater.
     */
    requestMaxWindowBits?: number;
    /** zlib implementation override; used by the package's own tests. */
    zlib?: unknown;
  }

  /** A websocket frame as websocket-extensions hands it down the pipeline. */
  export interface IPermessageDeflateMessage {
    data: Buffer;
    rsv1: boolean;
  }

  export interface IPermessageDeflateSession {
    /** Negotiated response params, serialized into Sec-WebSocket-Extensions. */
    generateResponse(): Record<string, unknown>;
    processOutgoingMessage(
      message: IPermessageDeflateMessage,
      callback: (error: Error | null, message: IPermessageDeflateMessage) => void
    ): void;
    processIncomingMessage(
      message: IPermessageDeflateMessage,
      callback: (error: Error | null, message: IPermessageDeflateMessage) => void
    ): void;
    close(): void;
  }

  export interface IPermessageDeflateExtension {
    readonly name: 'permessage-deflate';
    readonly type: 'permessage';
    readonly rsv1: boolean;
    readonly rsv2: boolean;
    readonly rsv3: boolean;
    configure(options: IPermessageDeflateOptions): IPermessageDeflateExtension;
    /** Returns null when none of the peer's offers are usable. */
    createServerSession(offers: Array<Record<string, unknown>>): IPermessageDeflateSession | null;
  }

  const deflate: IPermessageDeflateExtension;
  export default deflate;
}
