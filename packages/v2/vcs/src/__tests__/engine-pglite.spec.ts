import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ICommandBus, IQueryBus } from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { vcsDomainError } from '../domain/errors';
import { PgliteLocalEngineAdapter, type IVcsPgliteRuntime } from '../pglite';

const createMockRuntime = (): {
  runtime: IVcsPgliteRuntime;
  readyMock: ReturnType<typeof vi.fn>;
  flushMock: ReturnType<typeof vi.fn>;
  closeMock: ReturnType<typeof vi.fn>;
  queryExecuteMock: ReturnType<typeof vi.fn>;
} => {
  const readyMock = vi.fn(async () => undefined);
  const flushMock = vi.fn(async () => undefined);
  const closeMock = vi.fn(async () => undefined);
  const queryExecuteMock = vi.fn(async () =>
    err(
      vcsDomainError.notFound({
        code: 'base.not_found',
        message: 'Base not found',
      })
    )
  );
  const runtime: IVcsPgliteRuntime = {
    commandBus: {
      execute: vi.fn(async () => ok(undefined)),
    } as unknown as ICommandBus,
    queryBus: {
      execute: queryExecuteMock,
    } as unknown as IQueryBus,
    ready: readyMock,
    flushComputed: flushMock,
    close: closeMock,
  };
  return { runtime, readyMock, flushMock, closeMock, queryExecuteMock };
};

describe('pglite: PgliteLocalEngineAdapter unit tests', () => {
  const createdDirs: string[] = [];

  afterEach(async () => {
    for (const dir of createdDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('requires runtime or both dataDir and createRuntime when capturing snapshot', async () => {
    const adapterMissingFactory = new PgliteLocalEngineAdapter({ dataDir: 'memory://' });
    const res = await adapterMissingFactory.captureSnapshot('bseMissingFactory001');
    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().code).toBe('vcs.pglite_config_invalid');
  });

  it('returns false on hasBase without calling createRuntime when PG_VERSION is absent', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'v2-vcs-pglite-unit-'));
    createdDirs.push(rootDir);
    const pgliteDir = join(rootDir, '.teable', 'vcs', 'pglite');
    const createRuntime = vi.fn();
    const adapter = new PgliteLocalEngineAdapter({ dataDir: pgliteDir, createRuntime });

    const res = await adapter.hasBase('bseNoDir0000000001');
    expect(res.isOk()).toBe(true);
    expect(res._unsafeUnwrap()).toBe(false);
    expect(createRuntime).not.toHaveBeenCalled();
  });

  it('invokes injected createRuntime, readies and closes owned runtime when PG_VERSION exists', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'v2-vcs-pglite-unit-'));
    createdDirs.push(rootDir);
    const pgliteDir = join(rootDir, '.teable', 'vcs', 'pglite');
    await mkdir(pgliteDir, { recursive: true });
    await writeFile(join(pgliteDir, 'PG_VERSION'), '16\n');

    const { runtime, readyMock, closeMock } = createMockRuntime();
    const createRuntime = vi.fn(async () => runtime);
    const adapter = new PgliteLocalEngineAdapter({ dataDir: pgliteDir, createRuntime });

    const res = await adapter.hasBase('bseMissingBase0001');
    expect(res.isOk()).toBe(true);
    expect(res._unsafeUnwrap()).toBe(false);
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(readyMock).toHaveBeenCalledTimes(1);
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('reuses injected runtime without closing it and cleans up pglite dir on reset', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'v2-vcs-pglite-unit-'));
    createdDirs.push(rootDir);
    const pgliteDir = join(rootDir, '.teable', 'vcs', 'pglite');
    await mkdir(pgliteDir, { recursive: true });
    await writeFile(join(pgliteDir, 'PG_VERSION'), '16\n');
    await writeFile(`${pgliteDir}.lock`, 'lock');

    const { runtime, readyMock, closeMock } = createMockRuntime();
    const adapter = new PgliteLocalEngineAdapter({ dataDir: pgliteDir, runtime });

    const hasRes = await adapter.hasBase('bseMissingBase0001');
    expect(hasRes.isOk()).toBe(true);
    expect(readyMock).toHaveBeenCalledTimes(1);
    expect(closeMock).not.toHaveBeenCalled();

    const resetRes = await adapter.reset();
    expect(resetRes.isOk()).toBe(true);
    await expect(stat(pgliteDir)).rejects.toThrow();
    await expect(stat(`${pgliteDir}.lock`)).rejects.toThrow();
  });
});
