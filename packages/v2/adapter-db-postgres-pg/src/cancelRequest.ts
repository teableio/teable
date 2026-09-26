import type { EventEmitter } from 'node:events';
import { isIP } from 'node:net';
import type { Socket } from 'node:net';
import type { ConnectionOptions, TLSSocket } from 'node:tls';
import type { PoolClient } from 'pg';

interface IPostgresProtocolConnection extends EventEmitter {
  stream: Socket;
  connect(portOrPath: number | string, host?: string): void;
  requestSsl(): void;
  cancel(processID: number, secretKey: number): void;
}

export type PostgresProtocolConnectionConstructor = new (config: {
  ssl: boolean | ConnectionOptions;
}) => IPostgresProtocolConnection;

// These are runtime pg fields omitted from its public PoolClient declaration.
interface IPostgresCancellationClient extends Partial<Record<'_connectionTimeoutMillis', number>> {
  processID: number | null;
  secretKey: number | null;
  host: string;
  port: number;
  ssl: boolean | ConnectionOptions;
  connection: { stream: Socket & { servername?: string } };
}

const cancelConnectionTimeoutMillis = 5_000;

const cancellationSslOptions = (
  original: IPostgresCancellationClient,
  socketPath: string | undefined
): boolean | ConnectionOptions => {
  if (!original.ssl) return false;
  const options: ConnectionOptions = original.ssl === true ? {} : { ...original.ssl };
  // pg hides the client-certificate key as a non-enumerable property.
  if (original.ssl !== true && 'key' in original.ssl) {
    options.key = original.ssl.key;
  }
  // Connection supplies its own control socket; never reuse an SSL option's socket.
  delete options.socket;
  // Connecting to the numeric peer must not change certificate identity or SNI.
  options.host ??= socketPath ? 'localhost' : original.host;
  options.servername =
    original.connection.stream.servername ||
    (!socketPath && isIP(original.host) === 0 ? original.host : options.servername);
  return options;
};

/**
 * Close of the control connection is not an acknowledgement that SQL stopped.
 * The caller must also observe the original query and retire its attempted lease.
 */
export const cancelPostgresQuery = async (
  client: PoolClient,
  connectionConstructor: PostgresProtocolConnectionConstructor,
  isActive: () => boolean
): Promise<void> => {
  if (!isActive()) return;

  const original = client as unknown as IPostgresCancellationClient;
  const { processID, secretKey, host, port } = original;
  const { remoteAddress, remotePort } = original.connection.stream;
  const socketPath = host.startsWith('/') ? `${host}/.s.PGSQL.${port}` : undefined;
  if (processID == null || secretKey == null) {
    throw new Error('PostgreSQL cancellation requires BackendKeyData');
  }
  if (!socketPath && (!remoteAddress || !remotePort)) {
    throw new Error('PostgreSQL cancellation requires the original connection peer');
  }

  const ssl = cancellationSslOptions(original, socketPath);

  const connection = new connectionConstructor({ ssl });
  const rawStream = connection.stream;
  const configuredTimeout = original._connectionTimeoutMillis;
  const timeoutMillis =
    configuredTimeout != null && configuredTimeout > 0
      ? configuredTimeout
      : cancelConnectionTimeoutMillis;

  return new Promise<void>((resolve, reject) => {
    let tlsStream: TLSSocket | undefined;
    let failure: Error | undefined;
    let skipped = false;
    let sent = false;
    let settled = false;

    const finish = (hadError: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      connection.removeListener('connect', onConnect);
      connection.removeListener('sslconnect', onSslConnect);
      connection.removeListener('error', onError);
      connection.removeListener('errorMessage', onError);
      rawStream.removeListener('close', onRawClose);
      tlsStream?.removeListener('secureConnect', sendCancel);
      tlsStream?.removeListener('close', onTlsClose);
      if (failure) {
        reject(failure);
      } else if (hadError || (!sent && !skipped)) {
        reject(new Error('PostgreSQL cancellation connection closed before sending CancelRequest'));
      } else {
        resolve();
      }
    };

    const destroyControlConnection = () => {
      connection.stream.destroy();
      if (connection.stream !== rawStream) rawStream.destroy();
    };

    const onError = (error: Error) => {
      failure ??= error;
      // Wait for close even on failure: the caller must not release its lease early.
      destroyControlConnection();
    };

    const sendCancel = () => {
      if (failure || settled) return;
      if (!isActive()) {
        skipped = true;
        destroyControlConnection();
        return;
      }
      if (!connection.stream.writable || connection.stream.destroyed) {
        onError(new Error('PostgreSQL cancellation control connection is not writable'));
        return;
      }
      try {
        connection.cancel(processID, secretKey);
        sent = true;
        // Do not call end(): only the server closing the socket completes the exchange.
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    };

    const onConnect = () => {
      if (failure || settled) return;
      if (!isActive()) {
        skipped = true;
        destroyControlConnection();
        return;
      }
      if (!ssl) {
        sendCancel();
        return;
      }
      try {
        connection.requestSsl();
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    };

    const onSslConnect = () => {
      // pg 8.11.5 emits sslconnect as soon as tls.connect returns, before the
      // handshake/certificate verification completes. Wait for secureConnect too.
      tlsStream = connection.stream as TLSSocket;
      tlsStream.once('close', onTlsClose);
      if (failure || settled) {
        destroyControlConnection();
        return;
      }
      tlsStream.once('secureConnect', sendCancel);
    };

    const onRawClose = (hadError: boolean) => {
      if (!tlsStream) finish(hadError);
    };
    const onTlsClose = (hadError: boolean) => finish(hadError);

    const timer = setTimeout(() => {
      onError(new Error('PostgreSQL cancellation control connection timed out'));
    }, timeoutMillis);
    timer.unref();

    rawStream.once('close', onRawClose);
    connection.once('connect', onConnect);
    connection.once('sslconnect', onSslConnect);
    connection.on('error', onError);
    connection.on('errorMessage', onError);
    try {
      if (!isActive()) {
        skipped = true;
        destroyControlConnection();
      } else if (socketPath) {
        connection.connect(socketPath);
      } else {
        connection.connect(remotePort!, remoteAddress!);
      }
    } catch (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
    }
  });
};
