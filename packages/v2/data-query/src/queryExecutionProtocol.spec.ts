import {
  ActorId,
  NoopLogger,
  RecordQueryPluginRunner,
  type IExecutionContext,
} from '@teable/v2-core';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { DataQueryService } from './DataQueryService';
import {
  executeDataQueryRequestSchema,
  type ExecuteDataQueryRequest,
} from './queryExecutionProtocol';
import { QueryExecutionService } from './QueryExecutionService';
import type { DataQueryParameterDefinition } from './types';

const definition = {
  version: 1,
  kind: 'records',
  tableId: `tbl${'a'.repeat(16)}`,
  select: [{ fieldId: `fld${'b'.repeat(16)}`, alias: 'title' }],
};
const context: IExecutionContext = { actorId: ActorId.create('reader')._unsafeUnwrap() };

// Invalid definitions must stop at the shared boundary, before loading live metadata or reading rows.
const service = new QueryExecutionService(
  new DataQueryService(
    {
      findOne: async () => {
        throw new Error('Invalid definitions must not load metadata');
      },
    },
    new RecordQueryPluginRunner([], new NoopLogger()),
    {
      execute: async () => {
        throw new Error('Invalid definitions must not execute');
      },
    }
  )
);

describe('inline execution protocol', () => {
  it('exposes only inline public inputs in the typed API', () => {
    expectTypeOf<keyof ExecuteDataQueryRequest>().toEqualTypeOf<
      'definition' | 'parameters' | 'queryId'
    >();
    expectTypeOf<keyof DataQueryParameterDefinition>().toEqualTypeOf<
      'type' | 'nullable' | 'default'
    >();
    expectTypeOf<Parameters<QueryExecutionService['execute']>>().toEqualTypeOf<
      [IExecutionContext, unknown]
    >();
  });

  it.each(['input', 'context'])('rejects obsolete parameter source %s', async (source) => {
    const request = {
      definition: { ...definition, parameters: { label: { type: 'string', source } } },
    };
    expect(executeDataQueryRequestSchema.safeParse(request).success).toBe(false);
    const result = await service.execute(context, request);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'data_query.invalid_definition',
      message: 'Invalid structured query definition',
      tags: ['validation'],
    });
  });

  it('validates semantic invariants at execution, not in the discovery schema', async () => {
    const request = {
      definition: {
        ...definition,
        select: [
          { fieldId: `fld${'b'.repeat(16)}`, alias: 'same' },
          { system: 'id', alias: 'same' },
        ],
      },
    };
    expect(executeDataQueryRequestSchema.safeParse(request).success).toBe(true);
    const result = await service.execute(context, request);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'data_query.duplicate_alias',
      message: 'Output aliases must be unique',
      tags: ['validation'],
    });
  });

  it('rejects authority and parameter values on the validation boundary', async () => {
    for (const extra of [{ actorId: 'reader' }, { parameters: {} }, { queryId: 'getTodos' }]) {
      expect(
        (await service.validate(context, { definition, ...extra }))._unsafeUnwrapErr().code
      ).toBe('data_query.invalid_request');
    }
    expect(
      (
        await service.validate(context, { definition: { ...definition, recordId: 'invalid' } })
      ).isErr()
    ).toBe(true);
  });

  it('rejects unsafe diagnostic identifiers before metadata loading', async () => {
    for (const queryId of ['constructor', 'bad\nvalue', 'x'.repeat(129)]) {
      expect(
        (await service.execute(context, { definition, queryId }))._unsafeUnwrapErr().code
      ).toBe('data_query.invalid_request');
    }
  });

  it('does not normalize inherited definitions into trusted plain data', async () => {
    const result = await service.execute(context, { definition: Object.create(definition) });
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'data_query.invalid_definition',
      message: 'Query definitions must contain plain data',
    });
  });
});
