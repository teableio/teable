import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CacheService } from '../../cache/cache.service';
import type {
  ISourceImportTaskProgressReporter,
  ISourceImportTaskState,
  ISourceImportTaskSubmitInput,
} from './source-import-task.service';
import { SOURCE_IMPORT_TASK_TIMING, SourceImportTaskService } from './source-import-task.service';

/** The slice of CacheService the task service uses, with real expiry semantics. */
class FakeCache {
  readonly store = new Map<string, { value: unknown; expires: number }>();
  /** Delay applied to state writes, to hold one in flight. */
  writeDelayMs = 0;
  failWrites = false;

  private live(key: string) {
    const entry = this.store.get(key);
    if (entry && entry.expires <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key: string) {
    return structuredClone(this.live(key)?.value);
  }

  async setDetail(key: string, value: unknown, ttlSeconds: number) {
    if (this.failWrites) throw new Error('cache down');
    const copy = structuredClone(value);
    if (this.writeDelayMs) await new Promise((resolve) => setTimeout(resolve, this.writeDelayMs));
    this.store.set(key, { value: copy, expires: Date.now() + ttlSeconds * 1000 });
  }

  async setnx(key: string, value: unknown, ttlSeconds: number) {
    if (this.live(key)) return false;
    this.store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
    return true;
  }

  async del(key: string) {
    return this.store.delete(key);
  }

  async renewLock(key: string, token: string, ttlSeconds: number) {
    if (this.live(key)?.value !== token) return false;
    this.store.set(key, { value: token, expires: Date.now() + ttlSeconds * 1000 });
    return true;
  }

  async releaseLock(key: string, token: string) {
    if (this.live(key)?.value !== token) return false;
    return this.store.delete(key);
  }

  slotKeys() {
    return [...this.store.keys()].filter((key) => key.startsWith('lock:') && this.live(key));
  }
}

interface IDeferredImport {
  input: ISourceImportTaskSubmitInput<unknown>;
  runs: number;
  report: ISourceImportTaskProgressReporter;
  setBaseId: (baseId: string) => void;
  resolve: (result: unknown) => void;
  reject: (error: unknown) => void;
}

const deferredImport = (
  overrides: Partial<ISourceImportTaskSubmitInput<unknown>> = {}
): IDeferredImport => {
  const deferred = { runs: 0 } as IDeferredImport;
  deferred.input = {
    source: 'airtable',
    userId: 'usrA',
    scope: { airtableBaseId: 'appA', target: { spaceId: 'spcA' } },
    fingerprint: { airtableBaseId: 'appA', spaceId: 'spcA', baseName: 'Imported' },
    run: (report, setBaseId) => {
      deferred.runs++;
      deferred.report = report;
      deferred.setBaseId = setBaseId;
      return new Promise((resolve, reject) => {
        deferred.resolve = resolve;
        deferred.reject = reject;
      });
    },
    toFailure: (error) => ({ error: { message: (error as Error).message } }),
    ...overrides,
  };
  return deferred;
};

const result = { base: { id: 'bseNew' }, tableIdMap: { tblSource: 'tblA' } };

describe('SourceImportTaskService', () => {
  let cache: FakeCache;
  let service: SourceImportTaskService;
  /** Lets the settled import write its final state. */
  const settle = () => vi.advanceTimersByTimeAsync(0);

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new FakeCache();
    service = new SourceImportTaskService(cache as unknown as CacheService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns at once and reports the import while it runs', async () => {
    const task = deferredImport();
    const submitted = await service.submit(task.input);

    expect(submitted).toEqual({ taskId: expect.any(String), status: 'running', reused: false });
    expect(task.runs).toBe(1);
    expect(await service.get('airtable', 'usrA', submitted.taskId)).toMatchObject({
      taskId: submitted.taskId,
      status: 'running',
    });

    task.setBaseId('bseNew');
    task.report({ phase: 'creating_table', tableName: 'Orders' });
    await vi.advanceTimersByTimeAsync(SOURCE_IMPORT_TASK_TIMING.flushMs);

    const running = await service.get('airtable', 'usrA', submitted.taskId);
    expect(running).toMatchObject({
      status: 'running',
      baseId: 'bseNew',
      progress: { phase: 'creating_table', tableName: 'Orders' },
    });
    expect(running).not.toHaveProperty('result');
  });

  it('keeps the result of a finished import', async () => {
    const task = deferredImport();
    const { taskId } = await service.submit(task.input);
    task.resolve(result);
    await settle();

    expect(await service.get('airtable', 'usrA', taskId)).toMatchObject({
      status: 'completed',
      result,
    });
    // Long after the import: the result is still there for a client that comes back late.
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(await service.get('airtable', 'usrA', taskId)).toMatchObject({ status: 'completed' });
  });

  it('does not start the same import twice while it is running', async () => {
    const first = deferredImport();
    const { taskId } = await service.submit(first.input);

    const retry = deferredImport({ fingerprint: { changed: 'options' }, force: true });
    expect(await service.submit(retry.input)).toEqual({
      taskId,
      status: 'running',
      reused: true,
      sameOptions: false,
    });
    expect(retry.runs).toBe(0);

    const same = deferredImport();
    expect(await service.submit(same.input)).toMatchObject({ reused: true, sameOptions: true });
  });

  it('starts one import when the same request arrives twice at the same moment', async () => {
    const first = deferredImport();
    const second = deferredImport();
    const [a, b] = await Promise.all([service.submit(first.input), service.submit(second.input)]);

    expect(a.taskId).toBe(b.taskId);
    expect(first.runs + second.runs).toBe(1);
    expect([a.reused, b.reused].sort()).toEqual([false, true]);
  });

  it('keeps its slot for an import that outlasts the slot ttl', async () => {
    const first = deferredImport();
    const { taskId } = await service.submit(first.input);
    await vi.advanceTimersByTimeAsync(SOURCE_IMPORT_TASK_TIMING.slotTtlSeconds * 1000 * 5);

    expect(await service.get('airtable', 'usrA', taskId)).toMatchObject({ status: 'running' });
    const retry = deferredImport();
    expect(await service.submit(retry.input)).toMatchObject({ taskId, reused: true });
    expect(retry.runs).toBe(0);
  });

  it('runs different sources, users and targets side by side', async () => {
    const base = deferredImport();
    const { taskId } = await service.submit(base.input);

    for (const other of [
      deferredImport({ userId: 'usrB' }),
      deferredImport({ source: 'google-sheet' }),
      deferredImport({ scope: { airtableBaseId: 'appA', target: { spaceId: 'spcB' } } }),
      deferredImport({ scope: { airtableBaseId: 'appB', target: { spaceId: 'spcA' } } }),
    ]) {
      const submitted = await service.submit(other.input);
      expect(submitted.reused).toBe(false);
      expect(submitted.taskId).not.toBe(taskId);
      expect(other.runs).toBe(1);
    }
  });

  describe('after the import finished', () => {
    let taskId: string;

    beforeEach(async () => {
      const task = deferredImport();
      ({ taskId } = await service.submit(task.input));
      task.resolve(result);
      await settle();
    });

    it('answers a repeat of the same request with the finished import', async () => {
      const retry = deferredImport();
      expect(await service.submit(retry.input)).toEqual({
        taskId,
        status: 'completed',
        reused: true,
        sameOptions: true,
      });
      expect(retry.runs).toBe(0);
    });

    it('imports again when forced', async () => {
      const retry = deferredImport({ force: true });
      const submitted = await service.submit(retry.input);
      expect(submitted).toMatchObject({ status: 'running', reused: false });
      expect(submitted.taskId).not.toBe(taskId);
      expect(retry.runs).toBe(1);
    });

    it('imports again when the request differs', async () => {
      const retry = deferredImport({ fingerprint: { importRecords: false } });
      expect(await service.submit(retry.input)).toMatchObject({ reused: false });
      expect(retry.runs).toBe(1);
    });

    it('imports again once the repeat window has passed', async () => {
      await vi.advanceTimersByTimeAsync(
        SOURCE_IMPORT_TASK_TIMING.completedDedupeSeconds * 1000 + 1000
      );
      const retry = deferredImport();
      expect(await service.submit(retry.input)).toMatchObject({ reused: false });
      expect(retry.runs).toBe(1);
    });
  });

  it('reports a failed import and lets it be started again', async () => {
    const task = deferredImport();
    const { taskId } = await service.submit(task.input);
    task.setBaseId('bseHalf');
    task.report({ phase: 'creating_table' });
    task.reject(new Error('Airtable rejected the access token.'));
    await settle();

    const failed = await service.get('airtable', 'usrA', taskId);
    expect(failed).toMatchObject({
      status: 'failed',
      baseId: 'bseHalf',
      error: { message: 'Airtable rejected the access token.' },
    });
    expect(failed).not.toHaveProperty('result');
    expect(cache.slotKeys()).toEqual([]);

    const retry = deferredImport();
    expect(await service.submit(retry.input)).toMatchObject({ reused: false });
    expect(retry.runs).toBe(1);
  });

  it('knows the base of an import that fails before it reports any progress', async () => {
    const task = deferredImport();
    const { taskId } = await service.submit(task.input);
    // The base was just created; the very next step throws.
    task.setBaseId('bseJustCreated');
    task.reject(new Error('audit write failed'));
    await settle();

    expect(await service.get('airtable', 'usrA', taskId)).toMatchObject({
      status: 'failed',
      baseId: 'bseJustCreated',
      error: { message: 'audit write failed' },
    });
  });

  it('lets the failure say which base, if any, was left behind', async () => {
    const partial = { base: { id: 'bseKept' }, tableIdMap: { gid0: 'tblA' }, issues: [] };
    const kept = deferredImport({
      toFailure: () => ({ error: { message: 'boom', partial }, baseId: 'bseKept' }),
    });
    const removed = deferredImport({
      userId: 'usrB',
      toFailure: () => ({ error: { message: 'boom' }, baseId: null }),
    });
    const keptTask = await service.submit(kept.input);
    const removedTask = await service.submit(removed.input);
    for (const task of [kept, removed]) {
      task.setBaseId('bseCreated');
      task.reject(new Error('boom'));
    }
    await settle();

    expect(await service.get('airtable', 'usrA', keptTask.taskId)).toMatchObject({
      baseId: 'bseKept',
      error: { message: 'boom', partial },
    });
    expect(await service.get('airtable', 'usrB', removedTask.taskId)).not.toHaveProperty('baseId');
  });

  it('still fails the task when the failure cannot be described', async () => {
    const task = deferredImport({
      toFailure: () => {
        throw new Error('formatter broke');
      },
    });
    const { taskId } = await service.submit(task.input);
    task.reject(new Error('boom'));
    await settle();

    expect(await service.get('airtable', 'usrA', taskId)).toMatchObject({
      status: 'failed',
      error: { message: 'Unknown import error' },
    });
  });

  it('never lets a late progress write replace the final state', async () => {
    const task = deferredImport();
    const { taskId } = await service.submit(task.input);

    cache.writeDelayMs = 5_000;
    task.report({ phase: 'table_records_progress', processedRows: 10 });
    // The flush starts and stays in flight...
    await vi.advanceTimersByTimeAsync(SOURCE_IMPORT_TASK_TIMING.flushMs);
    // ...while the import finishes and reports once more.
    task.report({ phase: 'import_done' });
    task.resolve(result);
    await vi.advanceTimersByTimeAsync(20_000);

    expect(await service.get('airtable', 'usrA', taskId)).toMatchObject({
      status: 'completed',
      result,
      progress: { phase: 'import_done' },
    });
  });

  it('keeps importing through a cache outage', async () => {
    const task = deferredImport();
    const { taskId } = await service.submit(task.input);

    cache.failWrites = true;
    task.report({ phase: 'creating_table' });
    await vi.advanceTimersByTimeAsync(SOURCE_IMPORT_TASK_TIMING.heartbeatMs * 2);
    cache.failWrites = false;
    await vi.advanceTimersByTimeAsync(SOURCE_IMPORT_TASK_TIMING.flushMs);

    expect(await service.get('airtable', 'usrA', taskId)).toMatchObject({
      status: 'running',
      progress: { phase: 'creating_table' },
    });
    task.resolve(result);
    await settle();
    expect(await service.get('airtable', 'usrA', taskId)).toMatchObject({ status: 'completed' });
  });

  describe('when the process running the import died', () => {
    let deadTaskId: string;

    beforeEach(async () => {
      // Another instance took the import and then vanished: all that is left of
      // it is what it last wrote to the cache.
      const dead = new FakeCache();
      const task = deferredImport();
      ({ taskId: deadTaskId } = await new SourceImportTaskService(
        dead as unknown as CacheService
      ).submit(task.input));
      task.setBaseId('bseHalf');
      task.report({ phase: 'creating_table' });
      await vi.advanceTimersByTimeAsync(SOURCE_IMPORT_TASK_TIMING.flushMs);
      for (const [key, entry] of dead.store) cache.store.set(key, structuredClone(entry));
    });

    it('reports the import as interrupted once its heartbeat stops', async () => {
      await vi.advanceTimersByTimeAsync(SOURCE_IMPORT_TASK_TIMING.staleMs - 5_000);
      expect(await service.get('airtable', 'usrA', deadTaskId)).toMatchObject({
        status: 'running',
      });

      await vi.advanceTimersByTimeAsync(10_000);
      expect(await service.get('airtable', 'usrA', deadTaskId)).toMatchObject({
        status: 'failed',
        baseId: 'bseHalf',
        error: { message: expect.stringContaining('interrupted') },
      });
    });

    it('lets the import be started again without waiting for the slot to expire', async () => {
      await vi.advanceTimersByTimeAsync(SOURCE_IMPORT_TASK_TIMING.staleMs + 1_000);
      expect(cache.slotKeys()).toHaveLength(1);

      const retry = deferredImport();
      const submitted = await service.submit(retry.input);
      expect(submitted).toMatchObject({ status: 'running', reused: false });
      expect(submitted.taskId).not.toBe(deadTaskId);
      expect(retry.runs).toBe(1);
    });
  });

  it('hides a task from anyone but its owner and its own route', async () => {
    const task = deferredImport();
    const { taskId } = await service.submit(task.input);
    const notFound = { message: expect.stringContaining('not found') };

    await expect(service.get('airtable', 'usrB', taskId)).rejects.toMatchObject(notFound);
    await expect(service.get('google-sheet', 'usrA', taskId)).rejects.toMatchObject(notFound);
    await expect(service.get('airtable', 'usrA', 'imt0000000000000000')).rejects.toMatchObject(
      notFound
    );
    await expect(service.get('airtable', 'usrA', '../session')).rejects.toMatchObject(notFound);
  });

  it('stores nothing that identifies the credentials', async () => {
    const task = deferredImport();
    const { taskId } = await service.submit(task.input);
    const state = (await cache.get(`import:source-task:${taskId}`)) as ISourceImportTaskState;

    expect(Object.keys(state).sort()).toEqual(
      ['createdAt', 'fingerprint', 'id', 'source', 'status', 'updatedAt', 'userId'].sort()
    );
  });
});
