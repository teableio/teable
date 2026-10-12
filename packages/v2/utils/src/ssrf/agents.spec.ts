import { createServer, type Server } from 'node:http';
import fetch from 'node-fetch';
import { describe, it, expect, afterEach } from 'vitest';
import {
  createCloudMetadataRejectingLookup,
  getSafeAxiosAgents,
  getSafeFetchAgent,
  isCloudMetadataAddress,
} from './agents';

describe('getSafeAxiosAgents', () => {
  afterEach(() => {
    delete process.env.TEABLE_SSRF_PROTECTION_DISABLED;
  });

  it('should return both agents', () => {
    const agents = getSafeAxiosAgents();
    expect(agents.httpAgent).toBeDefined();
    expect(agents.httpsAgent).toBeDefined();
  });

  it('should return empty object when SSRF protection is disabled', () => {
    process.env.TEABLE_SSRF_PROTECTION_DISABLED = 'true';
    expect(getSafeAxiosAgents()).toEqual({});
  });

  it('should return same cached object', () => {
    expect(getSafeAxiosAgents()).toBe(getSafeAxiosAgents());
  });
});

describe('getSafeFetchAgent', () => {
  afterEach(() => {
    delete process.env.TEABLE_SSRF_PROTECTION_DISABLED;
  });

  it('returns undefined when SSRF protection is disabled (env opt-out parity)', () => {
    process.env.TEABLE_SSRF_PROTECTION_DISABLED = 'true';
    expect(getSafeFetchAgent()).toBeUndefined();
  });

  it('returns a per-url agent selector that picks the protocol-matching agent', () => {
    const selector = getSafeFetchAgent();
    expect(typeof selector).toBe('function');

    const httpAgent = selector!(new URL('http://example.com/file.csv'));
    const httpsAgent = selector!(new URL('https://example.com/file.csv'));

    expect((httpAgent as unknown as { protocol: string }).protocol).toBe('http:');
    expect((httpsAgent as unknown as { protocol: string }).protocol).toBe('https:');
  });

  it('rejects a fetch to a loopback address (filtered before connecting)', async () => {
    const agent = getSafeFetchAgent();
    // request-filtering-agent rejects loopback at connection time, so this
    // never actually connects — no hang on the closed port.
    await expect(fetch('http://127.0.0.1:9/teapot', { agent })).rejects.toThrow();
  });

  it('rejects a fetch to the link-local cloud-metadata address', async () => {
    const agent = getSafeFetchAgent();
    await expect(fetch('http://169.254.169.254/latest/meta-data/', { agent })).rejects.toThrow();
  });

  describe('allowPrivateNetwork (self-hosted peers)', () => {
    let server: Server | undefined;
    afterEach(
      () =>
        new Promise<void>((resolve) => {
          server ? server.close(() => resolve()) : resolve();
          server = undefined;
        })
    );

    it('reaches a loopback server', async () => {
      const port = await new Promise<number>((resolve) => {
        server = createServer((_req, res) => {
          res.writeHead(200);
          res.end('ok');
        });
        server.listen(0, '127.0.0.1', () => resolve((server!.address() as { port: number }).port));
      });
      const agent = getSafeFetchAgent({ allowPrivateNetwork: true });
      const res = await fetch(`http://127.0.0.1:${port}/`, { agent });
      expect(res.status).toBe(200);
    });

    it('reaches a server by hostname, not only by IP literal', async () => {
      const port = await new Promise<number>((resolve) => {
        server = createServer((_req, res) => {
          res.writeHead(200);
          res.end('ok');
        });
        server.listen(0, '127.0.0.1', () => resolve((server!.address() as { port: number }).port));
      });
      const agent = getSafeFetchAgent({ allowPrivateNetwork: true });
      const res = await fetch(`http://localhost:${port}/`, { agent });
      expect(res.status).toBe(200);
    });

    it.each([
      'http://169.254.169.254/latest/meta-data/',
      'http://[::ffff:169.254.169.254]/latest/meta-data/',
      'http://[fd00:ec2::254]/latest/meta-data/',
      'http://100.100.100.200/latest/meta-data/',
    ])('still rejects the cloud-metadata literal %s before connecting', async (url) => {
      const agent = getSafeFetchAgent({ allowPrivateNetwork: true });
      await expect(fetch(url, { agent })).rejects.toThrow(/cloud metadata/);
    });

    it('rejects a hostname that resolves to a cloud-metadata address', async () => {
      const lookup = createCloudMetadataRejectingLookup((_hostname, _options, callback) =>
        callback(null, '169.254.169.254', 4)
      );
      const result = await new Promise<Error | null>((resolve) =>
        lookup('metadata.internal', {}, (err) => resolve(err))
      );
      expect(result?.message).toMatch(/cloud metadata/);
    });

    it('passes other resolutions through, including the `all` form', async () => {
      const lookup = createCloudMetadataRejectingLookup((_hostname, _options, callback) =>
        callback(null, [{ address: '10.0.0.8', family: 4 }], undefined)
      );
      const result = await new Promise<unknown>((resolve) =>
        lookup('idp.internal', { all: true }, (err, address) => resolve(err ?? address))
      );
      expect(result).toEqual([{ address: '10.0.0.8', family: 4 }]);
    });
  });
});

describe('isCloudMetadataAddress', () => {
  it.each(['169.254.169.254', '169.254.0.23', 'fe80::1', 'fd00:ec2::254', '100.100.100.200'])(
    'flags %s',
    (address) => expect(isCloudMetadataAddress(address)).toBe(true)
  );
  it.each(['10.0.0.8', '127.0.0.1', '192.168.1.1', '8.8.8.8', '2001:db8::1', 'fd00::1'])(
    'admits %s',
    (address) => expect(isCloudMetadataAddress(address)).toBe(false)
  );
  it('fails closed on garbage', () => {
    expect(isCloudMetadataAddress('not-an-ip')).toBe(true);
  });
});
