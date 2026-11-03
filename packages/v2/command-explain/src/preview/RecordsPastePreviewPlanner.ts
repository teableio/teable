import {
  PasteCommand,
  type DomainError,
  type IExecutionContext,
  type PastePreparation,
  type PastePreparationService,
} from '@teable/v2-core';
import type { Result } from 'neverthrow';

import type {
  IPreviewPlanner,
  OperationPreviewPlan,
  PreviewEffect,
  PreviewIssue,
  PreviewOperationRegistration,
  PreviewOptions,
} from './types';

const exact = (value: number, unit: string) => ({
  basis: 'exact' as const,
  value,
  unit,
});

const unknown = (unit: string, reason: string) => ({
  basis: 'unknown' as const,
  unit,
  reason,
});

const buildEffects = (preparation: PastePreparation): ReadonlyArray<PreviewEffect> => {
  const { facts } = preparation;
  const effects: PreviewEffect[] = [];

  if (facts.updateCandidates > 0) {
    effects.push({
      kind: 'record.update',
      code: 'records.paste.update_candidates',
      measures: {
        submittedRows: exact(facts.submittedRows, 'rows'),
        selectedRows: exact(facts.selectedRows, 'rows'),
        prePolicyAcceptedRows: exact(facts.acceptedRows, 'rows'),
        acceptedRows: unknown('rows', 'Record-write policy is evaluated only during execution'),
        updateCandidates: exact(facts.updateCandidates, 'rows'),
        affectedRows: unknown(
          'rows',
          'Record-write policy and persisted value comparison run only during execution'
        ),
      },
    });
  }

  if (facts.createCandidates > 0) {
    effects.push({
      kind: 'record.insert',
      code: 'records.paste.create_candidates',
      measures: {
        createCandidates: exact(facts.createCandidates, 'rows'),
        affectedRows: unknown(
          'rows',
          'Record-write policy and persistence run only during execution'
        ),
      },
    });
  }

  if (facts.columnExpansionCount > 0) {
    effects.push({
      kind: 'dependency.change',
      code: 'records.paste.column_expansion',
      measures: {
        candidateFields: exact(facts.columnExpansionCount, 'fields'),
        affectedFields: unknown(
          'fields',
          'The projected fields are persisted only when an executable paste remains after write policy'
        ),
      },
    });
  }

  const optionCount = facts.selectOptionCreations.reduce(
    (sum, projection) => sum + projection.optionCount,
    0
  );
  if (optionCount > 0) {
    effects.push({
      kind: 'dependency.change',
      code: 'records.paste.select_options',
      measures: {
        candidateOptions: exact(optionCount, 'select-options'),
        affectedOptions: unknown(
          'select-options',
          'Write policy can remove records or fields before select options are persisted'
        ),
      },
    });
  }

  if (facts.linkTitleResolutionCandidateCount > 0) {
    effects.push({
      kind: 'record.insert',
      code: 'records.paste.link_auto_create_candidates',
      measures: {
        candidateValues: exact(facts.linkTitleResolutionCandidateCount, 'link-values'),
        affectedRows: unknown(
          'records',
          'Existing foreign-title matches and execution-only link creation determine created rows'
        ),
      },
    });
  }

  return effects;
};

const buildBlockers = (preparation: PastePreparation): ReadonlyArray<PreviewIssue> =>
  preparation.facts.rejectedSelectedRows > 0
    ? [
        {
          code: 'records.paste.selected_rows_not_writable',
          message: `${preparation.facts.rejectedSelectedRows} selected row(s) are excluded by the write filter`,
        },
      ]
    : [];

export class RecordsPastePreviewPlanner implements IPreviewPlanner<PasteCommand> {
  readonly operation = 'records.paste' as const;
  readonly plannerVersion = 'records-paste-v1';
  readonly executionPath = 'PasteHandler';

  constructor(private readonly preparationService: PastePreparationService) {}

