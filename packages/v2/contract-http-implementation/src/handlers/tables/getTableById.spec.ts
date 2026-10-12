import {
  ActorId,
  BaseId,
  FieldName,
  GetComputeActivityHandler,
  GetComputeActivityQuery,
  GetTableByIdQuery,
  GetTableByIdResult,
  MemoryTableRepository,
  NoopLogger,
  RecordByIdsSpec,
  RecordQueryPluginRunner,
  Table,
  TableId,
  TableName,
  TableOperationPluginRunner,
  domainError,
  err,
  ok,
  type IComputedActivityReader,
  type IQueryBus,
  type TableComputeActivitySnapshot,
} from '@teable/v2-core';
import { describe, expect, it, vi } from 'vitest';
import { executeGetTableByIdEndpoint } from './getTableById';

const setup = async (mode: 'all' | 'field' | 'rows' | 'denied' | 'unavailable' | 'throw') => {
  const context = { actorId: ActorId.create('restricted-user')._unsafeUnwrap() };
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withId(TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Activity')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Allowed')._unsafeUnwrap()).done();
  builder.field().singleLineText().withName(FieldName.create('Denied')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  const table = builder.build()._unsafeUnwrap();
  const input = { baseId: table.baseId().toString(), tableId: table.id().toString() };
  const allowed = table.getFields()[0].id().toString();
  const denied = table.getFields()[1].id().toString();
  const snapshot: TableComputeActivitySnapshot = {
    ...input,
    table: null,
    fields: [allowed, denied].map((fieldId) => ({
      ...input,
      fieldId,
      status: 'running',
      activeTaskCount: 1,
      processingTaskCount: 1,
      estimatedComplexity: 1,
      estimatedDirtyRecords: 1,
      hasAllTargetRecords: false,
      generation: 1,
      updatedAt: new Date().toISOString(),
      reliability: { unresolvedCount: 1, oldestUnresolvedAt: null, scopeComplete: true },
    })),
    diagnostics: {
      computeMode: 'server',
      executionState: 'running',
      activeFieldCount: 2,
      queuedFieldCount: 0,
      calculatingFieldCount: 2,
      failedFieldCount: 0,
      highComplexityFieldCount: 0,
      anomalies: [],
      pause: { effective: false, blockers: [], queuedTaskCount: 0, oldestQueuedAt: null },
    },
  };
  const reader: IComputedActivityReader = {
    getByTableId: vi
      .fn()
      .mockResolvedValue(
        mode === 'unavailable'
          ? err(domainError.infrastructure({ message: 'storage unavailable' }))
          : ok(snapshot)
      ),
  };
  const repository = new MemoryTableRepository();
  await repository.insert(context, table);
  const logger = new NoopLogger();
  const guard = vi.fn(() =>
    mode === 'denied'
      ? err(domainError.forbidden({ message: 'record read denied' }))
      : ok(undefined)
  );
  const handler = new GetComputeActivityHandler(
    repository,
    reader,
    logger,
    new TableOperationPluginRunner([], logger),
    new RecordQueryPluginRunner(
      [
        {
          name: 'test-access',
          supports: () => true,
          guard,
          scope: () =>
            ok(
              mode === 'field'
                ? { readableFieldIds: new Set([allowed]) }
                : mode === 'rows'
                  ? { recordSpec: RecordByIdsSpec.create([]) }
                  : {}
            ),
        },
      ],
      logger
    )
  );
  const execute = vi.fn(async (ctx, query) => {
    if (query instanceof GetTableByIdQuery) return ok(GetTableByIdResult.create(table));
    if (mode === 'throw') throw new Error('activity observer unavailable');
    return handler.handle(ctx, query);
  });
  const bus = { execute } as unknown as IQueryBus;
  return { context, input, allowed, denied, reader, guard, execute, bus };
};

describe('getTableById compute activity authorization', () => {
  it.each(['all', 'field', 'rows'] as const)(
    'enriches metadata using the %s authorized scope',
    async (mode) => {
      const test = await setup(mode);
      const result = await executeGetTableByIdEndpoint(
        test.context,
        test.input,
        test.bus,
        test.reader
      );
      expect(result.status).toBe(200);
      if (!result.body.ok) throw new Error('table read failed');
      const table = result.body.data.table;
      expect(test.execute.mock.calls[1][1]).toBeInstanceOf(GetComputeActivityQuery);
      expect(test.execute.mock.calls[1][0]).toBe(test.context);
      expect(test.guard).toHaveBeenCalledTimes(1);
      expect(table.computeMeta?.observationState).toBe('available');
      expect(table.computeMeta?.calculatingFieldCount).toBe(
        mode === 'all' ? 2 : mode === 'field' ? 1 : 0
      );
      expect(
        table.fields.find((field) => field.id === test.denied)?.computeMeta?.reliability
          ?.unresolvedCount
      ).toBe(mode === 'all' ? 1 : undefined);
      expect(
        table.fields.find((field) => field.id === test.allowed)?.computeMeta?.reliability
          ?.unresolvedCount
      ).toBe(mode === 'rows' ? undefined : 1);
    }
  );

  it.each(['denied', 'unavailable', 'throw'] as const)(
    'keeps table reads available when activity is %s',
    async (mode) => {
      const test = await setup(mode);
      const result = await executeGetTableByIdEndpoint(
        test.context,
        test.input,
        test.bus,
        test.reader
      );
      expect(result.status).toBe(200);
      if (!result.body.ok) throw new Error('table read failed');
      expect(result.body.data.table.computeMeta?.observationState).toBe('unavailable');
      expect(result.body.data.table.fields.every((field) => !field.computeMeta)).toBe(true);
      if (mode === 'denied') expect(test.reader.getByTableId).not.toHaveBeenCalled();
    }
  );
});
