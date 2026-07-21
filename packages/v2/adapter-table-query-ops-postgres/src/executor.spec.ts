import { ActorId, type IExecutionContext } from '@teable/v2-core';
import { TableQueryRemediationTask } from '@teable/v2-table-query-ops';
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
});
