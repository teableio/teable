import { domainError, type DomainError, type IExecutionContext } from '@teable/v2-core';
import { err, type Result } from 'neverthrow';
import { z } from 'zod';

import { DataQueryDefinition } from './DataQueryDefinition';
import type { DataQueryExplainResult } from './DataQueryExplain';
import type { DataQueryExplainService } from './DataQueryExplainService';
import { traceDataQueryStage } from './DataQueryService';
import { executeDataQueryRequestSchema } from './queryExecutionProtocol';

// Same canonical envelope as execute; explain adds no private request shape.
const explainEnvelopeSchema = executeDataQueryRequestSchema.extend({
  definition: z.unknown().refine((value) => value !== undefined),
});

/** Transport-independent explain boundary for untrusted inline requests. */
export class QueryExplainExecutionService {
  constructor(private readonly explainService: DataQueryExplainService) {}

  async explain(
    context: IExecutionContext,
    raw: unknown
  ): Promise<Result<DataQueryExplainResult, DomainError>> {
    try {
      return await traceDataQueryStage(context, 'explain', {}, async () => {
        const parsed = explainEnvelopeSchema.safeParse(raw);
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
          'explain.definition',
          parsed.data.queryId ? { 'teable.data_query.query_id': parsed.data.queryId } : {},
          () =>
            this.explainService.explain(context, definition.value, {
              parameters: parsed.data.parameters,
            })
        );
      });
    } catch (cause) {
      return err(
        domainError.infrastructure({
          code: 'data_query.explain_failed',
          message: 'Unable to explain the data query',
          cause,
        })
      );
    }
  }
}
