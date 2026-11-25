import { createRouterClient } from '@orpc/server';
import type { IHandlerResolver } from '@teable/v2-contract-http';
import {
  ActorId,
  BaseId,
  FieldName,
  NoopLogger,
  RecordQueryPluginRunner,
  Table,
  TableId,
  TableName,
  domainError,
  err,
  ok,
  v2CoreTokens,
  type DomainError,
  type IQueryBus,
} from '@teable/v2-core';
import { describe, expect, it, vi } from 'vitest';

import { createV2OrpcRouter } from './router';

const TABLE_ID = `tbl${'a'.repeat(16)}`;

const createClientWithQueryError = (error: DomainError) => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withId(TableId.create(TABLE_ID)._unsafeUnwrap())
    .withName(TableName.create('Records')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  const table = builder.build()._unsafeUnwrap();
  const tableQueryService = { getById: vi.fn(async () => ok(table)) };
  const recordQueryPluginRunner = new RecordQueryPluginRunner([], new NoopLogger());
  const queryBus = { execute: vi.fn(async () => err(error)) } as unknown as IQueryBus;
  const container = {
    resolve: (token: unknown) => {
      if (token === v2CoreTokens.queryBus) return queryBus;
      if (token === v2CoreTokens.tableQueryService) return tableQueryService;
      if (token === v2CoreTokens.recordQueryPluginRunner) return recordQueryPluginRunner;
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
  it.each([
    {
      error: domainError.conflict({
        code: 'schema_coordination.busy',
        message: 'Schema coordination is busy',
        details: { mode: 'shared' },
      }),
      code: 'CONFLICT',
      status: 409,
    },
    {
      error: domainError.unexpected({ code: 'db.failure', message: 'Unexpected database failure' }),
      code: 'INTERNAL_SERVER_ERROR',
      status: 500,
    },
  ])(
    'dispatches createRecord $code without losing domain details',
    async ({ error, code, status }) => {
      const commandBus = { execute: vi.fn(async () => err(error)) };
      const container = {
        resolve: (token: unknown) => {
          if (token === v2CoreTokens.commandBus) return commandBus;
          throw new Error(`unexpected token: ${String(token)}`);
        },
      } as unknown as IHandlerResolver;
      const client = createRouterClient(
        createV2OrpcRouter({
          createContainer: () => container,
          createExecutionContext: () => ({ actorId: ActorId.create('system')._unsafeUnwrap() }),
        }),
        { context: {} }
      );

      await expect(
        client.tables.createRecord({ tableId: TABLE_ID, fields: {} })
      ).rejects.toMatchObject({
        code,
        status,
        message: error.message,
        data: { domainCode: error.code, domainTags: error.tags, details: error.details },
      });
    }
  );

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
