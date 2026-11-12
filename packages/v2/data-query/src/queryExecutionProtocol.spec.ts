import {
  ActorId,
  DefaultTableMapper,
  NoopLogger,
  RecordQueryPluginRunner,
  type IExecutionContext,
} from '@teable/v2-core';
import { ok } from 'neverthrow';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { DataQueryBinding } from './DataQueryBinding';
import { DataQueryDefinition } from './DataQueryDefinition';
import { DataQueryExplainService } from './DataQueryExplainService';
import { DataQueryService } from './DataQueryService';
import {
  executeDataQueryRequestSchema,
  dataQueryCandidateSchema,
  validateDataQueryRequestSchema,
  type DataQueryValidationUsage,
  type ExecuteDataQueryRequest,
  type ValidateDataQueryRequest,
} from './queryExecutionProtocol';
import { QueryExecutionService } from './QueryExecutionService';
import { QueryExplainExecutionService } from './QueryExplainExecutionService';
import type { DataQueryFieldUsage, DataQueryParameterDefinition } from './types';

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

const explainService = new QueryExplainExecutionService(
  new DataQueryExplainService(
    {
      findOne: async () => {
        throw new Error('Invalid definitions must not load metadata');
      },
    },
    new RecordQueryPluginRunner([], new NoopLogger()),
    {
      explain: async () => {
        throw new Error('Invalid definitions must not reach the explainer');
      },
    }
  )
);

