import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, it } from 'bun:test';
import { createSsrfSafeFetch } from '../src/ssrf/fetch';

const servers = new Set<Server>();

const listen = (server: Server): Promise<number> => {
  servers.add(server);
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    server.off('error', reject);
    const address = server.address();
    if (!address || typeof address === 'string') {
      reject(new Error('Bun SSRF test server did not expose a TCP port'));
      return;
    }
    resolve(address.port);
  });
  return promise;
};

const close = (server: Server): Promise<void> => {
  if (!server.listening) return Promise.resolve();
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  server.close((error) => (error ? reject(error) : resolve()));
  return promise;
};

afterEach(async () => {
  delete process.env.BACKEND_STORAGE_PROVIDER;
  delete process.env.BACKEND_STORAGE_MINIO_ENDPOINT;
  delete process.env.BACKEND_STORAGE_MINIO_PORT;
  await Promise.all([...servers].map(close));
  servers.clear();
});

describe('createSsrfSafeFetch in Bun', () => {
  it('runs the Bun transport branch and rejects an unsafe loopback peer', async () => {
    expect('Bun' in globalThis).toBe(true);
    const server = createServer((_request, response) => response.end('unsafe'));
    const port = await listen(server);

    await expect(createSsrfSafeFetch()(`http://127.0.0.1:${port}/unsafe`)).rejects.toThrow();
  });

  it('keeps allowPrivateNetwork behavior under the Bun transport branch', async () => {
    const server = createServer((_request, response) => response.end('private'));
    const port = await listen(server);

    const response = await createSsrfSafeFetch({ allowPrivateNetwork: true })(
      `http://127.0.0.1:${port}/private`
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('private');
  });

  it('rechecks a trusted redirect and blocks its untrusted loopback target', async () => {
    const target = createServer((_request, response) => response.end('unsafe'));
    const targetPort = await listen(target);
    const trusted = createServer((_request, response) => {
      response.writeHead(302, { Location: `http://127.0.0.1:${targetPort}/redirect-target` });
      response.end();
    });
    const trustedPort = await listen(trusted);
    process.env.BACKEND_STORAGE_PROVIDER = 'minio';
    process.env.BACKEND_STORAGE_MINIO_ENDPOINT = '127.0.0.1';
    process.env.BACKEND_STORAGE_MINIO_PORT = String(trustedPort);

    await expect(
      createSsrfSafeFetch()(`http://127.0.0.1:${trustedPort}/trusted-redirect`)
    ).rejects.toThrow();
  });
});
