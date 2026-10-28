import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  PGLITE_DATA_DIR_LOCKED_CODE,
  PgliteDataDirLockedError,
  acquirePgliteDataDirLock,
} from './pgliteDataDirLock';

const roots: string[] = [];

const createRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'pglite-data-dir-lock-'));
  roots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('acquirePgliteDataDirLock', () => {
  it('is a no-op for in-memory and browser-indexed data dirs', async () => {
    await expect(acquirePgliteDataDirLock('memory://')).resolves.toBeUndefined();
    await expect(acquirePgliteDataDirLock('idb://teable')).resolves.toBeUndefined();
  });

  it('reports a typed locked error for a second owner of the same directory', async () => {
    const dataDir = join(await createRoot(), 'data');
    const lock = await acquirePgliteDataDirLock(dataDir);
    expect(lock).toBeDefined();

    const error: unknown = await acquirePgliteDataDirLock(dataDir).catch((caught) => caught);

    if (!(error instanceof PgliteDataDirLockedError)) {
      throw new Error(`expected a PgliteDataDirLockedError, received ${String(error)}`);
    }
    expect(error.code).toBe(PGLITE_DATA_DIR_LOCKED_CODE);
    expect(error.message).not.toContain(dataDir);

    await lock?.release();
  });

  it('locks the canonical path, so equivalent spellings contend too', async () => {
    const root = await createRoot();
    const dataDir = join(root, 'data');
    const lock = await acquirePgliteDataDirLock(dataDir);
    expect(lock).toBeDefined();

    const aliased = join(root, 'data', '..', 'data');
    await expect(acquirePgliteDataDirLock(aliased)).rejects.toBeInstanceOf(
      PgliteDataDirLockedError
    );

    await lock?.release();
  });

  it('can be acquired again after release', async () => {
    const dataDir = join(await createRoot(), 'data');
    const first = await acquirePgliteDataDirLock(dataDir);
    expect(first).toBeDefined();
    await first?.release();

    const second = await acquirePgliteDataDirLock(dataDir);
    expect(second).toBeDefined();
    await second?.release();
  });

  it('release is idempotent', async () => {
    const dataDir = join(await createRoot(), 'data');
    const lock = await acquirePgliteDataDirLock(dataDir);
    expect(lock).toBeDefined();

    await lock?.release();
    await expect(lock?.release()).resolves.toBeUndefined();
  });

  it('does not serialize distinct directories', async () => {
    const root = await createRoot();
    const first = await acquirePgliteDataDirLock(join(root, 'first'));
    const second = await acquirePgliteDataDirLock(join(root, 'second'));

    expect(first).toBeDefined();
    expect(second).toBeDefined();

    await Promise.all([first?.release(), second?.release()]);
  });

  it('locks the directory behind a file:// url, including equivalent spellings', async () => {
    const root = await createRoot();
    const dataDir = join(root, 'data');
    const lock = await acquirePgliteDataDirLock(pathToFileURL(dataDir).href);
    expect(lock).toBeDefined();
    // The url must resolve to the real directory, not a literal `file:` path.
    await expect(stat(`${dataDir}.lock`)).resolves.toBeDefined();
    await expect(stat(join(process.cwd(), 'file:'))).rejects.toThrow();

    const aliased = pathToFileURL(join(root, 'data', '..', 'data')).href;
    await expect(acquirePgliteDataDirLock(aliased)).rejects.toBeInstanceOf(
      PgliteDataDirLockedError
    );

    await lock?.release();
  });

  it('does not create a directory for an opfs-ahp url', async () => {
    await expect(acquirePgliteDataDirLock('opfs-ahp://teable-opfs')).resolves.toBeUndefined();

    await expect(stat(join(process.cwd(), 'opfs-ahp:'))).rejects.toThrow();
  });
});
