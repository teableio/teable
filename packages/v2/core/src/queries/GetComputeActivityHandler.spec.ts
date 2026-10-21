import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { RecordQueryPluginRunner } from '../application/services/RecordQueryPluginRunner';
import { TableOperationPluginRunner } from '../application/services/TableOperationPluginRunner';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError } from '../domain/shared/DomainError';
import { FieldName } from '../domain/table/fields/FieldName';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type {
  IComputedActivityReader,
  TableComputeActivitySnapshot,
} from '../ports/ComputedActivityReader';
import { NoopLogger } from '../ports/defaults/NoopLogger';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { MemoryTableRepository } from '../ports/memory/MemoryTableRepository';
import type { ITableOperationPlugin } from '../ports/TableOperationPlugin';
import { TableOperationKind } from '../ports/TableOperationPlugin';
import { filterComputeActivitySnapshot } from './filterComputeActivitySnapshot';
import { GetComputeActivityHandler } from './GetComputeActivityHandler';
import { GetComputeActivityQuery } from './GetComputeActivityQuery';

const logger = new NoopLogger();

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
});

const buildTable = (baseIdSeed: string, tableIdSeed: string) => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${baseIdSeed.repeat(16)}`)._unsafeUnwrap())
    .withId(TableId.create(`tbl${tableIdSeed.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Tasks')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Title')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const createSnapshot = (baseId: string, tableId: string): TableComputeActivitySnapshot => ({
  baseId,
  tableId,
  table: null,
  fields: [],
  diagnostics: {
    computeMode: 'server',
    executionState: 'running',
    activeFieldCount: 0,
    queuedFieldCount: 0,
    calculatingFieldCount: 0,
    failedFieldCount: 0,
    highComplexityFieldCount: 0,
    anomalies: [],
    pause: {
      effective: false,
      blockers: [],
      queuedTaskCount: 0,
      oldestQueuedAt: null,
    },
  },
});

const createReader = (snapshot: TableComputeActivitySnapshot) => {
  const getByTableId = vi
    .fn<IComputedActivityReader['getByTableId']>()
    .mockResolvedValue(ok(snapshot));
  return {
    reader: { getByTableId } satisfies IComputedActivityReader,
    getByTableId,
  };
};

const createQuery = (baseId: string, tableId: string) =>
  GetComputeActivityQuery.create({ baseId, tableId })._unsafeUnwrap();

