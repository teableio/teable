import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { ActorId } from '../../domain/shared/ActorId';
import { domainError } from '../../domain/shared/DomainError';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { ITableReadModel } from '../../domain/table/ITableReadModel';
import type { ITableRecordConditionSpecVisitor } from '../../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { TableRecord } from '../../domain/table/records/TableRecord';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { ILogger, LogContext } from '../../ports/Logger';
import {
  RecordQueryOperationKind,
  type IRecordQueryPlugin,
  type RecordQueryPluginContextMap,
  type RecordQueryPluginScope,
} from '../../ports/RecordQueryPlugin';
import { RecordQueryPluginRunner } from './RecordQueryPluginRunner';

const createTable = (tableId = 'tblTraceRecordQuery'): ITableReadModel =>
  ({
    id: () => ({
      toString: () => tableId,
    }),
  }) as unknown as ITableReadModel;

const createListContext = (): RecordQueryPluginContextMap['list'] => ({
  kind: RecordQueryOperationKind.list,
  executionContext: {
    actorId: ActorId.create('system')._unsafeUnwrap(),
  } as IExecutionContext,
  table: createTable(),
  payload: {
    limit: 100,
    offset: 0,
  },
});

class FakeLogger implements ILogger {
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

  error(_message: string, _context?: LogContext): void {
    return undefined;
  }
}

const createFakeSpec = (
  label: string
): ISpecification<TableRecord, ITableRecordConditionSpecVisitor> =>
  ({
    label,
    isSatisfiedBy: () => true,
    mutate: () => {
      throw new Error('not implemented');
    },
    accept: () => {
      throw new Error('not implemented');
    },
  }) as unknown as ISpecification<TableRecord, ITableRecordConditionSpecVisitor>;

