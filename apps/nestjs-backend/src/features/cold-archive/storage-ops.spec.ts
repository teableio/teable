import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type StorageAdapter from '../attachments/plugins/adapter';
import { ColdStatsCache } from './stats-cache';
import { readColdStats, readColdStatsCached } from './storage-ops';

const adapterFor = (downloadFile: () => Promise<Readable>): StorageAdapter =>
  ({
    downloadFile,
    listObjects: async () => ({ objects: [], prefixes: [] }),
  }) as unknown as StorageAdapter;

const adapterServing = (body: string): StorageAdapter =>
  adapterFor(async () => Readable.from([Buffer.from(body)]));

const adapterFailing = (error: Error): StorageAdapter =>
  adapterFor(async () => {
    throw error;
  });

const noSuchKey = Object.assign(new Error('The specified key does not exist.'), {
  name: 'NoSuchKey',
});
const connectionReset = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
const partKey = 'root/202601/part-000.ndjson.gz';

describe('readColdStats', () => {
  it('parses an existing shard', async () => {
    const stats = await readColdStats(
      adapterServing(JSON.stringify({ version: 1, parts: { [partKey]: { rows: 3 } } })),
      'bucket',
      'root/_stats.json'
    );
    expect(stats).toEqual({ version: 1, parts: { [partKey]: { rows: 3 } } });
  });

  it('reads a genuinely missing shard as empty', async () => {
    await expect(
      readColdStats(adapterFailing(noSuchKey), 'bucket', 'root/_stats.json')
    ).resolves.toBeUndefined();
  });

  it('rethrows a failed download instead of degrading to an empty shard', async () => {
    await expect(
      readColdStats(adapterFailing(connectionReset), 'bucket', 'root/_stats.json')
    ).rejects.toBe(connectionReset);
  });

  it('throws on a corrupt shard rather than rebuilding over it', async () => {
    await expect(
      readColdStats(adapterServing('{"version":1,'), 'bucket', 'root/_stats.json')
    ).rejects.toBeInstanceOf(SyntaxError);
  });

  it('refuses a shard with an unknown version', async () => {
    await expect(
      readColdStats(
        adapterServing(JSON.stringify({ version: 2, parts: {} })),
        'bucket',
        'root/_stats.json'
      )
    ).rejects.toThrow(/unsupported cold stats version 2/);
  });
});

// twin: the serving-path helper must keep degrading on the exact failures the
// maintenance-path helper propagates
describe('readColdStatsCached', () => {
  it('degrades a failed download to undefined and reports the reason', async () => {
    const reasons: string[] = [];
    await expect(
      readColdStatsCached(
        adapterFailing(connectionReset),
        'bucket',
        'root/_stats.json',
        new ColdStatsCache(),
        (reason) => reasons.push(reason)
      )
    ).resolves.toBeUndefined();
    expect(reasons).toEqual(['socket hang up']);
  });

  it('degrades an unknown version to undefined', async () => {
    await expect(
      readColdStatsCached(
        adapterServing(JSON.stringify({ version: 2, parts: {} })),
        'bucket',
        'root/_stats.json',
        new ColdStatsCache(),
        () => {}
      )
    ).resolves.toBeUndefined();
  });
});
