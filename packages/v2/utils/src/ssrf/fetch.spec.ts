import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createSsrfSafeFetch,
  createTrustedUrlPredicate,
  isBlockedAddress,
  isTrustedInternalReadUrl,
} from './fetch';

const appOrigin = 'https://app.example.com';

describe('isBlockedAddress', () => {
  it('blocks loopback, private, link-local, unique-local, and multicast', () => {
    expect(isBlockedAddress('127.0.0.1')).toBe(true);
    expect(isBlockedAddress('10.0.0.5')).toBe(true);
    expect(isBlockedAddress('192.168.1.1')).toBe(true);
    expect(isBlockedAddress('172.16.0.1')).toBe(true);
    expect(isBlockedAddress('169.254.169.254')).toBe(true); // cloud metadata
    expect(isBlockedAddress('::1')).toBe(true);
    expect(isBlockedAddress('fc00::1')).toBe(true); // unique-local
    expect(isBlockedAddress('224.0.0.1')).toBe(true); // multicast
  });

  it('allows public unicast addresses', () => {
    expect(isBlockedAddress('8.8.8.8')).toBe(false);
    expect(isBlockedAddress('1.1.1.1')).toBe(false);
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false);
  });

  it('fails closed on unparseable input', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true);
    expect(isBlockedAddress('')).toBe(true);
  });
});

describe('isTrustedInternalReadUrl', () => {
  const allowedOrigins = [appOrigin, 'http://localhost:3000'];
  const readOnApp = `${appOrigin}/api/attachments/read/x`;
  const readOnLocalhost = 'http://localhost:3000/api/attachments/read/x';
  const readOnAttacker = 'https://attacker.example/api/attachments/read/x';

  it('trusts the attachment-read path only on an allowed origin', () => {
    expect(isTrustedInternalReadUrl(readOnApp, allowedOrigins)).toBe(true);
    expect(isTrustedInternalReadUrl(readOnLocalhost, allowedOrigins)).toBe(true);
  });

  it('rejects the attachment-read path on an attacker origin (the SSRF fix)', () => {
    expect(isTrustedInternalReadUrl(readOnAttacker, allowedOrigins)).toBe(false);
  });

  it('rejects non-read paths even on an allowed origin', () => {
    expect(isTrustedInternalReadUrl('https://app.example.com/admin', allowedOrigins)).toBe(false);
    // bare endpoint without a trailing segment is not a read URL
    expect(
      isTrustedInternalReadUrl('https://app.example.com/api/attachments/read', allowedOrigins)
    ).toBe(false);
  });

  it('normalizes path traversal before matching', () => {
    // resolves to /admin → not under the read path
    expect(
      isTrustedInternalReadUrl(
        'https://app.example.com/api/attachments/read/../../admin',
        allowedOrigins
      )
    ).toBe(false);
  });

  it('fails closed on an empty allow-list and on unparseable input', () => {
    expect(isTrustedInternalReadUrl(readOnApp)).toBe(false);
    expect(isTrustedInternalReadUrl(readOnApp, [])).toBe(false);
    expect(isTrustedInternalReadUrl('not a url', allowedOrigins)).toBe(false);
  });
});

