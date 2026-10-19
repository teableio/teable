import { domainError, type DomainError, type IExecutionContext } from '@teable/v2-core';
import { err, type Result } from 'neverthrow';
import { z } from 'zod';

import { DataQueryDefinition } from './DataQueryDefinition';
import { traceDataQueryStage, type DataQueryService } from './DataQueryService';
import type { DataQueryResult } from './ports';
import {
  executeDataQueryRequestSchema,
  validateDataQueryRequestSchema,
} from './queryExecutionProtocol';
import type { DataQueryOutput } from './types';

// Validate the envelope here; DataQueryDefinition.create owns definition parsing and construction.
const executionEnvelopeSchema = executeDataQueryRequestSchema.extend({
  definition: z.unknown().refine((value) => value !== undefined),
});
const validationEnvelopeSchema = validateDataQueryRequestSchema.extend({
  definition: z.unknown().refine((value) => value !== undefined),
});

/** The server boundary for untrusted inline query requests, independent of transport. */
export class QueryExecutionService {
  constructor(private readonly dataQueries: DataQueryService) {}

  async validate(
    context: IExecutionContext,
    raw: unknown
  ): Promise<Result<{ outputs: ReadonlyArray<DataQueryOutput> }, DomainError>> {
    try {
      return await traceDataQueryStage(context, 'validate', {}, async () => {
        const parsed = validationEnvelopeSchema.safeParse(raw);
        if (!parsed.success)
          return err(
            domainError.validation({
              code: 'data_query.invalid_request',
              message: 'Provide a query definition',
            })
          );
        const definition = DataQueryDefinition.create(parsed.data.definition);
        if (definition.isErr()) return err(definition.error);
        return this.dataQueries.validate(context, definition.value);
      });
    } catch (cause) {
      return err(
        domainError.infrastructure({
          code: 'data_query.validation_failed',
          message: 'Unable to validate the data query',
          cause,
        })
      );
    }
  }

  async execute(
    context: IExecutionContext,
    raw: unknown
  ): Promise<Result<DataQueryResult, DomainError>> {
    try {
      return await traceDataQueryStage(
        context,
        'execute',
        { 'teable.data_query.mode': 'inline' },
        async () => {
          const parsed = executionEnvelopeSchema.safeParse(raw);
          if (!parsed.success)
            return err(
              domainError.validation({
                code: 'data_query.invalid_request',
                message: 'Provide a query definition and optional public parameters',
              })
            );
          const definition = DataQueryDefinition.create(parsed.data.definition);
          if (definition.isErr()) return err(definition.error);
          return traceDataQueryStage(
            context,
            'execute.definition',
            {
              ...(parsed.data.queryId ? { 'teable.data_query.query_id': parsed.data.queryId } : {}),
            },
            () =>
              this.dataQueries.execute(context, definition.value, {
                parameters: parsed.data.parameters,
              })
          );
        }
      );
    } catch (cause) {
      return err(
        domainError.infrastructure({
          code: 'data_query.execution_failed',
          message: 'Unable to execute the data query',
          cause,
        })
      );
    }
  }
}
