import {
  DuplicateTableCommand,
  type DomainError,
  type IDuplicateTablePreparationService,
  type IExecutionContext,
  type TableDuplicatePreparation,
} from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';

import type {
  IPreviewPlanner,
  OperationPreviewPlan,
  PreviewEffect,
  PreviewIssue,
  PreviewOperationRegistration,
  PreviewOptions,
  PreviewResourceReference,
} from './types';

const blockedPlan = (error: DomainError): OperationPreviewPlan => ({
  effects: [],
  blockers: [
    {
      code: error.code,
      message: 'Table duplication cannot proceed with the supplied input and current metadata',
    },
  ],
  warnings: [],
  coverage: {
    known: ['table-duplicate-admission'],
    unknown: [
      'table-structure-copy',
      'field-mappings',
      'view-mappings',
      'link-reference-decisions',
      'record-copy',
      'table-operation-policy',
    ],
  },
  complexity: null,
  authorization: 'not-applicable',
  consistency: 'best-effort',
});

const authorizedResource = (
  kind: 'table' | 'field' | 'view',
  id: string,
  name: string
): PreviewResourceReference => ({
  visibility: 'authorized',
  kind,
  id,
  name,
});

const detailsFor = (
  preparation: TableDuplicatePreparation,
  options: PreviewOptions
): {
  readonly structureResources: ReadonlyArray<PreviewResourceReference> | undefined;
  readonly linkResources: ReadonlyArray<PreviewResourceReference> | undefined;
  readonly warnings: ReadonlyArray<PreviewIssue>;
} => {
  if (options.detail === 'summary') {
    return { structureResources: undefined, linkResources: undefined, warnings: [] };
  }

  const sourceFields = preparation.sourceTable.getFields();
  const structureResources = [
    ...sourceFields.map((field) =>
      authorizedResource('field', field.id().toString(), field.name().toString())
    ),
    ...preparation.sourceTable
      .views()
      .map((view) => authorizedResource('view', view.id().toString(), view.name().toString())),
  ];
  const linkFieldIds = new Set(preparation.linkDecisions.map((decision) => decision.sourceFieldId));
  const linkResources = sourceFields
    .filter((field) => linkFieldIds.has(field.id().toString()))
    .map((field) => authorizedResource('field', field.id().toString(), field.name().toString()));
  const truncated =
    structureResources.length > options.maxItems || linkResources.length > options.maxItems;

  return {
    structureResources: structureResources.slice(0, options.maxItems),
    linkResources: linkResources.slice(0, options.maxItems),
    warnings: truncated
      ? [
          {
            code: 'table.duplicate.preview_items_truncated',
            message: `Preview detail is limited to ${options.maxItems} resources`,
          },
        ]
      : [],
  };
};