describe('RecordQueryPluginRunner', () => {
  it('returns undefined scope when no plugins are registered', async () => {
    const runner = new RecordQueryPluginRunner([], new FakeLogger());
    const execution = (await runner.prepare(createListContext()))._unsafeUnwrap();

    await expect(execution.guard()).resolves.toEqual(ok(undefined));
    expect(execution.getScope()).toEqual(ok(undefined));
  });

  it('merges recordSpec with AND and intersects readableFieldIds', async () => {
    const specA = createFakeSpec('a');
    const specB = createFakeSpec('b');

    const pluginA: IRecordQueryPlugin = {
      name: 'pluginA',
      enforce: 'pre',
      supports: () => true,
      scope: () =>
        ok({
          recordSpec: specA,
          readableFieldIds: new Set(['fldA', 'fldB', 'fldC']),
        } satisfies RecordQueryPluginScope),
    };

    const pluginB: IRecordQueryPlugin = {
      name: 'pluginB',
      supports: () => true,
      scope: () =>
        ok({
          recordSpec: specB,
          readableFieldIds: new Set(['fldB', 'fldC', 'fldD']),
        } satisfies RecordQueryPluginScope),
    };

    const runner = new RecordQueryPluginRunner([pluginA, pluginB], new FakeLogger());
    const execution = (await runner.prepare(createListContext()))._unsafeUnwrap();
    const scope = execution.getScope()._unsafeUnwrap();

    expect(scope?.readableFieldIds).toEqual(new Set(['fldB', 'fldC']));
    expect(scope?.recordSpec).toBeDefined();
    // AndSpec composition: not the same object as a single input
    expect(scope?.recordSpec).not.toBe(specA);
    expect(scope?.recordSpec).not.toBe(specB);
  });

  it('fails closed when any plugin guard returns an error', async () => {
    const allowPlugin: IRecordQueryPlugin = {
      name: 'allow',
      supports: () => true,
      guard: () => ok(undefined),
    };
    const denyPlugin: IRecordQueryPlugin = {
      name: 'deny',
      enforce: 'pre',
      supports: () => true,
      guard: () =>
        err(
          domainError.forbidden({
            code: 'record.query.denied',
            message: 'No read access',
          })
        ),
    };

    const runner = new RecordQueryPluginRunner([allowPlugin, denyPlugin], new FakeLogger());
    const execution = (await runner.prepare(createListContext()))._unsafeUnwrap();
    const guardResult = await execution.guard();

    expect(guardResult.isErr()).toBe(true);
    if (guardResult.isErr()) {
      expect(guardResult.error.message).toContain('No read access');
    }
  });

  it('skips plugins by name via runner options', async () => {
    const skipped: IRecordQueryPlugin = {
      name: 'skipped',
      supports: () => true,
      scope: () =>
        ok({
          readableFieldIds: new Set(['fldOnlySkipped']),
        }),
    };
    const kept: IRecordQueryPlugin = {
      name: 'kept',
      supports: () => true,
      scope: () =>
        ok({
          readableFieldIds: new Set(['fldKept']),
        }),
    };

    const runner = new RecordQueryPluginRunner([skipped, kept], new FakeLogger());
    const execution = (
      await runner.prepare(createListContext(), {
        runnerOptions: { skipPluginNames: new Set(['skipped']) },
      })
    )._unsafeUnwrap();

    expect(execution.getScope()._unsafeUnwrap()?.readableFieldIds).toEqual(new Set(['fldKept']));
  });

  it('merges fieldMasks for the same fieldId with AND visibility', async () => {
    const maskA = createFakeSpec('maskA');
    const maskB = createFakeSpec('maskB');

    const pluginA: IRecordQueryPlugin = {
      name: 'a',
      supports: () => true,
      scope: () =>
        ok({
          fieldMasks: [{ fieldId: 'fldX', visibleWhen: maskA }],
        }),
    };
    const pluginB: IRecordQueryPlugin = {
      name: 'b',
      supports: () => true,
      scope: () =>
        ok({
          fieldMasks: [{ fieldId: 'fldX', visibleWhen: maskB }],
        }),
    };

    const runner = new RecordQueryPluginRunner([pluginA, pluginB], new FakeLogger());
    const scope = (await runner.prepare(createListContext()))
      ._unsafeUnwrap()
      .getScope()
      ._unsafeUnwrap();

    expect(scope?.fieldMasks).toHaveLength(1);
    expect(scope?.fieldMasks?.[0]?.fieldId).toBe('fldX');
    expect(scope?.fieldMasks?.[0]?.visibleWhen).toBeDefined();
    expect(scope?.fieldMasks?.[0]?.visibleWhen).not.toBe(maskA);
  });

  it('keeps legacy permission compatibility only when every restricting plugin declares it', async () => {
    const compatiblePlugin: IRecordQueryPlugin = {
      name: 'compatible',
      supports: () => true,
      scope: () =>
        ok({
          readableFieldIds: new Set(['fldA']),
          legacyPermissionQueryCompatible: true,
        }),
    };
    const incompatiblePlugin: IRecordQueryPlugin = {
      name: 'incompatible',
      supports: () => true,
      scope: () =>
        ok({
          recordSpec: createFakeSpec('tenant'),
        }),
    };

    const compatibleScope = (
      await new RecordQueryPluginRunner([compatiblePlugin], new FakeLogger()).prepare(
        createListContext()
      )
    )
      ._unsafeUnwrap()
      .getScope()
      ._unsafeUnwrap();
    const mixedScope = (
      await new RecordQueryPluginRunner(
        [compatiblePlugin, incompatiblePlugin],
        new FakeLogger()
      ).prepare(createListContext())
    )
      ._unsafeUnwrap()
      .getScope()
      ._unsafeUnwrap();

    expect(compatibleScope?.legacyPermissionQueryCompatible).toBe(true);
    expect(mixedScope?.legacyPermissionQueryCompatible).toBeUndefined();
  });

  it('preserves empty readableFieldIds as deny-all fields (not unrestricted)', async () => {
    const plugin: IRecordQueryPlugin = {
      name: 'denyAllFields',
      supports: () => true,
      scope: () =>
        ok({
          readableFieldIds: new Set<string>(),
        }),
    };

    const runner = new RecordQueryPluginRunner([plugin], new FakeLogger());
    const scope = (await runner.prepare(createListContext()))
      ._unsafeUnwrap()
      .getScope()
      ._unsafeUnwrap();

    expect(scope?.readableFieldIds).toEqual(new Set());
    expect(scope?.readableFieldIds).not.toBeUndefined();
  });

  it('intersects empty readableFieldIds with a non-empty allow-list to empty', async () => {
    const empty: IRecordQueryPlugin = {
      name: 'empty',
      supports: () => true,
      scope: () => ok({ readableFieldIds: new Set<string>() }),
    };
    const partial: IRecordQueryPlugin = {
      name: 'partial',
      supports: () => true,
      scope: () => ok({ readableFieldIds: new Set(['fldA', 'fldB']) }),
    };

    const runner = new RecordQueryPluginRunner([empty, partial], new FakeLogger());
    const scope = (await runner.prepare(createListContext()))
      ._unsafeUnwrap()
      .getScope()
      ._unsafeUnwrap();

    expect(scope?.readableFieldIds).toEqual(new Set());
  });

  it('applies forceReadableFieldIds within a single plugin before allow-list merge', async () => {
    const plugin: IRecordQueryPlugin = {
      name: 'scoped',
      supports: () => true,
      scope: () =>
        ok({
          readableFieldIds: new Set(['fldA']),
          forceReadableFieldIds: new Set(['fldPrimary']),
        }),
    };

    const runner = new RecordQueryPluginRunner([plugin], new FakeLogger());
    const scope = (await runner.prepare(createListContext()))
      ._unsafeUnwrap()
      .getScope()
      ._unsafeUnwrap();

    expect(scope?.readableFieldIds).toEqual(new Set(['fldA', 'fldPrimary']));
    expect(scope?.forceReadableFieldIds).toEqual(new Set(['fldPrimary']));
  });

  it('does not let one plugin skipRecordSpec erase another plugin row filter', async () => {
    const tenantSpec = createFakeSpec('tenant');
    const uxPlugin: IRecordQueryPlugin = {
      name: 'uxKeepPrimary',
      supports: () => true,
      scope: () =>
        ok({
          skipRecordSpec: true,
          forceReadableFieldIds: new Set(['fldPrimary']),
        }),
    };
    const tenantPlugin: IRecordQueryPlugin = {
      name: 'tenantIsolation',
      supports: () => true,
      scope: () =>
        ok({
          recordSpec: tenantSpec,
          readableFieldIds: new Set(['fldA', 'fldPrimary']),
        }),
    };

    const runner = new RecordQueryPluginRunner([uxPlugin, tenantPlugin], new FakeLogger());
    const scope = (await runner.prepare(createListContext()))
      ._unsafeUnwrap()
      .getScope()
      ._unsafeUnwrap();

    expect(scope?.recordSpec).toBe(tenantSpec);
    expect(scope?.skipRecordSpec).toBeUndefined();
    expect(scope?.readableFieldIds).toEqual(new Set(['fldA', 'fldPrimary']));
  });

  it('does not let forceReadable re-open fields denied by another plugin', async () => {
    const forcePlugin: IRecordQueryPlugin = {
      name: 'forcePrimary',
      supports: () => true,
      scope: () =>
        ok({
          readableFieldIds: new Set(['fldSecret']),
          forceReadableFieldIds: new Set(['fldSecret']),
        }),
    };
    const denyPlugin: IRecordQueryPlugin = {
      name: 'denyAll',
      supports: () => true,
      scope: () =>
        ok({
          readableFieldIds: new Set<string>(),
        }),
    };

    const runner = new RecordQueryPluginRunner([forcePlugin, denyPlugin], new FakeLogger());
    const scope = (await runner.prepare(createListContext()))
      ._unsafeUnwrap()
      .getScope()
      ._unsafeUnwrap();

    expect(scope?.readableFieldIds).toEqual(new Set());
  });

  it('keeps query masks outside the response readable allow-list', async () => {
    const maskKeep = createFakeSpec('keep');
    const maskDrop = createFakeSpec('drop');
    const plugin: IRecordQueryPlugin = {
      name: 'masked',
      supports: () => true,
      scope: () =>
        ok({
          readableFieldIds: new Set(['fldKeep']),
          fieldMasks: [
            { fieldId: 'fldKeep', visibleWhen: maskKeep },
            { fieldId: 'fldDrop', visibleWhen: maskDrop },
          ],
        }),
    };

    const runner = new RecordQueryPluginRunner([plugin], new FakeLogger());
    const scope = (await runner.prepare(createListContext()))
      ._unsafeUnwrap()
      .getScope()
      ._unsafeUnwrap();

    expect(scope?.fieldMasks?.map((mask) => mask.fieldId)).toEqual(['fldKeep', 'fldDrop']);
  });

  it('ignores plugins that do not support the operation kind', async () => {
    const listOnly: IRecordQueryPlugin = {
      name: 'listOnly',
      supports: (kind) => kind === RecordQueryOperationKind.list,
      scope: () => ok({ readableFieldIds: new Set(['fldList']) }),
    };
    const getOneOnly: IRecordQueryPlugin = {
      name: 'getOneOnly',
      supports: (kind) => kind === RecordQueryOperationKind.getOne,
      scope: () => ok({ readableFieldIds: new Set(['fldGetOne']) }),
    };

    const runner = new RecordQueryPluginRunner([listOnly, getOneOnly], new FakeLogger());
    const scope = (await runner.prepare(createListContext()))
      ._unsafeUnwrap()
      .getScope()
      ._unsafeUnwrap();

    expect(scope?.readableFieldIds).toEqual(new Set(['fldList']));
  });

  it('does not clone the table aggregate when preparing plugins', async () => {
    const table = createTable();
    const seenTables: ITableReadModel[] = [];
    const runner = new RecordQueryPluginRunner(
      [
        {
          name: 'first',
          supports: () => true,
          prepare: async (context) => {
            seenTables.push(context.table);
            return ok(undefined);
          },
        },
        {
          name: 'second',
          supports: () => true,
          prepare: async (context) => {
            seenTables.push(context.table);
            return ok(undefined);
          },
          guard: async () => ok(undefined),
        },
      ],
      new FakeLogger()
    );

    const execution = (
      await runner.prepare({
        ...createListContext(),
        table,
      })
    )._unsafeUnwrap();
    expect(execution.getScope().isOk()).toBe(true);

    expect(seenTables).toEqual([table, table]);
    expect(seenTables[0]).toBe(table);
  });
});
