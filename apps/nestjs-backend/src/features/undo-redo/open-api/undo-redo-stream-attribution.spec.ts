import { context, SpanKind, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { createUndoRedoCommand, ok, TableId } from '@teable/v2-core';
import type { UndoEntry } from '@teable/v2-core';
import type { Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationName } from '../../../cache/types';
import { TEABLE_REQUEST_ATTRIBUTION } from '../../canary/v2-attribution';
import { UndoRedoController } from './undo-redo.controller';
import { UndoRedoService, X_TEABLE_UNDO_REDO_ENGINE_HEADER } from './undo-redo.service';

const tableId = `tbl${'a'.repeat(16)}`;
const windowId = 'window';

// This package targets ES2022, before Promise.withResolvers is in the TS library.
const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
};

// Exercise the real service's stack selection/fallback and the real controller's
// SSE writer. Only persistence and replay payload execution are replaced.
describe('undo/redo stream selected replay-stack attribution', () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;
  let manager: AsyncLocalStorageContextManager;

  beforeEach(() => {
    trace.disable();
    context.disable();
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    manager = new AsyncLocalStorageContextManager().enable();
    context.setGlobalContextManager(manager);
    trace.setGlobalTracerProvider(provider);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await provider.shutdown();
    manager.disable();
    trace.disable();
    context.disable();
    vi.restoreAllMocks();
  });

  const fixture = (preferred: 'v1' | 'v2', v1Present: boolean, v2Present: boolean) => {
    const store: Record<string, unknown> = {
      useV2: preferred === 'v2',
      v2Reason: preferred === 'v2' ? 'env_force_v2_all' : 'disabled',
      v2Feature: 'undoRedo',
      ['user.id']: 'actor',
    };
    const cls = {
      get: (key: string) => store[key],
      set: (key: string, value: unknown) => {
        store[key] = value;
      },
    };
    const headers: Record<string, string> = {};
    const writes: string[] = [];
    const response = {
      writableEnded: false,
      destroyed: false,
      headersSent: false,
      status: vi.fn(),
      setHeader: vi.fn((key: string, value: string) => {
        headers[key] = value;
      }),
      flushHeaders: vi.fn(() => {
        response.headersSent = true;
      }),
      on: vi.fn(),
      write: vi.fn((data: string) => {
        writes.push(data);
        return true;
      }),
      end: vi.fn(() => {
        response.writableEnded = true;
      }),
    };
    const operation = {
      name: OperationName.DeleteRecords,
      params: { tableId },
      result: { records: [] },
    };
    const pop = vi
      .fn()
      .mockResolvedValue({ operation: v1Present ? operation : undefined, push: vi.fn() });
    const replay = vi.fn(async () => {
      expect(response.headersSent).toBe(true);
      return operation;
    });
    const entry: UndoEntry = {
      scope: {
        actorId: 'actor' as never,
        tableId: TableId.create(tableId)._unsafeUnwrap(),
        windowId,
      },
      undoCommand: createUndoRedoCommand('DeleteRecords', { tableId, recordIds: [] }),
      redoCommand: createUndoRedoCommand('DeleteRecords', { tableId, recordIds: [] }),
      createdAt: new Date().toISOString(),
    };
    const v2Replay = vi.fn(async () => {
      expect(response.headersSent).toBe(false);
      return ok(v2Present ? entry : null);
    });
    const permission = vi.fn().mockResolvedValue([]);
    const service = new UndoRedoService(
      {
        getContainerForTable: vi
          .fn()
          .mockResolvedValue({ resolve: () => ({ applyUndo: v2Replay, applyRedo: v2Replay }) }),
      } as never,
      { createContext: vi.fn().mockResolvedValue({ actorId: 'actor' }) } as never,
      cls as never,
      { get: vi.fn().mockResolvedValue(preferred) } as never,
      { popUndo: pop, popRedo: pop } as never,
      { undo: replay, redo: replay } as never,
      {} as never,
      {} as never,
      { validPermissions: permission } as never
    );
    return {
      controller: new UndoRedoController(service, cls as never),
      response,
      headers,
      writes,
      store,
      replay,
      permission,
      operation,
    };
  };

  it.each(['undoStream', 'redoStream'] as const)(
    'corrects %s v2→v1 before flushing headers',
    async (method) => {
      const f = fixture('v2', true, false);
      await trace
        .getTracer('test')
        .startActiveSpan('HTTP stream', { kind: SpanKind.SERVER }, async (span) => {
          await f.controller[method](windowId, tableId, f.response as unknown as Response);
          span.end();
        });
      expect(f.replay).toHaveBeenCalledOnce();
      expect(f.headers[X_TEABLE_UNDO_REDO_ENGINE_HEADER]).toBe('v1');
      expect(f.headers['x-teable-v2']).toBe('false');
      expect(f.headers['x-teable-v2-reason']).toBe('undo_redo_engine');
      expect(f.store.useV2).toBe(false);
      expect(exporter.getFinishedSpans()[0].attributes[TEABLE_REQUEST_ATTRIBUTION]).toBe('v1');
      expect(f.writes.join('')).toContain('"engine":"v1"');
    }
  );

  it.each(['undoStream', 'redoStream'] as const)(
    'corrects %s v1→v2 rather than inheriting stale v1 attribution',
    async (method) => {
      const f = fixture('v1', false, true);
      await f.controller[method](windowId, tableId, f.response as unknown as Response);
      expect(f.replay).not.toHaveBeenCalled();
      expect(f.headers[X_TEABLE_UNDO_REDO_ENGINE_HEADER]).toBe('v2');
      expect(f.headers['x-teable-v2']).toBe('true');
      expect(f.headers['x-teable-v2-reason']).toBe('undo_redo_engine');
      expect(f.store.useV2).toBe(true);
    }
  );

  it.each([
    { preferred: 'v1', method: 'undoStream' },
    { preferred: 'v1', method: 'redoStream' },
    { preferred: 'v2', method: 'undoStream' },
    { preferred: 'v2', method: 'redoStream' },
  ] as const)(
    'opens heartbeat-capable SSE before deferred legacy $method resolves ($preferred preference)',
    async ({ preferred, method }) => {
      vi.useFakeTimers();
      const f = fixture(preferred, true, false);
      const permissionStarted = deferred<void>();
      const permissionGate = deferred<string[]>();
      const replayStarted = deferred<void>();
      const replay = deferred<typeof f.operation>();
      f.permission.mockImplementation(() => {
        permissionStarted.resolve();
        return permissionGate.promise;
      });
      f.replay.mockImplementation(() => {
        replayStarted.resolve();
        return replay.promise;
      });

      const pending = f.controller[method](windowId, tableId, f.response as unknown as Response);
      await permissionStarted.promise;
      // Nonempty alone is insufficient: permission admission must happen first.
      expect(f.response.flushHeaders).not.toHaveBeenCalled();
      expect(f.headers[X_TEABLE_UNDO_REDO_ENGINE_HEADER]).toBeUndefined();
      permissionGate.resolve([]);
      await replayStarted.promise;
      // Replay still needs the request's routing flag: archive selects its
      // row-scope-enforcing engine from CLS.
      expect(f.store.useV2).toBe(preferred === 'v2');
      expect(f.response.flushHeaders).toHaveBeenCalledOnce();
      expect(f.headers[X_TEABLE_UNDO_REDO_ENGINE_HEADER]).toBe('v1');
      expect(f.headers['x-teable-v2']).toBe('false');
      expect(f.writes).toEqual([]);

      await vi.advanceTimersByTimeAsync(15_000);
      expect(f.writes).toEqual([': ping\n\n']);
      expect(f.response.end).not.toHaveBeenCalled();
      replay.resolve(f.operation);
      await pending;
      expect(f.response.end).toHaveBeenCalledOnce();
      expect(f.store.useV2).toBe(false);
      expect(f.writes.join('')).toContain('"status":"fulfilled"');
      await vi.advanceTimersByTimeAsync(15_000);
      expect(f.writes.filter((write) => write === ': ping\n\n')).toHaveLength(1);
    }
  );

  it('does not claim execution of either engine for an empty stream', async () => {
    const f = fixture('v2', false, false);
    await trace.getTracer('test').startActiveSpan('HTTP empty stream', async (span) => {
      await f.controller.undoStream(windowId, tableId, f.response as unknown as Response);
      span.end();
    });
    expect(f.headers[X_TEABLE_UNDO_REDO_ENGINE_HEADER]).toBeUndefined();
    expect(f.headers['x-teable-v2-reason']).toBeUndefined();
    expect(exporter.getFinishedSpans()[0].attributes[TEABLE_REQUEST_ATTRIBUTION]).toBeUndefined();
    expect(f.writes.join('')).toContain('"status":"empty"');
  });
});
