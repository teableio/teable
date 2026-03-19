import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { domainError } from '../../domain/shared/DomainError';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldKeyType } from '../../domain/table/fields/FieldKeyType';
import { FieldName } from '../../domain/table/fields/FieldName';
import { FieldUnique } from '../../domain/table/fields/types/FieldUnique';
import type { Table } from '../../domain/table/Table';
import { Table as TableAggregate } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { ILogger, LogContext } from '../../ports/Logger';
import { DefaultTableMapper } from '../../ports/mappers/defaults/DefaultTableMapper';
import {
  RecordWriteOperationKind,
  type IRecordWritePlugin,
  type RecordWritePluginContextMap,
} from '../../ports/RecordWritePlugin';
import type { ISpan, ITracer, SpanAttributes } from '../../ports/Tracer';
import { TeableSpanAttributes } from '../../ports/Tracer';
import { RecordWritePluginRunner } from './RecordWritePluginRunner';

const tableMapper = new DefaultTableMapper();

const createTable = (tableId = 'tblTraceRecordWrite'): Table =>
  ({
    id: () => ({
      toString: () => tableId,
    }),
    clone: () => ok(createTable(tableId)),
  }) as unknown as Table;

const createLiveTable = (seed: string): Table => {
  const baseId = BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();
  const fieldId = FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();
  const builder = TableAggregate.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create(`Table ${seed}`)._unsafeUnwrap());

  builder
    .field()
    .singleLineText()
    .withId(fieldId)
    .withName(FieldName.create(`Name ${seed}`)._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();

  return builder.build()._unsafeUnwrap();
};

const createContext = (tracer?: ITracer): RecordWritePluginContextMap['createOne'] => ({
  kind: RecordWriteOperationKind.createOne,
  executionContext: {
    actorId: ActorId.create('system')._unsafeUnwrap(),
    tracer,
  } as IExecutionContext,
  table: createTable(),
  payload: {
    fieldValues: new Map(),
    fieldKeyType: FieldKeyType.Id,
    typecast: false,
    source: { type: 'user' },
    recordCount: 1 as const,
  },
  isTransactionBound: false,
});

class FakeLogger implements ILogger {
  readonly errors: Array<{ message: string; context?: LogContext }> = [];

  child(): ILogger {
    return this;
  }

  scope(): ILogger {
    return this;
  }

  debug(): void {
    return undefined;
  }

  info(): void {
    return undefined;
  }

  warn(): void {
    return undefined;
  }

  error(message: string, context?: LogContext): void {
    this.errors.push({ message, context });
  }
}

class FakeSpan implements ISpan {
  readonly errors: string[] = [];
  ended = false;

  constructor(
    readonly name: string,
    readonly attributes?: SpanAttributes
  ) {}

  setAttribute(key: string, value: string | number | boolean): void {
    this.setAttributes({ [key]: value });
  }

  setAttributes(attributes: SpanAttributes): void {
    if (!this.attributes) {
      return;
    }

    Object.assign(this.attributes as Record<string, string | number | boolean>, attributes);
  }

  recordError(message: string): void {
    this.errors.push(message);
  }

  end(): void {
    this.ended = true;
  }
}

class FakeTracer implements ITracer {
  readonly spans: Array<{ name: string; attributes?: SpanAttributes; span: FakeSpan }> = [];
  private readonly activeSpans: FakeSpan[] = [];

  startSpan(name: string, attributes?: SpanAttributes): ISpan {
    const span = new FakeSpan(name, attributes ? { ...attributes } : undefined);
    this.spans.push({ name, attributes: span.attributes, span });
    return span;
  }

  async withSpan<T>(span: ISpan, callback: () => Promise<T>): Promise<T> {
    this.activeSpans.push(span as FakeSpan);
    try {
      return await callback();
    } finally {
      this.activeSpans.pop();
    }
  }

  getActiveSpan(): ISpan | undefined {
    return this.activeSpans[this.activeSpans.length - 1];
  }
}

const getActiveSpanName = (tracer?: ITracer): string => {
  return (tracer?.getActiveSpan() as FakeSpan | undefined)?.name ?? 'missing';
};

const createDeferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