describe('inline execution protocol', () => {
  it('keeps legacy OpenAPI candidates intact and requires explicit native patch semantics', () => {
    const identity = {
      operation: 'convert' as const,
      tableId: definition.tableId,
      fieldId: `fld${'b'.repeat(16)}`,
    };
    const legacy = { ...identity, field: { type: 'number', name: 'Amount' } };
    expect(dataQueryCandidateSchema.parse(legacy)).toEqual(legacy);
    expect(
      dataQueryCandidateSchema.safeParse({ ...identity, field: { name: 'Renamed' } }).success
    ).toBe(false);
    const native = {
      ...identity,
      inputFormat: 'field-v2',
      field: { name: 'Renamed', updateMode: 'partial' },
    };
    expect(dataQueryCandidateSchema.parse(native)).toEqual(native);
    expect(dataQueryCandidateSchema.safeParse({ ...native, field: { name: 123 } }).success).toBe(
      false
    );
    expect(dataQueryCandidateSchema.safeParse({ ...native, inputFormat: 'unknown' }).success).toBe(
      false
    );
  });

  it('exposes only inline public inputs in the typed API', () => {
    expectTypeOf<keyof ExecuteDataQueryRequest>().toEqualTypeOf<
      'definition' | 'parameters' | 'queryId'
    >();
    expectTypeOf<keyof ValidateDataQueryRequest>().toEqualTypeOf<
      'definition' | 'includeUsage' | 'includeSchemaSignature' | 'candidate' | 'candidateProof'
    >();
    expectTypeOf<DataQueryValidationUsage>().toEqualTypeOf<
      ReadonlyArray<{
        readonly source: string;
        readonly tableId: string;
        readonly fieldId: string;
        readonly usages: ReadonlyArray<DataQueryFieldUsage>;
      }>
    >();
    expectTypeOf<keyof DataQueryParameterDefinition>().toEqualTypeOf<
      'type' | 'nullable' | 'default'
    >();
    expectTypeOf<Parameters<QueryExecutionService['execute']>>().toEqualTypeOf<
      [IExecutionContext, unknown]
    >();
  });

  it('accepts only boolean usage and signature opt-ins on validation requests', () => {
    expect(validateDataQueryRequestSchema.safeParse({ definition }).success).toBe(true);
    expect(
      validateDataQueryRequestSchema.safeParse({ definition, includeUsage: true }).success
    ).toBe(true);
    expect(
      validateDataQueryRequestSchema.safeParse({ definition, includeUsage: 'true' }).success
    ).toBe(false);
    expect(
      validateDataQueryRequestSchema.safeParse({ definition, includeSchemaSignature: true }).success
    ).toBe(true);
    expect(
      validateDataQueryRequestSchema.safeParse({ definition, includeSchemaSignature: 'true' })
        .success
    ).toBe(false);
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

  it.each(['execute', 'validate', 'explain'] as const)(
    'keeps unsafe definition diagnostics canonical without invoking accessors at %s admission',
    async (operation) => {
      const boundaries = {
        execute: service.execute.bind(service),
        validate: service.validate.bind(service),
        explain: explainService.explain.bind(explainService),
      };
      const inherited = await boundaries[operation](context, {
        definition: Object.create(definition),
      });
      expect(inherited._unsafeUnwrapErr().code).toBe('data_query.invalid_definition');
      let reads = 0;
      const envelopeAccessor = Object.defineProperty({}, 'definition', {
        enumerable: true,
        get: () => {
          reads++;
          throw new Error('Root accessor must not run');
        },
      });
      const rejectedEnvelope = await boundaries[operation](context, envelopeAccessor);
      expect(rejectedEnvelope._unsafeUnwrapErr().code).toBe('data_query.invalid_request');
      const nestedAccessor = Object.defineProperty({}, 'version', {
        enumerable: true,
        get: () => {
          reads++;
          throw new Error('Definition accessor must not run');
        },
      });
      const rejectedDefinition = await boundaries[operation](context, {
        definition: nestedAccessor,
      });
      expect(rejectedDefinition._unsafeUnwrapErr().code).toBe('data_query.invalid_definition');
      expect(reads).toBe(0);
    }
  );

  it.each(['execute', 'validate', 'explain'] as const)(
    'enforces the contextual formula source budget during real binding before %s reaches database execution',
    async (operation) => {
      const titleId = `fld${'b'.repeat(16)}`;
      const table = new DefaultTableMapper()
        .toDomain({
          id: definition.tableId,
          baseId: `bse${'a'.repeat(16)}`,
          name: 'Formula budget protocol fixture',
          dbTableName: 'public.formula_budget_protocol',
          primaryFieldId: titleId,
          fields: [
            {
              id: titleId,
              name: 'Title',
              dbFieldName: 'title',
              type: 'singleLineText',
            },
          ],
          views: [{ id: `viw${'a'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
        })
        ._unsafeUnwrap();
      const findOne = vi.fn(async () => ok(table));
      const execute = vi.fn(async () => {
        throw new Error('Over-budget formulas must not execute database queries');
      });
      const explain = vi.fn(async () => {
        throw new Error('Over-budget formulas must not reach the database explainer');
      });
      const plugins = new RecordQueryPluginRunner([], new NoopLogger());
      const execution = new QueryExecutionService(
        new DataQueryService({ findOne }, plugins, { execute })
      );
      const explanation = new QueryExplainExecutionService(
        new DataQueryExplainService({ findOne }, plugins, { explain })
      );
      const boundaries = {
        execute: execution.execute.bind(execution),
        validate: execution.validate.bind(execution),
        explain: explanation.explain.bind(explanation),
      };
      const request = {
        definition: {
          version: 3,
          kind: 'records',
          tableId: definition.tableId,
          select: [
            {
              alias: 'caption',
              expr: {
                type: 'formula',
                formula: `${'LOWER('.repeat(9)}"text"${')'.repeat(9)}`,
                references: {},
              },
            },
          ],
        },
      };
      // Discovery admits text; the real binder must apply this caller's non-default policy.
      expect(executeDataQueryRequestSchema.safeParse(request).success).toBe(true);
      const result = await boundaries[operation](
        {
          ...context,
          config: { formulaSourceBudget: { astDepth: 8, visitedNodes: 32768, policyVersion: 1 } },
        },
        request
      );
      expect(result._unsafeUnwrapErr().code).toBe('validation.limit.formula_compile_depth_max');
      expect(findOne).toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
      expect(explain).not.toHaveBeenCalled();
    }
  );

  it.each(['execute', 'validate', 'explain'] as const)(
    'rejects inline field-tracking clocks before %s reaches database execution but admits stored clocks',
    async (operation) => {
      const titleId = `fld${'b'.repeat(16)}`;
      const trackedId = `fld${'c'.repeat(16)}`;
      const table = new DefaultTableMapper()
        .toDomain({
          id: definition.tableId,
          baseId: `bse${'a'.repeat(16)}`,
          name: 'Tracked formula clock fixture',
          dbTableName: 'public.tracked_formula_clock',
          primaryFieldId: titleId,
          fields: [
            { id: titleId, name: 'Title', dbFieldName: 'title', type: 'singleLineText' },
            {
              id: trackedId,
              name: 'Stored title clock',
              dbFieldName: 'title_clock',
              type: 'formula',
              options: { expression: `LAST_MODIFIED_TIME({${titleId}})` },
              cellValueType: 'dateTime',
              isMultipleCellValue: false,
            },
          ],
          views: [{ id: `viw${'a'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
        })
        ._unsafeUnwrap();
      const findOne = vi.fn(async () => ok(table));
      const execute = vi.fn(async () => {
        throw new Error('Unsupported clock semantics must not execute database queries');
      });
      const explain = vi.fn(async () => {
        throw new Error('Unsupported clock semantics must not reach the database explainer');
      });
      const plugins = new RecordQueryPluginRunner([], new NoopLogger());
      const execution = new QueryExecutionService(
        new DataQueryService({ findOne }, plugins, { execute })
      );
      const explanation = new QueryExplainExecutionService(
        new DataQueryExplainService({ findOne }, plugins, { explain })
      );
      const boundaries = {
        execute: execution.execute.bind(execution),
        validate: execution.validate.bind(execution),
        explain: explanation.explain.bind(explanation),
      };
      const raw = {
        version: 3,
        kind: 'records',
        tableId: definition.tableId,
        select: [
          {
            alias: 'clock',
            expr: {
              type: 'formula',
              formula: 'LAST_MODIFIED_TIME({privateTitle})',
              references: { privateTitle: { type: 'field', fieldId: titleId } },
            },
          },
        ],
      };
      const result = await boundaries[operation](context, { definition: raw });
      expect(result._unsafeUnwrapErr()).toMatchObject({
        code: 'data_query.unsupported_expression_context',
        message:
          'Inline field-tracking last-modified time is not supported; reference a stored formula field instead',
      });
      expect(JSON.stringify(result._unsafeUnwrapErr())).not.toContain('privateTitle');
      expect(findOne).toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
      expect(explain).not.toHaveBeenCalled();
      for (const expr of [
        {
          type: 'formula',
          formula: '{tracked}',
          references: { tracked: { type: 'field', fieldId: trackedId } },
        },
        { type: 'formula', formula: 'LAST_MODIFIED_TIME()', references: {} },
      ]) {
        const admitted = DataQueryDefinition.create({
          ...raw,
          select: [{ alias: 'clock', expr }],
        }).andThen((query) => DataQueryBinding.prepare(query, table));
        expect(admitted.isOk()).toBe(true);
        expect(admitted._unsafeUnwrap().outputs[0]).toMatchObject({ cellValueType: 'dateTime' });
      }
    }
  );
});