describe('GetComputeActivityHandler', () => {
  it('retains exact scoped SQL counts only when no additional fields are removed', () => {
    const snapshot = createSnapshot('base', 'table');
    snapshot.reliabilityIsAccessScoped = true;
    snapshot.diagnostics.reliability = {
      unresolvedCount: 1,
      oldestUnresolvedAt: null,
      scopeComplete: true,
    };
    snapshot.fields = ['one', 'two'].map((fieldId) => ({
      fieldId,
      baseId: 'base',
      tableId: 'table',
      status: 'failed',
      activeTaskCount: 0,
      processingTaskCount: 0,
      generation: 1,
      estimatedComplexity: 0,
      estimatedDirtyRecords: 0,
      hasAllTargetRecords: false,
      updatedAt: '2026-09-05T00:00:00.000Z',
      reliability: { unresolvedCount: 1, oldestUnresolvedAt: null, scopeComplete: true },
    }));
    // The same incident spans two readable fields: SQL has already deduplicated it.
    expect(
      filterComputeActivitySnapshot(snapshot, { readableFieldIds: new Set(['one', 'two']) })
        .diagnostics.reliability?.unresolvedCount
    ).toBe(1);
    expect(
      filterComputeActivitySnapshot(snapshot, { readableFieldIds: new Set() }).diagnostics
        .reliability?.unresolvedCount
    ).toBe(0);
  });

  it.each(['allowlist', 'mask', 'rows'])(
    'applies %s record-read scope and rebuilds safe summaries',
    async (mode) => {
      const table = buildTable('a', 'a');
      const repository = new MemoryTableRepository();
      await repository.insert(createContext(), table);
      const snapshot = createSnapshot(table.baseId().toString(), table.id().toString());
      snapshot.fields = ['fldAllowed', 'fldDenied'].map((fieldId) => ({
        fieldId,
        tableId: snapshot.tableId,
        baseId: snapshot.baseId,
        status: 'running',
        activeTaskCount: 1,
        processingTaskCount: 1,
        generation: 1,
        estimatedComplexity: 1000,
        estimatedDirtyRecords: 500,
        hasAllTargetRecords: false,
        updatedAt: '2026-09-05T00:00:00.000Z',
        reliability: {
          unresolvedCount: 1,
          oldestUnresolvedAt: null,
          scopeComplete: true,
        },
      }));
      snapshot.diagnostics.activeFieldCount = 2;
      snapshot.diagnostics.anomalies = [
        { fieldId: 'fldDenied', kind: 'failed', message: 'private' },
      ];
      const { reader } = createReader(snapshot);
      const handler = new GetComputeActivityHandler(
        repository,
        reader,
        logger,
        new TableOperationPluginRunner([], logger),
        new RecordQueryPluginRunner(
          [
            {
              name: 'field-permissions',
              supports: () => true,
              scope: () =>
                ok(
                  mode === 'allowlist'
                    ? { readableFieldIds: new Set(['fldAllowed']) }
                    : mode === 'mask'
                      ? {
                          fieldMasks: [
                            { fieldId: 'fldDenied', visibleWhen: RecordByIdsSpec.create([]) },
                          ],
                        }
                      : { recordSpec: RecordByIdsSpec.create([]) }
                ),
            },
          ],
          logger
        )
      );
      const result = (
        await handler.handle(createContext(), createQuery(snapshot.baseId, snapshot.tableId))
      )._unsafeUnwrap().snapshot;
      expect(result.fields.map(({ fieldId }) => fieldId)).toEqual(
        mode === 'rows' ? [] : ['fldAllowed']
      );
      expect(result.diagnostics.activeFieldCount).toBe(mode === 'rows' ? 0 : 1);
      expect(result.diagnostics.reliability?.unresolvedCount).toBe(mode === 'rows' ? 0 : 1);
      expect(result.diagnostics.anomalies).toEqual([]);
    }
  );

  it.each([
    ['mismatched base', `bse${'b'.repeat(16)}`, `tbl${'a'.repeat(16)}`],
    ['nonexistent table', `bse${'a'.repeat(16)}`, `tbl${'b'.repeat(16)}`],
  ])('rejects a %s before reading activity', async (_, baseId, tableId) => {
    const table = buildTable('a', 'a');
    const repository = new MemoryTableRepository();
    await repository.insert(createContext(), table);
    const { reader, getByTableId } = createReader(
      createSnapshot(table.baseId().toString(), table.id().toString())
    );
    const handler = new GetComputeActivityHandler(
      repository,
      reader,
      logger,
      new TableOperationPluginRunner([], logger),
      new RecordQueryPluginRunner([], logger)
    );

    const result = await handler.handle(createContext(), createQuery(baseId, tableId));

    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'table.not_found',
      message: 'Table not found',
      tags: ['not-found'],
    });
    expect(getByTableId).not.toHaveBeenCalled();
  });

  it('propagates read guard errors before reading activity', async () => {
    const table = buildTable('a', 'a');
    const repository = new MemoryTableRepository();
    await repository.insert(createContext(), table);
    const { reader, getByTableId } = createReader(
      createSnapshot(table.baseId().toString(), table.id().toString())
    );
    const permissionError = domainError.forbidden({
      code: 'permission.table.read_denied',
      message: 'Table read denied',
    });
    const permissionPlugin: ITableOperationPlugin = {
      name: 'deny-table-read',
      supports: (operation) => operation === TableOperationKind.read,
      guard: async () => err(permissionError),
    };
    const handler = new GetComputeActivityHandler(
      repository,
      reader,
      logger,
      new TableOperationPluginRunner([permissionPlugin], logger),
      new RecordQueryPluginRunner([], logger)
    );

    const result = await handler.handle(
      createContext(),
      createQuery(table.baseId().toString(), table.id().toString())
    );

    expect(result._unsafeUnwrapErr()).toBe(permissionError);
    expect(getByTableId).not.toHaveBeenCalled();
  });

  it('reads activity after the table read guard succeeds', async () => {
    const table = buildTable('a', 'a');
    const repository = new MemoryTableRepository();
    await repository.insert(createContext(), table);
    const snapshot = createSnapshot(table.baseId().toString(), table.id().toString());
    const { reader, getByTableId } = createReader(snapshot);
    const guard = vi.fn(() => ok(undefined));
    const permissionPlugin: ITableOperationPlugin = {
      name: 'allow-table-read',
      supports: (operation) => operation === TableOperationKind.read,
      guard,
    };
    const context = createContext();
    const handler = new GetComputeActivityHandler(
      repository,
      reader,
      logger,
      new TableOperationPluginRunner([permissionPlugin], logger),
      new RecordQueryPluginRunner([], logger)
    );

    const result = await handler.handle(
      context,
      createQuery(table.baseId().toString(), table.id().toString())
    );

    expect(result._unsafeUnwrap().snapshot).toEqual(snapshot);
    expect(guard).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: TableOperationKind.read,
        executionContext: context,
        payload: {
          baseId: table.baseId(),
          table,
        },
      }),
      undefined
    );
    expect(getByTableId).toHaveBeenCalledWith(
      context,
      table.id().toString(),
      table.baseId().toString(),
      { budgetMs: 2000, includePauseDiagnostics: true }
    );
  });
});
