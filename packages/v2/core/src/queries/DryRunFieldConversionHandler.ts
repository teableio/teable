import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldConversionPreparationService } from '../application/services/FieldConversionPreparationService';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import type { ITableRecordAggregationQueryRepository } from '../ports/TableRecordQueryRepository';
import type { ITableRepository } from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { DryRunFieldConversionQuery } from './DryRunFieldConversionQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';

/**
 * Outcome of a field-conversion dry run: what applying the update WOULD do,
 * without touching storage. Deliberately uses dry-run semantics rather than
 * v1 "plan" semantics (no dependency-graph payload): callers learn whether
 * anything changes at all, whether stored cells would be rewritten, how many
 * non-empty cells the rewrite touches on the host field, and how many
 * cross-table link side effects (symmetric field changes) would occur.
 */
export class FieldConversionDryRunResult {
  private constructor(
    readonly isNoop: boolean,
    readonly isTypeConversion: boolean,
    readonly requiresDataRewrite: boolean,
    readonly affectedCellCount: number,
    readonly linkSideEffectCount: number
  ) {}

  static create(params: {
    isNoop: boolean;
    isTypeConversion: boolean;
    requiresDataRewrite: boolean;
    affectedCellCount: number;
    linkSideEffectCount: number;
  }): FieldConversionDryRunResult {
    return new FieldConversionDryRunResult(
      params.isNoop,
      params.isTypeConversion,
      params.requiresDataRewrite,
      params.affectedCellCount,
      params.linkSideEffectCount
    );
  }

  static noop(): FieldConversionDryRunResult {
    return new FieldConversionDryRunResult(true, false, false, 0, 0);
  }
}

@QueryHandler(DryRunFieldConversionQuery)
@injectable()
export class DryRunFieldConversionHandler implements IQueryHandler<
  DryRunFieldConversionQuery,
  FieldConversionDryRunResult
> {
  constructor(
    @inject(v2CoreTokens.fieldConversionPreparationService)
    private readonly fieldConversionPreparationService: FieldConversionPreparationService,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: ITableRecordAggregationQueryRepository
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    query: DryRunFieldConversionQuery
  ): Promise<Result<FieldConversionDryRunResult, DomainError>> {
    const preparation = await this.fieldConversionPreparationService.prepare(
      context,
      {
        tableId: query.tableId.toString(),
        fieldId: query.fieldId.toString(),
        field: query.fieldUpdate,
      },
      { allowNoop: true, aggregationRepository: this.tableRecordQueryRepository }
    );
    return preparation.andThen((facts) => {
      if (facts.affectedCellCount == null) {
        return err(
          domainError.validation({
            code: 'field.conversion.aggregation_unavailable',
            message: 'Filled-cell aggregation evidence is unavailable for this conversion',
          })
        );
      }

      return ok(
        FieldConversionDryRunResult.create({
          isNoop: facts.isNoop,
          isTypeConversion: facts.isTypeConversion,
          requiresDataRewrite: facts.requiresDataRewrite,
          affectedCellCount: facts.affectedCellCount,
          linkSideEffectCount: facts.linkSideEffectCount,
        })
      );
    });
  }
}
