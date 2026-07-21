import {
  ActorId,
  GetComputeActivityQuery,
  GetComputeActivityResult,
  v2CoreTokens,
  type IExecutionContext,
  type TableComputeActivitySnapshot,
} from '@teable/v2-core';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { V2Controller } from './v2.controller';

const baseId = `bse${'a'.repeat(16)}`;
const tableId = `tbl${'a'.repeat(16)}`;

const snapshot: TableComputeActivitySnapshot = {
  baseId,
  tableId,
  table: null,
  fields: [],
  diagnostics: {
    computeMode: 'server',
    activeFieldCount: 0,
    queuedFieldCount: 0,
    calculatingFieldCount: 0,
    failedFieldCount: 0,
    highComplexityFieldCount: 0,
    anomalies: [],
  },
};

describe('V2Controller compute activity route', () => {
  it('routes the request through the table container, context, and query bus', async () => {
    const context: IExecutionContext = {
      actorId: ActorId.create('system')._unsafeUnwrap(),
    };
    const execute = vi.fn().mockResolvedValue(ok(GetComputeActivityResult.create(snapshot)));
    const queryBus = { execute };
    const resolve = vi.fn((token: symbol) => {
      if (token === v2CoreTokens.queryBus) return queryBus;
      throw new Error(`Unexpected token: ${String(token)}`);
    });
    const container = { resolve };
    const getContainerForTable = vi.fn().mockResolvedValue(container);
    const createContext = vi.fn().mockResolvedValue(context);
    const controller = new V2Controller(
      { getContainerForTable } as never,
      { createContext } as never
    );

    const result = await controller.tables().getComputeActivity.callable()({ baseId, tableId });

    expect(result).toEqual({
      ok: true,
      data: snapshot,
    });
    expect(getContainerForTable).toHaveBeenCalledWith(tableId);
    expect(resolve).toHaveBeenCalledWith(v2CoreTokens.queryBus);
    expect(createContext).toHaveBeenCalledWith(container);
    expect(execute).toHaveBeenCalledOnce();
    const [executedContext, query] = execute.mock.calls[0]!;
    expect(executedContext).toBe(context);
    expect(query).toBeInstanceOf(GetComputeActivityQuery);
    expect(query.baseId.toString()).toBe(baseId);
    expect(query.tableId.toString()).toBe(tableId);
  });
});