const planFromPreparation = (
  preparation: TableDuplicatePreparation,
  options: PreviewOptions
): OperationPreviewPlan => {
  const details = detailsFor(preparation, options);
  const sourceTable = preparation.sourceTable;
  const selfLinkCount = preparation.linkDecisions.filter(
    (decision) => decision.decision === 'self-remapped'
  ).length;
  const crossBaseLinkCount = preparation.linkDecisions.filter(
    (decision) => decision.decision === 'cross-base-host-policy'
  ).length;
  const externalLinkCount = preparation.linkDecisions.length - selfLinkCount - crossBaseLinkCount;

  const effects: PreviewEffect[] = [
    {
      code: 'table.duplicate.structure.copy',
      kind: 'resource.copy',
      summary: 'Copy table structure in the same base with new field and view identities',
      resource: authorizedResource(
        'table',
        sourceTable.id().toString(),
        sourceTable.name().toString()
      ),
      ...(details.structureResources ? { relatedResources: details.structureResources } : {}),
      measures: {
        tables: { basis: 'exact', value: 1, unit: 'tables' },
        fields: {
          basis: 'exact',
          value: preparation.fieldIdMap.size,
          unit: 'fields',
        },
        views: {
          basis: 'exact',
          value: preparation.viewIdMap.size,
          unit: 'views',
        },
      },
    },
  ];

  if (preparation.linkDecisions.length > 0) {
    effects.push({
      code: 'table.duplicate.link_references.classify',
      kind: 'dependency.change',
      summary: 'Remap self-links and classify external reference decisions',
      ...(details.linkResources ? { relatedResources: details.linkResources } : {}),
      measures: {
        selfLinksRemapped: { basis: 'exact', value: selfLinkCount, unit: 'fields' },
        externalLinksPreserved: {
          basis: 'exact',
          value: externalLinkCount,
          unit: 'fields',
        },
        crossBaseLinks: { basis: 'exact', value: crossBaseLinkCount, unit: 'fields' },
      },
    });
  }

  const unknownCoverage: string[] = [
    'table-operation-policy',
    ...(crossBaseLinkCount > 0 ? ['cross-space-reference-policy'] : []),
  ];
  const warnings: PreviewIssue[] = [
    ...details.warnings,
    {
      code: 'table.duplicate.table_policy_unchecked',
      message: 'Execution-only table operation plugins are not run during preview',
    },
    ...(crossBaseLinkCount > 0
      ? [
          {
            code: 'table.duplicate.cross_space_policy_host_owned',
            message: 'Cross-space link handling is decided by the host before core execution',
          },
        ]
      : []),
  ];
  if (!preparation.includeRecords) {
    effects.push({
      code: 'table.duplicate.records.omitted',
      kind: 'record.insert',
      summary: 'Do not copy source records',
      measures: { records: { basis: 'exact', value: 0, unit: 'records' } },
    });
  } else {
    effects.push({
      code: 'table.duplicate.records.copy',
      kind: 'record.insert',
      summary: 'Copy source records into the duplicated table',
      measures: {
        records: {
          basis: 'unknown',
          unit: 'records',
          reason: 'The duplicate execution path does not count source rows during preparation',
        },
      },
    });
    unknownCoverage.push('source-record-count');

    if (preparation.recordCopyPath.classification === 'physical-pending-metadata') {
      unknownCoverage.push('final-record-copy-path', 'hydrated-record-write-policy');
      warnings.push({
        code: 'table.duplicate.physical_path_pending_metadata',
        message:
          'Physical row copy is preferred, but final applicability depends on target metadata assigned during persistence',
      });
    } else if (preparation.recordCopyPath.classification === 'hydrated') {
      unknownCoverage.push('hydrated-record-write-policy');
      warnings.push({
        code: 'table.duplicate.hydrated_path_required',
        message: 'Source link storage requires hydrated record copy during execution',
      });
    } else if (preparation.recordCopyPath.classification === 'unknown') {
      unknownCoverage.push('final-record-copy-path', 'hydrated-record-write-policy');
      warnings.push({
        code: 'table.duplicate.source_physical_metadata_unavailable',
        message: 'Source physical metadata is insufficient to classify the record copy path',
      });
    }
  }

  return {
    effects,
    blockers: [],
    warnings,
    coverage: {
      known: [
        'same-base-aggregate-duplication',
        'field-mappings',
        'view-mappings',
        'link-reference-decisions',
        'formula-admission',
        'record-inclusion-request',
      ],
      unknown: unknownCoverage,
    },
    complexity: null,
    authorization: 'not-applicable',
    consistency: 'best-effort',
  };
};

export class TableDuplicatePreviewPlanner implements IPreviewPlanner<DuplicateTableCommand> {
  readonly operation = 'table.duplicate' as const;
  readonly plannerVersion = 'table-duplicate-v1';
  readonly executionPath = 'DuplicateTableCommand/DuplicateTablePreparationService';

  constructor(private readonly preparationService: IDuplicateTablePreparationService) {}

  async preview(
    context: IExecutionContext,
    command: DuplicateTableCommand,
    options: PreviewOptions
  ): Promise<Result<OperationPreviewPlan, DomainError>> {
    const preparation = await this.preparationService.prepare(context, command);
    if (preparation.isOk()) return ok(planFromPreparation(preparation.value, options));

    const error = preparation.error;
    if (error.tags.includes('validation') || error.tags.includes('conflict')) {
      return ok(blockedPlan(error));
    }
    return err(error);
  }
}

export const createTableDuplicatePreviewRegistration = (
  preparationService: IDuplicateTablePreparationService
): PreviewOperationRegistration<DuplicateTableCommand> => ({
  operation: 'table.duplicate',
  parseInput: DuplicateTableCommand.create,
  planner: new TableDuplicatePreviewPlanner(preparationService),
  capability: {
    canonicalWriteRoute: 'POST /tables/duplicateTable',
    supportLevel: 'partial',
    requiredPermissionScope: 'table:create,table:read',
    detailLevels: ['summary', 'full'],
    limitations: [
      'Same-base only; destination-space placement and cross-space reference policy are host-owned.',
      'Execution-only table operation plugins are not run during preview.',
      'Final physical row-copy applicability and source row count are unavailable before persistence.',
    ],
  },
});
