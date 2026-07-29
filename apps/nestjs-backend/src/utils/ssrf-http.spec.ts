import { createServer, type Server } from 'node:http';
import { READ_PATH } from '@teable/openapi';
import { ATTACHMENT_READ_PATH } from '@teable/v2-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { safeFetch } from './ssrf-http';

/**
 * Exercises the wrapper against a real loopback server (a non-public peer):
 * it must reject it unless the trusted-read bypass or the env opt-out applies.
 */
describe('ssrf-http wrappers', () => {
  let server: Server;
  let port: number;

  beforeEach(
    () =>
      new Promise<void>((resolve) => {
        server = createServer((_req, res) => {
          res.writeHead(200);
          res.end('ok');
        });
        server.listen(0, '127.0.0.1', () => {
          port = (server.address() as { port: number }).port;
          resolve();
        });
      })
  );

  afterEach(async () => {
    delete process.env.TEABLE_SSRF_PROTECTION_DISABLED;
    delete process.env.PUBLIC_ORIGIN;
    delete process.env.STORAGE_PREFIX;
    delete process.env.PORT;
    delete process.env.BACKEND_STORAGE_PROVIDER;
    delete process.env.BACKEND_STORAGE_MINIO_ENDPOINT;
    delete process.env.BACKEND_STORAGE_MINIO_PORT;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe('safeFetch', () => {
    it('rejects a fetch to a loopback address', async () => {
      await expect(safeFetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
    });

    it('rejects a fetch to the link-local cloud-metadata address', async () => {
      // 169.254.169.254 is filtered before connecting, so this never hangs.
      await expect(safeFetch('http://169.254.169.254/latest/meta-data/')).rejects.toThrow();
    });

    it('preserves caller init while baking in the agent', async () => {
      await expect(
        safeFetch(`http://127.0.0.1:${port}/`, { method: 'POST', body: '{}' })
      ).rejects.toThrow();
    });

    it('reaches the loopback server when SSRF protection is disabled (env parity)', async () => {
      process.env.TEABLE_SSRF_PROTECTION_DISABLED = 'true';
      const res = await safeFetch(`http://127.0.0.1:${port}/`);
      expect(res.status).toBe(200);
    });

    it('reaches a loopback attachment-read URL when its origin is first-party', async () => {
      // The server's own read endpoint, reached via the configured origin.
      process.env.PUBLIC_ORIGIN = `http://127.0.0.1:${port}`;
      const res = await safeFetch(`http://127.0.0.1:${port}/api/attachments/read/bucket/a.csv`);
      expect(res.status).toBe(200);
    });

    it('trusts every path on the exact PUBLIC_ORIGIN', async () => {
      process.env.PUBLIC_ORIGIN = `http://127.0.0.1:${port}`;
      const res = await safeFetch(`http://127.0.0.1:${port}/api/table`);
      expect(res.status).toBe(200);
    });

    it('re-evaluates a PUBLIC_ORIGIN redirect on a different origin', async () => {
      process.env.PUBLIC_ORIGIN = `http://127.0.0.1:${port}`;
      server.removeAllListeners('request');
      server.on('request', (req, res) => {
        if (req.url === '/redirect') {
          // Same peer and port, but localhost is not the configured origin.
          res.writeHead(302, { Location: `http://localhost:${port}/target` });
          res.end();
          return;
        }
        res.writeHead(200);
        res.end('internal');
      });

      await expect(safeFetch(`http://127.0.0.1:${port}/redirect`)).rejects.toThrow();
    });

    it('rejects an attachment-read URL on an untrusted origin (SSRF fix)', async () => {
      // No first-party origin configured → the read-path bypass no longer
      // applies, so the attacker-controlled host is dispatched through the
      // SSRF agent and the non-public peer is blocked at connect time. This is
      // the hop that previously slipped through unfiltered (incl. any 3xx
      // redirect to a private/metadata address).
      await expect(
        safeFetch(`http://127.0.0.1:${port}/api/attachments/read/bucket/a.csv`)
      ).rejects.toThrow();
    });

    it('rejects when path traversal escapes the attachment-read path', async () => {
      await expect(
        safeFetch(`http://127.0.0.1:${port}/api/attachments/read/../../admin`)
      ).rejects.toThrow();
    });

    it('reaches a presigned-style URL on the configured storage endpoint (private MinIO)', async () => {
      // Private-MinIO deployment shape: the storage endpoint resolves to a
      // loopback address and presigned URLs carry /bucket/key paths.
      process.env.BACKEND_STORAGE_PROVIDER = 'minio';
      process.env.BACKEND_STORAGE_MINIO_ENDPOINT = '127.0.0.1';
      process.env.BACKEND_STORAGE_MINIO_PORT = String(port);
      const res = await safeFetch(`http://127.0.0.1:${port}/private/table/a.csv?X-Amz-Signature=x`);
      expect(res.status).toBe(200);
    });

    it('rejects a presigned-style URL when no storage endpoint is configured', async () => {
      await expect(
        safeFetch(`http://127.0.0.1:${port}/private/table/a.csv?X-Amz-Signature=x`)
      ).rejects.toThrow();
    });

    it('follows redirects within PUBLIC_ORIGIN', async () => {
      process.env.PUBLIC_ORIGIN = `http://127.0.0.1:${port}`;
      server.removeAllListeners('request');
      server.on('request', (req, res) => {
        if (req.url?.startsWith('/api/attachments/read/')) {
          res.writeHead(302, { Location: `http://127.0.0.1:${port}/admin` });
          res.end();
          return;
        }
        res.writeHead(200);
        res.end('internal');
      });
      const res = await safeFetch(`http://127.0.0.1:${port}/api/attachments/read/x`);
      expect(res.status).toBe(200);
    });
  });

  // Pins the v2 literal against READ_PATH, since v2 packages cannot depend on
  // @teable/openapi. The trust-model vectors for the shared predicate live in
  // @teable/v2-utils' fetch.spec.ts — the only thing this app can test that v2
  // cannot is this alignment.
  it('v2 ATTACHMENT_READ_PATH stays aligned with @teable/openapi READ_PATH', () => {
    expect(ATTACHMENT_READ_PATH).toBe(READ_PATH);
  });
});
