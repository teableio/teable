import { createRouterClient } from '@orpc/server';
import type { IHandlerResolver } from '@teable/v2-contract-http';
import {
  ActorId,
  domainError,
  err,
  v2CoreTokens,
  type DomainError,
  type IQueryBus,
} from '@teable/v2-core';
import { describe, expect, it, vi } from 'vitest';

import { createV2OrpcRouter } from './router';

const TABLE_ID = `tbl${'a'.repeat(16)}`;

const createClientWithQueryError = (error: DomainError) => {
  const queryBus = { execute: vi.fn(async () => err(error)) } as unknown as IQueryBus;
  const container = {
    resolve: (token: unknown) => {
      if (token === v2CoreTokens.queryBus) return queryBus;
      throw new Error(`unexpected token: ${String(token)}`);
    },
  } as unknown as IHandlerResolver;

  return createRouterClient(
    createV2OrpcRouter({
      createContainer: () => container,
      createExecutionContext: () => ({ actorId: ActorId.create('system')._unsafeUnwrap() }),
    }),
    { context: {} }
  );
};

/**
 * The mapper decides the status; this dispatch is what the ORPC/OpenAPI surface
 * actually sends. Without the `GATEWAY_TIMEOUT` branch every non-400/403/404
 * status collapses into ORPC `INTERNAL_SERVER_ERROR`, i.e. a read that outran its
 * budget would still reach the client as a 500.
 */
describe('v2 orpc domain error dispatch', () => {
  it('reports a database statement timeout as a gateway timeout', async () => {
    const client = createClientWithQueryError(
      domainError.infrastructure({
        code: 'db.statement_timeout',
        message: 'Failed to load table records: canceling statement due to statement timeout',
        details: { pgCode: '57014' },
      })
    );

    await expect(client.tables.listRecords({ tableId: TABLE_ID })).rejects.toMatchObject({
      code: 'GATEWAY_TIMEOUT',
      data: { domainCode: 'db.statement_timeout' },
    });
  });

  it('keeps an unclassified query failure internal', async () => {
    const client = createClientWithQueryError(
      domainError.unexpected({
        code: 'db.undefined_column',
        message: 'Failed to load table records: column "missing" does not exist',
      })
    );

    await expect(client.tables.listRecords({ tableId: TABLE_ID })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      data: { domainCode: 'db.undefined_column' },
    });
  });

  it('keeps the existing bad request mapping', async () => {
    const client = createClientWithQueryError(
      domainError.validation({ message: 'Invalid ListTableRecordsQuery input' })
    );

    await expect(client.tables.listRecords({ tableId: TABLE_ID })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});