describe('createTrustedUrlPredicate', () => {
  afterEach(() => {
    delete process.env.PUBLIC_ORIGIN;
    delete process.env.STORAGE_PREFIX;
    delete process.env.TEABLE_SSRF_TRUSTED_ORIGINS;
    delete process.env.PORT;
    delete process.env.BACKEND_STORAGE_PROVIDER;
    delete process.env.BACKEND_STORAGE_PUBLIC_URL;
    delete process.env.BACKEND_STORAGE_PRIVATE_BUCKET_ENDPOINT;
    delete process.env.BACKEND_STORAGE_MINIO_ENDPOINT;
    delete process.env.BACKEND_STORAGE_MINIO_INTERNAL_ENDPOINT;
    delete process.env.BACKEND_STORAGE_MINIO_PORT;
    delete process.env.BACKEND_STORAGE_MINIO_INTERNAL_PORT;
    delete process.env.BACKEND_STORAGE_MINIO_USE_SSL;
    delete process.env.BACKEND_STORAGE_S3_ENDPOINT;
    delete process.env.BACKEND_STORAGE_S3_INTERNAL_ENDPOINT;
  });

  it('trusts PUBLIC_ORIGIN by default', () => {
    process.env.PUBLIC_ORIGIN = 'http://app.internal:3000';
    const isTrusted = createTrustedUrlPredicate();

    expect(isTrusted('http://app.internal:3000/api/table')).toBe(true);
    expect(isTrusted('http://app.internal:3001/api/table')).toBe(false);
  });

  it('trusts exact origins configured through the environment', () => {
    process.env.TEABLE_SSRF_TRUSTED_ORIGINS =
      ' http://erp.internal:8080,invalid-url,https://hooks.internal ';
    const isTrusted = createTrustedUrlPredicate();

    expect(isTrusted('http://erp.internal:8080/api')).toBe(true);
    expect(isTrusted('https://hooks.internal/webhook')).toBe(true);
    expect(isTrusted('http://erp.internal:8081/api')).toBe(false);
    expect(isTrusted('http://hooks.internal/webhook')).toBe(false);
  });

  it('keeps read origins path-scoped', () => {
    process.env.STORAGE_PREFIX = 'http://files.internal/prefix';
    const isTrusted = createTrustedUrlPredicate();

    expect(isTrusted('http://files.internal/api/attachments/read/file')).toBe(true);
    expect(isTrusted('http://files.internal/admin')).toBe(false);
  });

  it('keeps the local service origin path-scoped', () => {
    process.env.PORT = '3000';
    const isTrusted = createTrustedUrlPredicate();

    expect(isTrusted('http://localhost:3000/api/attachments/read/file')).toBe(true);
    expect(isTrusted('http://localhost:3000/admin')).toBe(false);
  });

  it('trusts configured storage origins without caller injection', () => {
    process.env.BACKEND_STORAGE_PROVIDER = 'minio';
    process.env.BACKEND_STORAGE_PUBLIC_URL = 'https://files.example.com/public';
    process.env.BACKEND_STORAGE_PRIVATE_BUCKET_ENDPOINT = 'https://private.example.com';
    process.env.BACKEND_STORAGE_MINIO_ENDPOINT = 'minio.internal';
    process.env.BACKEND_STORAGE_MINIO_PORT = '9443';
    process.env.BACKEND_STORAGE_MINIO_USE_SSL = 'true';
    process.env.BACKEND_STORAGE_MINIO_INTERNAL_ENDPOINT = 'minio-internal';
    const isTrusted = createTrustedUrlPredicate();

    expect(isTrusted('https://files.example.com/public/a.csv')).toBe(true);
    expect(isTrusted('https://private.example.com/table/a.csv')).toBe(true);
    expect(isTrusted('https://minio.internal:9443/private/a.csv')).toBe(true);
    expect(isTrusted('http://minio-internal:9000/private/a.csv')).toBe(true);
    expect(isTrusted('http://minio.internal:9443/private/a.csv')).toBe(false);
    expect(isTrusted('https://other.internal:9443/private/a.csv')).toBe(false);
  });

  it('trusts S3-compatible endpoints only when a remote provider is enabled', () => {
    process.env.BACKEND_STORAGE_S3_ENDPOINT = 'https://s3.internal';
    process.env.BACKEND_STORAGE_S3_INTERNAL_ENDPOINT = 'http://s3-internal:9000';

    expect(createTrustedUrlPredicate()('http://s3-internal:9000/private/a.csv')).toBe(false);

    process.env.BACKEND_STORAGE_PROVIDER = 's3';
    const isTrusted = createTrustedUrlPredicate();
    expect(isTrusted('https://s3.internal/private/a.csv')).toBe(true);
    expect(isTrusted('http://s3-internal:9000/private/a.csv')).toBe(true);
    expect(isTrusted('https://s3-internal:9000/private/a.csv')).toBe(false);
  });
});