describe('RecordWritePluginRunner', () => {
  it('orders plugins by enforce then registration order', async () => {
    const calls: string[] = [];
    const plugin = (name: string, enforce?: 'pre' | 'post'): IRecordWritePlugin => ({
      name,
      enforce,
      supports: () => true,
      guard: () => {
        calls.push(name);
        return ok(undefined);
      },
    });

    const runner = new RecordWritePluginRunner(
      [plugin('default-a'), plugin('post', 'post'), plugin('pre', 'pre'), plugin('default-b')],
      new FakeLogger(),
      tableMapper
    );

    const execution = (await runner.prepare(createContext()))._unsafeUnwrap();
    const result = await execution.guard();

    expect(result.isOk()).toBe(true);
    expect(calls).toEqual(['pre', 'default-a', 'default-b', 'post']);
  });

  it('filters plugins with supports', async () => {
    const calls: string[] = [];
    const runner = new RecordWritePluginRunner(
      [
        {
          name: 'create-only',
          supports: (operation) => operation === RecordWriteOperationKind.createOne,
          guard: () => {
            calls.push('create-only');
            return ok(undefined);
          },
        },
        {
          name: 'update-only',
          supports: (operation) => operation === RecordWriteOperationKind.updateOne,
          guard: () => {
            calls.push('update-only');
            return ok(undefined);
          },
        },
      ],
      new FakeLogger(),
      tableMapper
    );

    const execution = (await runner.prepare(createContext()))._unsafeUnwrap();
    const result = await execution.guard();

    expect(result.isOk()).toBe(true);
    expect(calls).toEqual(['create-only']);
  });

  it('keeps prepared state private to the owning plugin', async () => {
    const seenStates: Array<{ plugin: string; state: unknown }> = [];
    const runner = new RecordWritePluginRunner(
      [
        {
          name: 'alpha',
          supports: () => true,
          prepare: () => ok({ token: 'alpha-state' }),
          guard: (_context, preparedState) => {
            seenStates.push({ plugin: 'alpha', state: preparedState });
            return ok(undefined);
          },
        },
        {
          name: 'beta',
          supports: () => true,
          prepare: () => ok({ token: 'beta-state' }),
          guard: (_context, preparedState) => {
            seenStates.push({ plugin: 'beta', state: preparedState });
            return ok(undefined);
          },
        },
      ],
      new FakeLogger(),
      tableMapper
    );

    const execution = (await runner.prepare(createContext()))._unsafeUnwrap();
    const result = await execution.guard();

    expect(result.isOk()).toBe(true);
    expect(seenStates).toEqual([
      { plugin: 'alpha', state: { token: 'alpha-state' } },
      { plugin: 'beta', state: { token: 'beta-state' } },
    ]);
  });

  it('returns the first guard error in group order and skips later enforce groups', async () => {
    const calls: string[] = [];
    const runner = new RecordWritePluginRunner(
      [
        {
          name: 'pre',
          enforce: 'pre',
          supports: () => true,
          guard: () => {
            calls.push('pre');
            return ok(undefined);
          },
        },
        {
          name: 'stop',
          supports: () => true,
          guard: () => {
            calls.push('stop');
            return err(
              domainError.validation({
                code: 'plugin.guard_blocked',
                message: 'blocked',
              })
            );
          },
        },
        {
          name: 'same-group',
          supports: () => true,
          guard: () => {
            calls.push('same-group');
            return err(
              domainError.validation({
                code: 'plugin.guard_blocked_later',
                message: 'blocked later',
              })
            );
          },
        },
        {
          name: 'post',
          enforce: 'post',
          supports: () => true,
          guard: () => {
            calls.push('post');
            return ok(undefined);
          },
        },
      ],
      new FakeLogger(),
      tableMapper
    );

    const execution = (await runner.prepare(createContext()))._unsafeUnwrap();
    const result = await execution.guard();

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('plugin.guard_blocked');
    expect(calls).toEqual(['pre', 'stop', 'same-group']);
  });

  it('short-circuits beforePersist on the first plugin error', async () => {
    const calls: string[] = [];
    const runner = new RecordWritePluginRunner(
      [
        {
          name: 'first',
          supports: () => true,
          beforePersist: () => {
            calls.push('first');
            return ok(undefined);
          },
        },
        {
          name: 'stop',
          supports: () => true,
          beforePersist: () => {
            calls.push('stop');
            return err(
              domainError.validation({
                code: 'plugin.before_persist_blocked',
                message: 'blocked',
              })
            );
          },
        },
        {
          name: 'never',
          supports: () => true,
          beforePersist: () => {
            calls.push('never');
            return ok(undefined);
          },
        },
      ],
      new FakeLogger(),
      tableMapper
    );

    const execution = (await runner.prepare(createContext()))._unsafeUnwrap();
    const result = await execution.beforePersist({
      actorId: ActorId.create('system')._unsafeUnwrap(),
      transaction: { kind: 'unitOfWorkTransaction' },
    } as IExecutionContext);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('plugin.before_persist_blocked');
    expect(calls).toEqual(['first', 'stop']);
  });

  it('runs beforePersist serially in enforce order', async () => {
    const calls: string[] = [];
    const plugin = (name: string, enforce?: 'pre' | 'post'): IRecordWritePlugin => ({
      name,
      enforce,
      supports: () => true,
      beforePersist: () => {
        calls.push(name);
        return ok(undefined);
      },
    });

    const runner = new RecordWritePluginRunner(
      [plugin('default-a'), plugin('post', 'post'), plugin('pre', 'pre'), plugin('default-b')],
      new FakeLogger(),
      tableMapper
    );

    const execution = (await runner.prepare(createContext()))._unsafeUnwrap();
    const result = await execution.beforePersist({
      actorId: ActorId.create('system')._unsafeUnwrap(),
      transaction: { kind: 'unitOfWorkTransaction' },
    } as IExecutionContext);

    expect(result.isOk()).toBe(true);
    expect(calls).toEqual(['pre', 'default-a', 'default-b', 'post']);
  });

  it('preserves plugin instance binding for phase hooks', async () => {
    const calls: string[] = [];

    class BoundPlugin implements IRecordWritePlugin {
      readonly name = 'bound';

      supports(): boolean {
        return true;
      }

      guard(): ReturnType<NonNullable<IRecordWritePlugin['guard']>> {
        calls.push(this.name);
        return ok(undefined);
      }

      beforePersist(): ReturnType<NonNullable<IRecordWritePlugin['beforePersist']>> {
        calls.push(this.name);
        return ok(undefined);
      }
    }

    const runner = new RecordWritePluginRunner([new BoundPlugin()], new FakeLogger(), tableMapper);

    const execution = (await runner.prepare(createContext()))._unsafeUnwrap();
    const guardResult = await execution.guard();
    const beforePersistResult = await execution.beforePersist({
      actorId: ActorId.create('system')._unsafeUnwrap(),
      transaction: { kind: 'unitOfWorkTransaction' },
    } as IExecutionContext);

    expect(guardResult.isOk()).toBe(true);
    expect(beforePersistResult.isOk()).toBe(true);
    expect(calls).toEqual(['bound', 'bound']);
  });

  it('logs afterCommit failures without failing the command path', async () => {
    const logger = new FakeLogger();
    const runner = new RecordWritePluginRunner(
      [
        {
          name: 'returns-error',
          supports: () => true,
          afterCommit: () =>
            err(
              domainError.infrastructure({
                code: 'plugin.after_commit_failed',
                message: 'after commit failed',
              })
            ),
        },
        {
          name: 'throws',
          supports: () => true,
          afterCommit: () => {
            throw new Error('boom');
          },
        },
      ],
      logger,
      tableMapper
    );

    const execution = (await runner.prepare(createContext()))._unsafeUnwrap();
    await execution.afterCommit();

    expect(logger.errors).toHaveLength(2);
    expect(logger.errors[0]?.message).toBe('Record write plugin afterCommit failed');
    expect(logger.errors[0]?.context?.plugin).toBe('returns-error');
    expect(logger.errors[1]?.context?.plugin).toBe('throws');
  });

  it('runs prepare and guard in parallel within an enforce group and waits between groups', async () => {
    const prePrepareStartedA = createDeferred<void>();
    const prePrepareStartedB = createDeferred<void>();
    const prePrepareGate = createDeferred<void>();
    const defaultPrepareStarted = createDeferred<void>();
    let defaultPrepareDidStart = false;

    const preGuardStartedA = createDeferred<void>();
    const preGuardStartedB = createDeferred<void>();
    const preGuardGate = createDeferred<void>();
    const defaultGuardStarted = createDeferred<void>();
    let defaultGuardDidStart = false;

    const runner = new RecordWritePluginRunner(
      [
        {
          name: 'pre-a',
          enforce: 'pre',
          supports: () => true,
          prepare: async () => {
            prePrepareStartedA.resolve();
            await prePrepareGate.promise;
            return ok('pre-a');
          },
          guard: async () => {
            preGuardStartedA.resolve();
            await preGuardGate.promise;
            return ok(undefined);
          },
        },
        {
          name: 'pre-b',
          enforce: 'pre',
          supports: () => true,
          prepare: async () => {
            prePrepareStartedB.resolve();
            await prePrepareGate.promise;
            return ok('pre-b');
          },
          guard: async () => {
            preGuardStartedB.resolve();
            await preGuardGate.promise;
            return ok(undefined);
          },
        },
        {
          name: 'default',
          supports: () => true,
          prepare: async () => {
            defaultPrepareDidStart = true;
            defaultPrepareStarted.resolve();
            return ok('default');
          },
          guard: async () => {
            defaultGuardDidStart = true;
            defaultGuardStarted.resolve();
            return ok(undefined);
          },
        },
      ],
      new FakeLogger(),
      tableMapper
    );

    const preparePromise = runner.prepare(createContext());
    await Promise.all([prePrepareStartedA.promise, prePrepareStartedB.promise]);
    expect(defaultPrepareDidStart).toBe(false);

    prePrepareGate.resolve();
    await defaultPrepareStarted.promise;

    const execution = (await preparePromise)._unsafeUnwrap();
    const guardPromise = execution.guard();

    await Promise.all([preGuardStartedA.promise, preGuardStartedB.promise]);
    expect(defaultGuardDidStart).toBe(false);

    preGuardGate.resolve();
    await defaultGuardStarted.promise;

    expect((await guardPromise).isOk()).toBe(true);
  });

  it('runs afterCommit in parallel within an enforce group and waits between groups', async () => {
    const preAfterCommitStartedA = createDeferred<void>();
    const preAfterCommitStartedB = createDeferred<void>();
    const preAfterCommitGate = createDeferred<void>();
    const defaultAfterCommitStarted = createDeferred<void>();
    let defaultAfterCommitDidStart = false;

    const runner = new RecordWritePluginRunner(
      [
        {
          name: 'pre-a',
          enforce: 'pre',
          supports: () => true,
          afterCommit: async () => {
            preAfterCommitStartedA.resolve();
            await preAfterCommitGate.promise;
            return ok(undefined);
          },
        },
        {
          name: 'pre-b',
          enforce: 'pre',
          supports: () => true,
          afterCommit: async () => {
            preAfterCommitStartedB.resolve();
            await preAfterCommitGate.promise;
            return ok(undefined);
          },
        },
        {
          name: 'default',
          supports: () => true,
          afterCommit: async () => {
            defaultAfterCommitDidStart = true;
            defaultAfterCommitStarted.resolve();
            return ok(undefined);
          },
        },
      ],
      new FakeLogger(),
      tableMapper
    );

    const execution = (await runner.prepare(createContext()))._unsafeUnwrap();
    const afterCommitPromise = execution.afterCommit();

    await Promise.all([preAfterCommitStartedA.promise, preAfterCommitStartedB.promise]);
    expect(defaultAfterCommitDidStart).toBe(false);

    preAfterCommitGate.resolve();
    await defaultAfterCommitStarted.promise;
    await afterCommitPromise;
  });

  it('creates plugin spans, attaches trace context, and preserves plugin attributes', async () => {
    const tracer = new FakeTracer();
    const activePhaseSpans: string[] = [];
    const activeCustomSpans: string[] = [];
    let traceActiveSpanName: string | undefined;
    let preparedState: unknown;

    const runner = new RecordWritePluginRunner(
      [
        {
          name: 'traceable',
          supports: () => true,
          prepare: async (context) => {
            traceActiveSpanName = (context.trace?.activeSpan as FakeSpan | undefined)?.name;
            activePhaseSpans.push(getActiveSpanName(context.executionContext.tracer));
            return (
              (await context.trace?.withSpan('customPrepare', async () => {
                activeCustomSpans.push(getActiveSpanName(context.executionContext.tracer));
                return ok({ token: 'prepared' });
              })) ?? ok({ token: 'prepared' })
            );
          },
          guard: async (context, state) => {
            preparedState = state;
            activePhaseSpans.push(getActiveSpanName(context.executionContext.tracer));
            await context.trace?.withSpan('customGuard', async () => {
              activeCustomSpans.push(getActiveSpanName(context.executionContext.tracer));
              return ok(undefined);
            });
            return ok(undefined);
          },
          beforePersist: async (context) => {
            activePhaseSpans.push(getActiveSpanName(context.executionContext.tracer));
            return ok(undefined);
          },
          afterCommit: async (context) => {
            activePhaseSpans.push(getActiveSpanName(context.executionContext.tracer));
            await context.trace?.withSpan('customAfterCommit', async () => {
              activeCustomSpans.push(getActiveSpanName(context.executionContext.tracer));
              return ok(undefined);
            });
            return ok(undefined);
          },
        },
      ],
      new FakeLogger(),
      tableMapper
    );

    const execution = (await runner.prepare(createContext(tracer)))._unsafeUnwrap();
    expect((await execution.guard()).isOk()).toBe(true);
    expect(
      (
        await execution.beforePersist({
          actorId: ActorId.create('system')._unsafeUnwrap(),
          tracer,
          transaction: { kind: 'unitOfWorkTransaction' },
        } as IExecutionContext)
      ).isOk()
    ).toBe(true);
    await execution.afterCommit();

    expect(traceActiveSpanName).toBe('teable.recordWritePlugin.prepare');
    expect(preparedState).toEqual({ token: 'prepared' });
    expect(activePhaseSpans).toEqual([
      'teable.recordWritePlugin.prepare',
      'teable.recordWritePlugin.guard',
      'teable.recordWritePlugin.beforePersist',
      'teable.recordWritePlugin.afterCommit',
    ]);
    expect(activeCustomSpans).toEqual([
      'teable.recordWritePlugin.traceable.customPrepare',
      'teable.recordWritePlugin.traceable.customGuard',
      'teable.recordWritePlugin.traceable.customAfterCommit',
    ]);
    expect(tracer.spans.map((span) => span.name)).toEqual([
      'teable.recordWritePlugin.supports',
      'teable.recordWritePlugin.prepare',
      'teable.recordWritePlugin.traceable.customPrepare',
      'teable.recordWritePlugin.guard',
      'teable.recordWritePlugin.traceable.customGuard',
      'teable.recordWritePlugin.beforePersist',
      'teable.recordWritePlugin.afterCommit',
      'teable.recordWritePlugin.traceable.customAfterCommit',
    ]);

    const guardSpan = tracer.spans.find((span) => span.name === 'teable.recordWritePlugin.guard');
    expect(guardSpan?.attributes).toMatchObject({
      [TeableSpanAttributes.COMPONENT]: 'plugin',
      [TeableSpanAttributes.OPERATION]: 'recordWritePlugin.guard',
      [TeableSpanAttributes.PLUGIN]: 'traceable',
      [TeableSpanAttributes.PLUGIN_TYPE]: 'record_write',
      [TeableSpanAttributes.PLUGIN_PHASE]: 'guard',
      [TeableSpanAttributes.OPERATION_KIND]: RecordWriteOperationKind.createOne,
      [TeableSpanAttributes.TABLE_ID]: 'tblTraceRecordWrite',
      [TeableSpanAttributes.IS_TRANSACTION_BOUND]: false,
    });

    const beforePersistSpan = tracer.spans.find(
      (span) => span.name === 'teable.recordWritePlugin.beforePersist'
    );
    expect(beforePersistSpan?.attributes?.[TeableSpanAttributes.IS_TRANSACTION_BOUND]).toBe(true);

    const customGuardSpan = tracer.spans.find(
      (span) => span.name === 'teable.recordWritePlugin.traceable.customGuard'
    );
    expect(customGuardSpan?.attributes).toMatchObject({
      [TeableSpanAttributes.PLUGIN]: 'traceable',
      [TeableSpanAttributes.PLUGIN_TYPE]: 'record_write',
      [TeableSpanAttributes.PLUGIN_PHASE]: 'guard',
      [TeableSpanAttributes.OPERATION]: 'recordWritePlugin.guard.customGuard',
    });
  });

  it('passes a detached table snapshot to each plugin hook', async () => {
    const liveTable = createLiveTable('r');
    const originalField = liveTable.getFields()[0]!;
    const observedUniqueStates: boolean[] = [];
    const seenTables: Table[] = [];
    const runner = new RecordWritePluginRunner(
      [
        {
          name: 'mutates-clone',
          supports: () => true,
          prepare: async (context) => {
            seenTables.push(context.table);
            const field = context.table.getFields()[0]!;
            observedUniqueStates.push(field.unique().toBoolean());
            field.setUnique(FieldUnique.enabled())._unsafeUnwrap();
            return ok(undefined);
          },
        },
        {
          name: 'sees-clean-clone',
          supports: () => true,
          prepare: async (context) => {
            seenTables.push(context.table);
            observedUniqueStates.push(context.table.getFields()[0]!.unique().toBoolean());
            return ok(undefined);
          },
          guard: async (context) => {
            seenTables.push(context.table);
            observedUniqueStates.push(context.table.getFields()[0]!.unique().toBoolean());
            return ok(undefined);
          },
        },
      ],
      new FakeLogger(),
      tableMapper
    );

    const execution = (
      await runner.prepare({
        ...createContext(),
        table: liveTable,
      })
    )._unsafeUnwrap();
    expect((await execution.guard()).isOk()).toBe(true);

    expect(observedUniqueStates).toEqual([false, false, false]);
    expect(originalField.unique().toBoolean()).toBe(false);
    expect(seenTables.every((table) => table !== liveTable)).toBe(true);
  });
});
