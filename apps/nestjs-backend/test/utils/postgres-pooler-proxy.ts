import net from 'node:net';

const POSTGRES_STARTUP_HEADER_BYTES = 8;

const parseStartupParameters = (packet: Buffer) => {
  const values = packet.subarray(POSTGRES_STARTUP_HEADER_BYTES).toString('utf8').split('\0');
  const parameters = new Map<string, string>();

  for (let index = 0; index + 1 < values.length; index += 2) {
    const key = values[index];
    if (!key) break;
    parameters.set(key, values[index + 1]);
  }

  return parameters;
};

const startupParameterError = (parameter: string) => {
  const fields = [
    Buffer.from(`SFATAL\0`),
    Buffer.from(`C08P01\0`),
    Buffer.from(`Munsupported startup parameter: ${parameter}\0`),
    Buffer.from('\0'),
  ];
  const payload = Buffer.concat(fields);
  const response = Buffer.alloc(5 + payload.length);
  response[0] = 'E'.charCodeAt(0);
  response.writeInt32BE(4 + payload.length, 1);
  payload.copy(response, 5);
  return response;
};

const rejectedSearchPathParameter = (parameters: Map<string, string>) => {
  if (parameters.has('search_path')) return 'search_path';
  if (parameters.get('options')?.includes('search_path')) return 'search_path';
  return undefined;
};

export const createSearchPathRejectingPostgresProxy = async (targetUrl: string) => {
  const target = new URL(targetUrl);
  const targetPort = Number(target.port || 5432);
  const sockets = new Set<net.Socket>();
  let rejectedConnections = 0;

  const server = net.createServer((client) => {
    const upstream = net.createConnection({ host: target.hostname, port: targetPort });
    sockets.add(client);
    sockets.add(upstream);
    let buffered = Buffer.alloc(0);

    const closePair = () => {
      client.destroy();
      upstream.destroy();
    };
    const releaseClient = () => sockets.delete(client);
    const releaseUpstream = () => sockets.delete(upstream);

    client.on('error', closePair);
    upstream.on('error', closePair);
    client.on('close', releaseClient);
    upstream.on('close', releaseUpstream);

    const inspectStartup = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length < 4) return;

      const packetLength = buffered.readInt32BE(0);
      if (buffered.length < packetLength) return;

      const packet = buffered.subarray(0, packetLength);
      const rejectedParameter = rejectedSearchPathParameter(parseStartupParameters(packet));
      if (rejectedParameter) {
        rejectedConnections += 1;
        client.end(startupParameterError(rejectedParameter));
        upstream.destroy();
        return;
      }

      client.off('data', inspectStartup);
      upstream.write(buffered);
      client.pipe(upstream);
      upstream.pipe(client);
    };

    client.on('data', inspectStartup);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve PostgreSQL proxy address');
  }

  const connectionUrl = new URL(targetUrl);
  connectionUrl.hostname = '127.0.0.1';
  connectionUrl.port = String(address.port);
  connectionUrl.searchParams.delete('schema');
  connectionUrl.searchParams.delete('options');
  connectionUrl.searchParams.set('sslmode', 'disable');

  return {
    connectionUrl: connectionUrl.toString(),
    getRejectedConnections: () => rejectedConnections,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
};
