import { ActorId, type IExecutionContext } from '@teable/v2-core';
import { TableQueryRemediationTask } from '@teable/v2-table-query-ops';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeSearchVector: vi.fn(),
}));

vi.mock('./searchVector', () => ({
  PostgresTableSearchVectorExecutor: class PostgresTableSearchVectorExecutor {
    execute = mocks.executeSearchVector;
  },
}));

import { PostgresTableQueryRemediationExecutor } from './executor';

const context: IExecutionContext = {
  actorId: ActorId.create('system')._unsafeUnwrap(),
};

describe('PostgresTableQueryRemediationExecutor', () => {
  beforeEach(() => {
    mocks.executeSearchVector.mockReset();
  });

  it('routes manual search-vector rebuilds to the search-vector executor', async () => {
    mocks.executeSearchVector.mockResolvedValue({ action: 'rebuilt' });
    const task = TableQueryRemediationTask.createQueued({
      tableId: 'tblExample',
      baseId: 'bseExample',
      kind: 'rebuild_search_vector',
      payload: {
        candidateKey: 'search_vector:tblExample:1234',
        languageConfig: 'simple',
        generatedColumnName: '__tqops_tsv_1234',
        indexName: 'idx_tqops_tsv_tblExample_1234',
        fields: [{ fieldId: 'fldExample', fieldDbName: 'fld_example' }],
        rebuild: true,
      },
      now: new Date('2026-07-20T00:00:00.000Z'),
    })._unsafeUnwrap();
    const executor = new PostgresTableQueryRemediationExecutor({} as never, {} as never);

    const result = await executor.execute(context, {
      task,
      allowManualIndexExecution: true,
    });

    expect(result._unsafeUnwrap()).toEqual({ action: 'rebuilt' });
    expect(mocks.executeSearchVector).toHaveBeenCalledWith({
      tableId: 'tblExample',
      payload: task.snapshot().payload,
    });
  });

  it('rejects index work when index execution is disabled', async () => {
    const task = TableQueryRemediationTask.createQueued({
      tableId: 'tblExample',
      baseId: 'bseExample',
      kind: 'create_filter_index',
      payload: {
        fieldId: 'fldExample',
        fieldDbName: 'fld_example',
        indexKind: 'btree',
      },
      now: new Date('2026-07-20T00:00:00.000Z'),
    })._unsafeUnwrap();
    const executor = new PostgresTableQueryRemediationExecutor({} as never, {} as never);

    const result = await executor.execute(context, {
      task,
      allowManualIndexExecution: false,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('table_query_ops.index_execution_disabled');
    }
  });

  it('pins a reclaim drop to the candidate that completed its grace period', async () => {
    const table = {} as never;
    const reconcile = vi.fn().mockResolvedValue(ok({ action: 'dropped' }));
    const task = TableQueryRemediationTask.createQueued({
      tableId: 'tblTqOpsText0000001',
      baseId: 'bseExample',
      kind: 'drop_search_access_path',
      payload: { trigger: 'reclaim', scopeKey: 'search:all' },
      now: new Date('2026-07-20T00:00:00.000Z'),
    })._unsafeUnwrap();
    const executor = new PostgresTableQueryRemediationExecutor(
      {} as never,
      {} as never,
      { findOne: vi.fn().mockResolvedValue(ok(table)) } as never,
      { reconcile } as never
    );

    const result = await executor.execute(context, {
      task,
      allowManualIndexExecution: false,
    });

    expect(result.isOk()).toBe(true);
    expect(reconcile).toHaveBeenCalledWith(context, {
      table,
      mode: 'drop',
      expectedDefinitionKey: 'search:all',
    });
  });
});