describe('createSsrfSafeFetch', () => {
  afterEach(() => {
    delete process.env.TEABLE_SSRF_PROTECTION_DISABLED;
    delete process.env.PUBLIC_ORIGIN;
    delete process.env.STORAGE_PREFIX;
    delete process.env.PORT;
    delete process.env.BACKEND_STORAGE_PROVIDER;
    delete process.env.BACKEND_STORAGE_MINIO_ENDPOINT;
    delete process.env.BACKEND_STORAGE_MINIO_PORT;
  });

  describe('dispatcher enforcement (loopback test server)', () => {
    let server: Server;
    let port: number;

    const startServer = () =>
      new Promise<void>((resolve) => {
        server = createServer((_req, res) => {
          res.writeHead(200);
          res.end('ok');
        });
        server.listen(0, '127.0.0.1', () => {
          port = (server.address() as { port: number }).port;
          resolve();
        });
      });

    afterEach(
      () =>
        new Promise<void>((resolve) => {
          server?.close(() => resolve());
        })
    );

    it('blocks a fetch to the loopback test server', async () => {
      await startServer();
      const safeFetch = createSsrfSafeFetch();
      await expect(safeFetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
    });

    it('passes through to plain fetch when SSRF protection is disabled (env opt-out parity)', async () => {
      await startServer();
      process.env.TEABLE_SSRF_PROTECTION_DISABLED = 'true';
      const safeFetch = createSsrfSafeFetch();
      const res = await safeFetch(`http://127.0.0.1:${port}/`);
      expect(res.status).toBe(200);
    });

    it('fails closed on the read path when no first-party origin is configured', async () => {
      await startServer();
      const safeFetch = createSsrfSafeFetch();
      await expect(
        safeFetch(`http://127.0.0.1:${port}/api/attachments/read/bucket/a.csv`)
      ).rejects.toThrow();
    });

    it('allows any path on PUBLIC_ORIGIN', async () => {
      await startServer();
      process.env.PUBLIC_ORIGIN = `http://127.0.0.1:${port}`;
      const safeFetch = createSsrfSafeFetch();
      const res = await safeFetch(`http://127.0.0.1:${port}/api/table`);
      expect(res.status).toBe(200);
    });

    it('honors trusted origins configured after the fetch was created', async () => {
      await startServer();
      // Hosts register the fetch during container bootstrap, before the final
      // listen port is known (e2e apps bind port 0 and set env afterwards).
      const safeFetch = createSsrfSafeFetch();
      await expect(
        safeFetch(`http://127.0.0.1:${port}/api/attachments/read/bucket/a.csv`)
      ).rejects.toThrow();
      process.env.STORAGE_PREFIX = `http://127.0.0.1:${port}`;
      const res = await safeFetch(`http://127.0.0.1:${port}/api/attachments/read/bucket/a.csv`);
      expect(res.status).toBe(200);
    });

    it('allows a presigned-style fetch to a trusted storage origin on loopback', async () => {
      await startServer();
      // Private-MinIO shape: the storage endpoint resolves to a loopback
      // address and presigned URLs carry /bucket/key paths.
      process.env.BACKEND_STORAGE_PROVIDER = 'minio';
      process.env.BACKEND_STORAGE_MINIO_ENDPOINT = '127.0.0.1';
      process.env.BACKEND_STORAGE_MINIO_PORT = String(port);
      const safeFetch = createSsrfSafeFetch();
      const res = await safeFetch(`http://127.0.0.1:${port}/private/table/a.csv?X-Amz-Signature=x`);
      expect(res.status).toBe(200);
    });

    it('follows redirect hops within the trusted storage origin', async () => {
      await startServer();
      server.removeAllListeners('request');
      server.on('request', (req, res) => {
        if (req.url === '/private/redirect') {
          res.writeHead(302, { Location: `http://127.0.0.1:${port}/private/target` });
          res.end();
          return;
        }
        res.writeHead(200);
        res.end('ok');
      });
      process.env.BACKEND_STORAGE_PROVIDER = 'minio';
      process.env.BACKEND_STORAGE_MINIO_ENDPOINT = '127.0.0.1';
      process.env.BACKEND_STORAGE_MINIO_PORT = String(port);
      const safeFetch = createSsrfSafeFetch();
      const res = await safeFetch(`http://127.0.0.1:${port}/private/redirect`);
      expect(res.status).toBe(200);
    });

    it('follows redirects within PUBLIC_ORIGIN', async () => {
      await startServer();
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
      const safeFetch = createSsrfSafeFetch();
      const res = await safeFetch(`http://127.0.0.1:${port}/api/attachments/read/x`);
      expect(res.status).toBe(200);
    });

    it('re-checks redirect hops: a trusted storage 3xx cannot pivot to an untrusted origin', async () => {
      await startServer();
      // Second loopback listener on another port = an untrusted origin.
      const second = createServer((_req, res) => {
        res.writeHead(200);
        res.end('internal');
      });
      await new Promise<void>((resolve) => second.listen(0, '127.0.0.1', () => resolve()));
      const secondPort = (second.address() as { port: number }).port;
      try {
        server.removeAllListeners('request');
        server.on('request', (_req, res) => {
          res.writeHead(302, { Location: `http://127.0.0.1:${secondPort}/steal` });
          res.end();
        });
        process.env.BACKEND_STORAGE_PROVIDER = 'minio';
        process.env.BACKEND_STORAGE_MINIO_ENDPOINT = '127.0.0.1';
        process.env.BACKEND_STORAGE_MINIO_PORT = String(port);
        const safeFetch = createSsrfSafeFetch();
        await expect(safeFetch(`http://127.0.0.1:${port}/private/table/a.csv`)).rejects.toThrow();
      } finally {
        await new Promise<void>((resolve) => second.close(() => resolve()));
      }
    });
  });
});
