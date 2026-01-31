import SockJS from 'sockjs-client';

/**
 * Available SockJS transport types
 * - websocket: WebSocket (preferred, fastest, full-duplex)
 * - xhr-streaming: XHR streaming (fallback for restricted networks)
 *
 * Note: xhr-polling is intentionally excluded as it's rarely needed
 * in modern environments and has poor real-time performance.
 */
export type ISockJSTransport = 'websocket' | 'xhr-streaming';

/** WebSocket ready state constants */
export enum ReadyState {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3,
}

export interface IReconnectingSockJSOptions {
  /** Maximum number of reconnection attempts. Default: Infinity */
  maxRetries?: number;
  /** Initial reconnection interval in ms. Default: 1000 */
  reconnectInterval?: number;
  /** Maximum reconnection interval in ms. Default: 30000 */
  maxReconnectInterval?: number;
  /** Reconnection delay multiplier. Default: 1.5 */
  reconnectDecay?: number;
  /**
   * Transport types to use in order of preference.
   * SockJS will try each transport in order and fallback to the next if it fails.
   * Default: ['websocket', 'xhr-streaming']
   */
  transports?: ISockJSTransport[];
  /** Timeout for transport connection in ms. Default: 5000 */
  timeout?: number;
  /** Enable debug logging. Default: false */
  debug?: boolean;
}

type IMessageEvent = { data: string };
type IEventHandler<T> = ((event: T) => void) | null;

/**
 * A SockJS wrapper that provides automatic reconnection functionality
 * similar to reconnecting-websocket
 */
export class ReconnectingSockJS {
  // WebSocket compatible static constants
  static readonly CONNECTING = ReadyState.CONNECTING;
  static readonly OPEN = ReadyState.OPEN;
  static readonly CLOSING = ReadyState.CLOSING;
  static readonly CLOSED = ReadyState.CLOSED;

  // Configuration
  private readonly url: string;
  private readonly maxRetries: number;
  private readonly reconnectInterval: number;
  private readonly maxReconnectInterval: number;
  private readonly reconnectDecay: number;
  private readonly transports: ISockJSTransport[];
  private readonly timeout: number;
  private readonly debug: boolean;

  // State
  private socket: WebSocket | null = null;
  private reconnectAttempts = 0;
  private forcedClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Event handlers
  onopen: IEventHandler<Event> = null;
  onclose: IEventHandler<CloseEvent> = null;
  onmessage: IEventHandler<IMessageEvent> = null;
  onerror: IEventHandler<Event> = null;

  constructor(url: string, options: IReconnectingSockJSOptions = {}) {
    this.url = url;
    this.maxRetries = options.maxRetries ?? Infinity;
    this.reconnectInterval = options.reconnectInterval ?? 1000;
    this.maxReconnectInterval = options.maxReconnectInterval ?? 30000;
    this.reconnectDecay = options.reconnectDecay ?? 1.5;
    this.transports = options.transports ?? ['websocket', 'xhr-streaming'];
    this.timeout = options.timeout ?? 5000;
    this.debug = options.debug ?? false;

    this.connect();
  }

  /** Current connection state */
  get readyState(): number {
    return this.socket?.readyState ?? ReadyState.CLOSED;
  }

  /** Whether the connection is currently open */
  get isConnected(): boolean {
    return this.readyState === ReadyState.OPEN;
  }

  /** Current reconnection attempt count */
  get attempts(): number {
    return this.reconnectAttempts;
  }

  /** Send data through the connection */
  send(data: string): void {
    if (this.isConnected) {
      this.socket?.send(data);
    } else {
      this.log('Cannot send: connection not open');
    }
  }

  /** Close the connection */
  close(code?: number, reason?: string): void {
    this.forcedClose = true;
    this.clearReconnectTimer();
    // Close it first, allowing the onclose event to trigger normally before performing cleanup.
    this.socket?.close(code, reason);
  }

  /** Force reconnection */
  reconnect(): void {
    this.log('Manual reconnect triggered');
    this.clearReconnectTimer();
    // First, clean up the old socket to avoid race conditions.
    const oldSocket = this.socket;
    this.socket = null;
    if (oldSocket) {
      oldSocket.onopen = null;
      oldSocket.onclose = null;
      oldSocket.onmessage = null;
      oldSocket.onerror = null;
      oldSocket.close();
    }
    this.reconnectAttempts = 0;
    this.connect();
  }

  /** Completely destroy the instance and release all resources */
  destroy(): void {
    this.log('Destroying instance');
    this.forcedClose = true;
    this.clearReconnectTimer();
    // First disable the event trigger, then perform cleanup.
    if (this.socket) {
      const oldSocket = this.socket;
      this.socket = null;
      oldSocket.onopen = null;
      oldSocket.onclose = null;
      oldSocket.onmessage = null;
      oldSocket.onerror = null;
      oldSocket.close();
    }
    this.onopen = null;
    this.onclose = null;
    this.onmessage = null;
    this.onerror = null;
  }

  // Private methods
  private connect(): void {
    this.forcedClose = false;
    this.log('Connecting to ' + this.url + ' (attempt ' + (this.reconnectAttempts + 1) + ')');

    this.socket = new SockJS(this.url, undefined, {
      transports: this.transports,
      timeout: this.timeout,
    }) as unknown as WebSocket;

    this.socket.onopen = this.handleOpen;
    this.socket.onclose = this.handleClose;
    this.socket.onmessage = this.handleMessage;
    this.socket.onerror = this.handleError;
  }

  private handleOpen = (event: Event): void => {
    this.log('Connection opened');
    this.reconnectAttempts = 0;
    this.onopen?.(event);
  };

  private handleClose = (event: CloseEvent): void => {
    this.log('Connection closed (code: ' + event.code + ', reason: ' + event.reason + ')');
    // Clean up old socket references
    this.cleanupSocket();
    this.socket = null;

    this.onclose?.(event);

    if (!this.forcedClose) {
      this.scheduleReconnect();
    }
  };

  private handleMessage = (event: IMessageEvent): void => {
    this.onmessage?.(event);
  };

  private handleError = (event: Event): void => {
    this.log('Connection error');
    this.onerror?.(event);
  };

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxRetries) {
      this.log('Max retries (' + this.maxRetries + ') reached, giving up');
      return;
    }

    const delay = this.calculateDelay();
    this.log('Reconnecting in ' + delay + 'ms...');

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  private calculateDelay(): number {
    return Math.min(
      this.reconnectInterval * Math.pow(this.reconnectDecay, this.reconnectAttempts),
      this.maxReconnectInterval
    );
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private cleanupSocket(): void {
    if (this.socket) {
      // Remove event handlers to prevent memory leaks
      this.socket.onopen = null;
      this.socket.onclose = null;
      this.socket.onmessage = null;
      this.socket.onerror = null;
    }
  }

  private log(message: string): void {
    if (this.debug) {
      console.log('[ReconnectingSockJS] ' + message);
    }
  }
}
