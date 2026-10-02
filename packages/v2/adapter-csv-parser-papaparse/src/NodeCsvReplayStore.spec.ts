import { mkdtemp, readdir, rm, stat, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CsvReplayStore } from './CsvReplayStore';
import { createNodeCsvReplayStore } from './NodeCsvReplayStore';

const replay = async (store: CsvReplayStore) => {
  const chunks: string[] = [];
  for await (const chunk of store.read()) chunks.push(chunk);
  return chunks;
};

const onlyEntry = async (directory: string) => {
  const entries = await readdir(directory);
  const entry = entries[0];
  if (entries.length !== 1 || !entry) throw new Error('Expected one owned replay entry');
  return join(directory, entry);
};

describe('NodeCsvReplayStore', () => {
  let root: string;
  let store: CsvReplayStore | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'teable-csv-replay-test-'));
    store = undefined;
  });

  afterEach(async () => {
    try {
      await store?.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('replays exact UTF-16 chunks twice from private temporary storage', async () => {
    store = await createNodeCsvReplayStore({ temporaryDirectory: root });
    const chunks = ['', '\ufeffName,备注\r\n', '你好\0😀', '\ud83d', '\ude00', 'x'.repeat(65_536)];
    for (const chunk of chunks) await store.append(chunk);

    expect(await replay(store)).toEqual(chunks);
    expect(await replay(store)).toEqual(chunks);
    const directory = await onlyEntry(root);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(await onlyEntry(directory))).mode & 0o777).toBe(0o600);

    await store.dispose();
    expect(await readdir(root)).toEqual([]);
  });

  it('allows the owner to remove storage after an early replay return and dispose again', async () => {
    store = await createNodeCsvReplayStore({ temporaryDirectory: root });
    await store.append('first');
    await store.append('unconsumed');
    try {
      for await (const chunk of store.read()) {
        expect(chunk).toBe('first');
        break;
      }
    } finally {
      await store.dispose();
    }

    await store.dispose();
    expect(await readdir(root)).toEqual([]);
    await expect(store.append('late')).rejects.toThrow('disposed');
  });

  it('rejects truncated replay data and removes its temporary storage', async () => {
    store = await createNodeCsvReplayStore({ temporaryDirectory: root });
    await store.append('complete before truncation');
    const file = await onlyEntry(await onlyEntry(root));
    await truncate(file, (await stat(file)).size - 1);

    await expect(replay(store)).rejects.toThrow('truncated');
    expect(await readdir(root)).toEqual([]);
  });

  it('rejects an oversized chunk without leaving temporary storage behind', async () => {
    store = await createNodeCsvReplayStore({ temporaryDirectory: root });
    await store.append('already committed');

    await expect(store.append('x'.repeat(65_537))).rejects.toThrow('65536');
    expect(await readdir(root)).toEqual([]);
  });
});
