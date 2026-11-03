import {
  type DomainError,
  type FieldConversionPreparation,
  type IExecutionContext,
  type ITableRecordAggregationQueryRepository,
  UpdateFieldCommand,
} from '@teable/v2-core';
import type { Result } from 'neverthrow';

import type {
  IPreviewPlanner,
  OperationPreviewPlan,
  PreviewEffect,
  PreviewMeasure,
  PreviewOperationRegistration,
  PreviewOptions,
} from './types';

type FieldConversionPreparer = {
  prepare(
    context: IExecutionContext,
    input: unknown,
    options: {
      readonly allowNoop: true;
      readonly aggregationRepository: Pick<ITableRecordAggregationQueryRepository, 'aggregate'>;
    }
  ): Promise<Result<FieldConversionPreparation, DomainError>>;
};

const exact = (value: number, unit: string): PreviewMeasure => ({
  basis: 'exact',
  value,
  unit,
});

const conversionEffect = (facts: FieldConversionPreparation): PreviewEffect => ({
  code: facts.isNoop
    ? 'field.conversion.noop'
    : facts.isTypeConversion
      ? 'field.conversion.type_change'
      : 'field.conversion.metadata_change',
  kind: 'field.conversion',
  measures: {
    changedFields: exact(facts.isNoop ? 0 : 1, 'fields'),
  },
});

/** Canonical normalization of the shared core preparation facts. */
export class FieldConvertPreviewPlanner implements IPreviewPlanner<unknown> {
  readonly operation = 'field.convert' as const;
  readonly plannerVersion = '1';
  readonly executionPath = 'UpdateFieldHandler';

  constructor(
    private readonly preparationService: FieldConversionPreparer,
    private readonly aggregationRepository: Pick<
      ITableRecordAggregationQueryRepository,
      'aggregate'
    >
  ) {}

  async preview(
    context: IExecutionContext,
    input: unknown,
    _options: PreviewOptions
  ): Promise<Result<OperationPreviewPlan, DomainError>> {
    const preparation = await this.preparationService.prepare(context, input, {
      allowNoop: true,
      aggregationRepository: this.aggregationRepository,
    });
    return preparation.map((facts) => {
      const effects: PreviewEffect[] = [conversionEffect(facts)];
      if (facts.requiresDataRewrite) {
        effects.push({
          code: 'field.conversion.record_rewrite',
          kind: 'record.rewrite',
          measures: {
            affectedCells:
              facts.affectedCellCount == null
                ? {
                    basis: 'unknown',
                    unit: 'cells',
                    reason: 'filled-cell aggregation did not return evidence for the target field',
                  }
                : exact(facts.affectedCellCount, 'cells'),
          },
        });
      }
      if (facts.linkSideEffectCount > 0) {
        effects.push({
          code: 'field.conversion.link_side_effects',
          kind: 'dependency.change',
          measures: {
            changedDependencies: exact(facts.linkSideEffectCount, 'fields'),
          },
        });
      }

      const unknown: string[] = ['fieldOperationPolicies'];
      if (facts.requiresDataRewrite && facts.affectedCellCount == null) {
        unknown.push('affectedCellCount');
      }

      return {
        effects,
        blockers: [],
        warnings: [],
        coverage: {
          known: [
            'updateInputValidation',
            'foreignTableReferences',
            'updateSpecifications',
            'conversionClassification',
            'dataRewriteRequirement',
            'linkSideEffects',
            ...(facts.affectedCellCount == null ? [] : ['affectedCellCount']),
          ],
          unknown,
        },
        complexity: null,
        complexityProjection: {
          tableId: facts.command.tableId.toString(),
          operation: {
            kind: 'field-change',
            tableId: facts.command.tableId.toString(),
            changedFieldIds: [facts.command.fieldId.toString()],
            fieldChange: facts.isTypeConversion ? 'convert' : 'update',
            dataPresence: facts.affectedCellCount === 0 ? 'empty' : 'unknown',
          },
          ...(facts.affectedCellCount == null
            ? {}
            : { assumptions: { seedRecordCount: facts.affectedCellCount } }),
          includeCatalogStats: true,
          coverage: {
            known: [
              'complexity-operation-descriptor',
              ...(facts.affectedCellCount == null ? [] : ['complexity-selection']),
            ],
            unknown: [
              'complexity-planner-projection',
              ...(facts.affectedCellCount == null ? ['complexity-selection'] : []),
            ],
          },
          warnings: [
            {
              code: 'preview.complexity.planner_projection_unknown',
              message:
                'The write planner projection is unavailable; complexity uses schema-potential propagation only.',
            },
            ...(facts.affectedCellCount == null
              ? [
                  {
                    code: 'preview.complexity.selection_unknown',
                    message: 'The field conversion rewrite row count is unavailable.',
                  },
                ]
              : []),
          ],
        },
        authorization: 'not-applicable',
        consistency: 'best-effort',
      };
    });
  }
}

export const createFieldConvertPreviewRegistration = (
  planner: FieldConvertPreviewPlanner
): PreviewOperationRegistration<UpdateFieldCommand> => ({
  operation: 'field.convert',
  parseInput: (input) => UpdateFieldCommand.create(input, { allowNoop: true }),
  planner,
  capability: {
    canonicalWriteRoute: 'POST /tables/updateField',
    supportLevel: 'partial',
    requiredPermissionScope: 'field.update',
    detailLevels: ['summary', 'full'],
    limitations: [
      'Execution-only field operation plugins are not run during preview.',
      'Downstream field-update cascades require a read-only host adapter.',
    ],
  },
});