  async preview(
    context: IExecutionContext,
    command: PasteCommand,
    _options: PreviewOptions
  ): Promise<Result<OperationPreviewPlan, DomainError>> {
    return (
      await this.preparationService.prepare(context, command, {
        readAuthorization: 'unknown',
      })
    ).map((preparation) => {
      const unknownCoverage = [
        'record-query-plugin-policy',
        'record-write-plugin-policy',
        'external-write-hooks',
        'authoritative-affected-rows',
      ];
      const warnings: PreviewIssue[] = [
        {
          code: 'records.paste.write_policy_not_evaluated',
          message: 'Execution-only record policy and external hooks are evaluated by the write',
        },
      ];
      if (preparation.facts.selectOptionProjection === 'unknown') {
        unknownCoverage.push('select-option-projection');
        warnings.push({
          code: 'records.paste.select_option_projection_unknown',
          message: 'Select-option candidates could not be established from detached inputs',
        });
      }
      if (preparation.facts.linkTitleProjection === 'unknown') {
        unknownCoverage.push('link-title-candidate-projection');
      }
      if (preparation.facts.linkTitleResolutionCandidateCount > 0) {
        unknownCoverage.push('link-auto-create-record-count');
        warnings.push({
          code: 'records.paste.link_auto_create_count_unknown',
          message:
            'Link values may reuse existing foreign records or create records during execution',
        });
      }

      return {
        effects: buildEffects(preparation),
        blockers: buildBlockers(preparation),
        warnings,
        coverage: {
          known: [
            'view-defaults',
            'filter-search-range-selection',
            'readable-field-projection-without-plugins',
            'editable-field-selection',
            'create-update-split',
            'column-expansion-projection',
            ...(preparation.facts.selectOptionProjection === 'known'
              ? ['select-option-projection']
              : []),
            ...(preparation.facts.linkTitleProjection === 'known'
              ? ['link-title-candidate-projection']
              : []),
          ],
          unknown: unknownCoverage,
        },
        complexity: null,
        complexityProjection: {
          tableId: command.tableId.toString(),
          operation: {
            kind: 'paste',
            tableId: command.tableId.toString(),
            changedFieldIds: preparation.editableColumns.map((column) => column.fieldId.toString()),
            ...(preparation.facts.createCandidates > 0 && preparation.facts.updateCandidates > 0
              ? { pasteMode: 'mixed' as const }
              : preparation.facts.createCandidates > 0
                ? { pasteMode: 'insert' as const }
                : preparation.facts.updateCandidates > 0
                  ? { pasteMode: 'update' as const }
                  : {}),
            dataPresence: preparation.facts.acceptedRows === 0 ? 'empty' : 'unknown',
          },
          assumptions: { seedRecordCount: preparation.facts.acceptedRows },
          includeCatalogStats: true,
          coverage: {
            known: ['complexity-operation-descriptor', 'complexity-selection-projection'],
            unknown: ['complexity-planner-projection', 'complexity-authoritative-selection'],
          },
          warnings: [
            {
              code: 'preview.complexity.planner_projection_unknown',
              message:
                'The write planner projection is unavailable; complexity uses schema-potential propagation only.',
            },
            {
              code: 'preview.complexity.selection_unknown',
              message:
                'The complexity seed count reflects prepared paste candidates before execution-only write policy.',
            },
          ],
        },
        authorization: 'checked' as const,
        consistency: 'best-effort' as const,
      };
    });
  }
}

export const parseRecordsPastePreviewInput = (input: unknown) => PasteCommand.create(input);

export const createRecordsPastePreviewRegistration = (
  planner: RecordsPastePreviewPlanner
): PreviewOperationRegistration<PasteCommand> => ({
  operation: 'records.paste',
  parseInput: parseRecordsPastePreviewInput,
  planner,
  capability: {
    canonicalWriteRoute: 'POST /tables/paste',
    supportLevel: 'partial',
    requiredPermissionScope: 'record.create+record.update',
    detailLevels: ['summary', 'full'],
    limitations: [
      'Record query and write plugins are evaluated only by execution',
      'Affected rows and link auto-created records are unknown until execution',
    ],
  },
});
