import type http from 'http';
import type { AdaptableWebSocket } from '@an-epiphany/websocket-json-stream';
import { WebSocketJSONStream } from '@an-epiphany/websocket-json-stream';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Request } from 'express';
import sockjs from 'sockjs';
import { RealtimeMetricsService } from '../share-db/metrics/realtime-metrics.service';
import { ShareDbService } from '../share-db/share-db.service';

@Injectable()
export class WsGateway implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger(WsGateway.name);
  private sockjsServer: sockjs.Server | null = null;
  private readonly activeConnections = new Set<sockjs.Connection>();

  // Track user → connections for session lifecycle metrics
  private readonly userConnectionMap = new Map<string, Set<sockjs.Connection>>();
  // Track connection → { userId, connectTime } for duration calculation
  private readonly connectionMeta = new Map<
    sockjs.Connection,
    { userId: string; connectTime: number }
  >();

  constructor(
    private readonly shareDb: ShareDbService,
    private readonly httpAdapterHost: HttpAdapterHost,
    @Optional() private readonly realtimeMetrics?: RealtimeMetricsService
  ) {}

  onModuleInit() {
    const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer() as http.Server;

    // SockJS server configuration for collaborative data sync (similar to Airtable)
    // - transports: Only websocket and xhr-streaming (xhr-polling excluded for performance)
    // - response_limit: 1MB to handle large batch operations (table sync, bulk row updates)
    this.sockjsServer = sockjs.createServer({
      prefix: '/socket',
      transports: ['websocket', 'xhr-streaming'],
      response_limit: 2 * 1024 * 1024, // 2MB for large collaborative payloads
      log: (severity: string, message: string) => {
        if (severity === 'error') {
          this.logger.error(message);
        } else if (severity === 'info') {
          this.logger.log(message);
        } else {
          this.logger.debug(message);
        }
      },
      // eslint-disable-next-line @typescript-eslint/naming-convention
    } as sockjs.ServerOptions & { transports: string[]; response_limit: number });

    this.sockjsServer.on('connection', this.handleConnection);
    this.sockjsServer.installHandlers(httpServer);
    this.logger.log('WsGateway (SockJS) initialized');
  }

  private handleConnection = (conn: sockjs.Connection) => {
    if (!conn) return;

    this.activeConnections.add(conn);
    this.realtimeMetrics?.recordConnectionOpen();
    this.logger.log(`sockjs:on:connection (active: ${this.activeConnections.size})`);

    // Handle connection close to clean up tracking
    conn.on('close', () => {
      this.activeConnections.delete(conn);
      this.realtimeMetrics?.recordConnectionClose();

      // Track user session end
      this.handleUserDisconnect(conn);

      this.logger.log(`sockjs:on:close (active: ${this.activeConnections.size})`);
    });

    try {
      const stream = new WebSocketJSONStream(conn as unknown as AdaptableWebSocket, {
        adapterType: 'sockjs-node',
      });

      // Extract request with headers (including cookies for auth)
      const request = this.getRequestFromConnection(conn);

      this.shareDb.listen(stream, request);

      // After listen, the ShareDB agent will have custom.userId set by auth middleware
      // We defer userId binding to allow the auth middleware to resolve
      this.deferUserBinding(conn);
    } catch (error) {
      this.logger.error('Connection error', error);
      this.realtimeMetrics?.recordConnectionError();
      conn.write(JSON.stringify({ error }));
      conn.close();
      this.activeConnections.delete(conn);
    }
  };

  /**
   * Defer user binding since ShareDB auth middleware resolves userId asynchronously.
   */
  private deferUserBinding(conn: sockjs.Connection) {
    setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const session = (conn as any)?._session;
      const userId = session?.agent?.custom?.userId;

      if (userId) {
        this.handleUserConnect(conn, userId);
      }
    }, 100);
  }

  private handleUserConnect(conn: sockjs.Connection, userId: string) {
    this.connectionMeta.set(conn, { userId, connectTime: Date.now() });

    let userConns = this.userConnectionMap.get(userId);
    if (!userConns) {
      userConns = new Set();
      this.userConnectionMap.set(userId, userConns);

      // First connection for this user → OTEL session metric
      this.realtimeMetrics?.recordSessionStart();
    }
    userConns.add(conn);
  }

  private handleUserDisconnect(conn: sockjs.Connection) {
    const meta = this.connectionMeta.get(conn);
    this.connectionMeta.delete(conn);

    if (!meta) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userId = (conn as any)?._session?.agent?.custom?.userId;
      if (!userId) return;
      const userConns = this.userConnectionMap.get(userId);
      if (userConns) {
        userConns.delete(conn);
        if (userConns.size === 0) {
          this.userConnectionMap.delete(userId);
          this.realtimeMetrics?.recordSessionEnd();
        }
      }
      return;
    }

    const { userId } = meta;
    const userConns = this.userConnectionMap.get(userId);
    if (!userConns) return;

    userConns.delete(conn);

    if (userConns.size === 0) {
      this.userConnectionMap.delete(userId);
      this.realtimeMetrics?.recordSessionEnd();
    }
  }

  /**
   * Extract HTTP request from SockJS connection.
   *
   * SockJS transports provide request access differently:
   * - XHR (xhr-polling, xhr-streaming): Full request at _session.recv.request
   * - WebSocket: Request stored in faye-websocket driver at _session.recv.ws._driver._request
   *
   * @see https://github.com/sockjs/sockjs-node/blob/main/lib/transport/response-receiver.js
   * @see https://github.com/sockjs/sockjs-node/blob/main/lib/transport/websocket.js
   * @see https://github.com/faye/faye-websocket-node (uses websocket-driver internally)
   */
  private getRequestFromConnection(conn: sockjs.Connection): Request {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recv = (conn as any)?._session?.recv;

    // XHR transports: ResponseReceiver stores full request with cookies
    if (recv?.request) {
      return recv.request as Request;
    }

    // WebSocket transport: FayeWebsocket stores request in driver._request
    // Path: recv.ws (FayeWebsocket) -> _driver (Hybi/Base) -> _request (IncomingMessage)
    const wsRequest = recv?.ws?._driver?._request;
    if (wsRequest) {
      return wsRequest as Request;
    }

    // Fallback: use connection's url and headers (no cookies)
    this.logger.warn(
      `Could not find original request for connection (protocol: ${conn.protocol}), falling back to filtered headers`
    );
    return {
      url: conn.url || '/socket',
      headers: conn.headers || {},
    } as unknown as Request;
  }

  getActiveUserCount(): number {
    return this.userConnectionMap.size;
  }

  getUserConnectionCount(userId: string): number {
    return this.userConnectionMap.get(userId)?.size ?? 0;
  }

  async onModuleDestroy() {
    try {
      this.logger.log('Starting graceful shutdown...');

      // Terminate all active connections
      for (const conn of this.activeConnections) {
        try {
          conn.close();
        } catch {
          // Ignore errors during connection close
        }
      }
      this.activeConnections.clear();
      this.userConnectionMap.clear();
      this.connectionMeta.clear();

      // Close ShareDb
      await new Promise<void>((resolve, reject) => {
        this.shareDb.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });

      // Clean up sockjs server reference
      this.sockjsServer = null;

      this.logger.log('Graceful shutdown completed');
    } catch (err) {
      this.logger.error('Module close error: ' + (err as Error).message, (err as Error)?.stack);
    }
  }
}
