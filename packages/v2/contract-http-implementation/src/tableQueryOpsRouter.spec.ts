import { createRouterClient } from '@orpc/server';
import type { IHandlerResolver } from '@teable/v2-contract-http';
import { ActorId, domainError, err, v2CoreTokens } from '@teable/v2-core';
import { v2TableOpsTokens } from '@teable/v2-table-query-ops';
import { describe, expect, it, vi } from 'vitest';

import { createV2TableQueryOpsOrpcRouter } from './tableQueryOpsRouter';

const TABLE_ID = `tbl${'a'.repeat(16)}`;

describe('table query ops orpc domain error dispatch', () => {
  it('reports a pending table as unavailable while preserving domain metadata', async () => {
    const pendingError = domainError.infrastructure({
      code: 'table.provision_pending',
      message: 'Table schema is updating',
      details: { tableId: TABLE_ID, provisionState: 'pending' },
    });
    const tableRepository = { findOne: vi.fn(async () => err(pendingError)) };
    const statusReader = { read: vi.fn() };
    const container = {
      resolve: (token: unknown) => {
        if (token === v2CoreTokens.tableRepository) return tableRepository;
        if (token === v2TableOpsTokens.searchVectorStatusReader) return statusReader;
        throw new Error(`unexpected token: ${String(token)}`);
      },
    } as unknown as IHandlerResolver;
    const client = createRouterClient(
      createV2TableQueryOpsOrpcRouter({
        createContainer: () => container,
        createExecutionContext: () => ({ actorId: ActorId.create('system')._unsafeUnwrap() }),
      }),
      { context: {} }
    );

    await expect(client.searchAccessPath.getStatus({ tableId: TABLE_ID })).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
      message: 'Table schema is updating',
      data: {
        domainCode: 'table.provision_pending',
        domainTags: ['infrastructure'],
        details: { tableId: TABLE_ID, provisionState: 'pending' },
      },
    });
  });
});
