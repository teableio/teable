import {
  BulkRecordPreparationService,
  type BulkRecordPreparationFacts,
  type BulkRecordPreparedPolicy,
  FieldType,
  DeleteByRangeApplicationService,
  DeleteByRangeCommand,
  DeleteRecordsCommand,
  domainError,
  type DomainError,
  type IExecutionContext,
  type IReadOnlyBulkRecordPolicy,
  type RecordId,
  type Table,
  TableQueryService,
} from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';

import type {
  IPreviewPlanner,
  OperationPreviewPlan,
  PreviewComplexityProjection,
  PreviewEffect,
  PreviewIssue,
  PreviewMeasure,
  PreviewOperationRegistration,
  PreviewOptions,
} from './types';

export type BulkDeletePreviewInput = DeleteRecordsCommand | DeleteByRangeCommand;

type DeleteTarget = {
  readonly table: Table;
  readonly recordIds: ReadonlyArray<RecordId>;
  readonly rangeSelectedCount: number | undefined;
};

/** Distinguish native selectors from positional range deletion without discarding either contract. */
export const parseBulkDeletePreviewInput = (
  input: unknown
): Result<BulkDeletePreviewInput, DomainError> => {
  if (typeof input !== 'object' || input == null) {
    return err(
      domainError.validation({
        code: 'preview.records.bulkDelete.invalid_input',
        message: 'Expected DeleteRecordsCommand or DeleteByRangeCommand input.',
      })
    );
  }
  if ('targetRecordIds' in input || 'excludedTargetRecordIds' in input || 'batchSize' in input) {
    return err(
      domainError.validation({
        code: 'preview.records.bulkDelete.streaming_unsupported',
        message:
          'Streaming deletion has chunk-level policy semantics and is not a supported preview input.',
      })
    );
  }
  if (input instanceof DeleteRecordsCommand || input instanceof DeleteByRangeCommand) {
    return ok(input);
  }
  const hasRangeSelection = 'ranges' in input || 'viewId' in input;
  if ('recordIds' in input && input.recordIds !== undefined) {
    if (('filter' in input && input.filter !== undefined) || hasRangeSelection) {
      return err(
        domainError.validation({
          code: 'preview.records.bulkDelete.ambiguous_contract',
          message:
            'Explicit-id deletion cannot be combined with filter or range selection parameters.',
        })
      );
    }
    return DeleteRecordsCommand.create(input);
  }
  if (hasRangeSelection) return DeleteByRangeCommand.create(input);
  return DeleteRecordsCommand.create(input);
};

const rowMeasure = (value: number | null, reason: string): PreviewMeasure => {
  if (value == null) return { basis: 'unknown', unit: 'rows', reason };
  return { basis: 'exact', value, unit: 'rows' };
};

/** Range selection is planned without a write policy, so only selection facts are known. */
const emptyRangeFacts = (selectedCount: number): BulkRecordPreparationFacts => ({
  requestedCount: null,
  loadedCount: selectedCount,
  selectedCount,
  authorizedCount: null,
  acceptedCount: null,
  missingCount: 0,
  pluginFilteredCount: null,
  affectedCount: null,
  schemaEffects: [],
  policyChecked: false,
});

const collectIssues = (
  facts: BulkRecordPreparationFacts
): { readonly blockers: PreviewIssue[]; readonly warnings: PreviewIssue[] } => {
  const blockers: PreviewIssue[] = [];
  const warnings: PreviewIssue[] = [];
  if ((facts.pluginFilteredCount ?? 0) > 0) {
    blockers.push({
      code: 'records.bulkDelete.requested_rows_forbidden',
      message: 'The selected delete target includes rows outside the writable scope.',
    });
  }
  if ((facts.missingCount ?? 0) > 0) {
    warnings.push({
      code: 'records.bulkDelete.requested_rows_missing',
      message: 'Some requested rows are absent at the time of the read.',
    });
  }
  if (!facts.policyChecked) {
    warnings.push({
      code: 'records.bulkDelete.plugin_policy_not_checked',
      message: 'No explicitly read-only record-write policy adapter is registered.',
    });
  }
  return { blockers, warnings };
};

const rowsEffect = (
  target: DeleteTarget,
  command: BulkDeletePreviewInput,
  facts: BulkRecordPreparationFacts,
  blockers: ReadonlyArray<PreviewIssue>
): PreviewEffect => ({
  code: 'records.bulkDelete.rows',
  kind: 'record.delete',
  resource: {
    visibility: 'authorized',
    kind: 'table',
    id: target.table.id().toString(),
    name: target.table.name().toString(),
  },
  measures: {
    requestedRows:
      command instanceof DeleteByRangeCommand || !command.recordIds
        ? {
            basis: 'unknown',
            unit: 'rows',
            reason: 'Filter or range selection is not an explicit-id request.',
          }
        : { basis: 'exact', value: command.recordIds.length, unit: 'rows' },
    loadedRows: { basis: 'exact', value: facts.loadedCount, unit: 'rows' },
    selectedRows: {
      basis: 'exact',
      value: target.rangeSelectedCount ?? facts.selectedCount,
      unit: 'rows',
    },
    authorizedRows: rowMeasure(
      facts.authorizedCount,
      'Record-write policy was not checked by a read-only adapter.'
    ),
    acceptedRows: rowMeasure(
      facts.acceptedCount,
      'Record-write policy was not checked by a read-only adapter.'
    ),
    missingRows: rowMeasure(facts.missingCount, 'Missing records could not be established.'),
    pluginFilteredRows: rowMeasure(
      facts.pluginFilteredCount,
      'Record-write policy was not checked by a read-only adapter.'
    ),
    affectedRows:
      blockers.length > 0
        ? {
            basis: 'unknown',
            unit: 'rows',
            reason: 'The write is blocked before deletion.',
          }
        : rowMeasure(facts.affectedCount, 'Authorized delete scope is not known.'),
  },
});

const coverageFor = (
  rangeSelectedCount: number | undefined,
  facts: BulkRecordPreparationFacts
): OperationPreviewPlan['coverage'] => ({
  known: [
    'write-input',
    'record-selection',
    'existing-records',
    ...(rangeSelectedCount != null
      ? ['view-filter-search-sort-range-selection']
      : ['explicit-record-ids']),
    ...(facts.policyChecked ? ['record-write-policy'] : []),
  ],
  unknown: [
    ...(facts.policyChecked
      ? []
      : ['record-write-plugin-policy', 'authorized-records', 'affected-records']),
    'record-write-plugin-before-persist',
    'record-write-plugin-after-commit',
    'host-trash-retention',
    'host-usage',
  ],
});

const complexityProjectionFor = (
  command: BulkDeletePreviewInput,
  table: Table,
  facts: BulkRecordPreparationFacts
): PreviewComplexityProjection => ({
  tableId: command.tableId.toString(),
  operation: {
    kind: 'delete',
    tableId: command.tableId.toString(),
    changedFieldIds: table
      .getFields()
      .filter((field) => field.type().equals(FieldType.link()))
      .map((field) => field.id().toString()),
    beforeImage: 'unknown',
    dataPresence: facts.acceptedCount === 0 ? 'empty' : 'unknown',
  },
  ...(facts.acceptedCount == null ? {} : { assumptions: { seedRecordCount: facts.acceptedCount } }),
  includeCatalogStats: true,
  coverage: {
    known: [
      'complexity-operation-descriptor',
      ...(facts.acceptedCount == null ? [] : ['complexity-selection']),
    ],
    unknown: [
      'complexity-planner-projection',
      ...(facts.acceptedCount == null ? ['complexity-selection'] : []),
    ],
  },
  warnings: [
    {
      code: 'preview.complexity.planner_projection_unknown',
      message:
        'The write planner projection is unavailable; complexity uses schema-potential propagation only.',
    },
    ...(facts.acceptedCount == null
      ? [
          {
            code: 'preview.complexity.selection_unknown',
            message: 'The authorized bulk-delete selection is unavailable to complexity analysis.',
          },
        ]
      : []),
  ],
});

export class BulkDeletePreviewPlanner implements IPreviewPlanner<BulkDeletePreviewInput> {
  readonly operation = 'records.bulkDelete' as const;
  readonly plannerVersion = 'records-bulk-delete-v1';
  readonly executionPath = 'DeleteRecordsCommand|DeleteByRangeCommand';

  constructor(
    private readonly tableQueryService: TableQueryService,
    private readonly rangePreparationService: Pick<
      DeleteByRangeApplicationService,
      'prepareDelete'
    >,
    private readonly preparationService: BulkRecordPreparationService,
    private readonly readOnlyPolicy?: IReadOnlyBulkRecordPolicy
  ) {}

  async preview(
    context: IExecutionContext,
    command: BulkDeletePreviewInput,
    _options: PreviewOptions
  ): Promise<Result<OperationPreviewPlan, DomainError>> {
    const target = await this.resolveTarget(context, command);
    if (target.isErr()) return err(target.error);

    const policy = await this.prepareReadOnlyPolicy(context, target.value);
    if (policy.isErr()) return err(policy.error);

    const factsResult = await this.resolveFacts(context, target.value, policy.value);
    if (factsResult.isErr()) return err(factsResult.error);
    const facts = factsResult.value;

    const issues = collectIssues(facts);
    return ok({
      effects: [rowsEffect(target.value, command, facts, issues.blockers)],
      blockers: issues.blockers,
      warnings: issues.warnings,
      coverage: coverageFor(target.value.rangeSelectedCount, facts),
      complexity: null,
      complexityProjection: complexityProjectionFor(command, target.value.table, facts),
      authorization: 'checked',
      consistency: 'best-effort',
    });
  }

  private async resolveTarget(
    context: IExecutionContext,
    command: BulkDeletePreviewInput
  ): Promise<Result<DeleteTarget, DomainError>> {
    if (command instanceof DeleteByRangeCommand) {
      const rangePlan = await this.rangePreparationService.prepareDelete(context, command);
      if (rangePlan.isErr()) return err(rangePlan.error);
      const { table, recordIds } = rangePlan.value;
      return ok({ table, recordIds, rangeSelectedCount: recordIds.length });
    }
    if (command.filter || !command.recordIds) {
      // No predicate-aware read authorization adapter exists on this diagnostic path.
      // Refuse before any selection query rather than leaking hidden predicate matches.
      return err(
        domainError.validation({
          code: 'preview.records.bulkDelete.filter_unsupported',
          message:
            'Filter delete preview is unavailable without predicate-aware read authorization.',
        })
      );
    }
    const tableResult = await this.tableQueryService.getById(context, command.tableId);
    if (tableResult.isErr()) return err(tableResult.error);
    return ok({
      table: tableResult.value,
      recordIds: command.recordIds,
      rangeSelectedCount: undefined,
    });
  }

  private async prepareReadOnlyPolicy(
    context: IExecutionContext,
    target: DeleteTarget
  ): Promise<Result<BulkRecordPreparedPolicy | undefined, DomainError>> {
    if (!this.readOnlyPolicy) return ok(undefined);
    return this.readOnlyPolicy.prepare(context, {
      operation: 'delete',
      table: target.table,
      recordIds: target.recordIds,
    });
  }

  private async resolveFacts(
    context: IExecutionContext,
    target: DeleteTarget,
    policy: BulkRecordPreparedPolicy | undefined
  ): Promise<Result<BulkRecordPreparationFacts, DomainError>> {
    const selectedCount = target.rangeSelectedCount;
    if (selectedCount != null && !policy) return ok(emptyRangeFacts(selectedCount));
    return this.preparationService.delete(context, target.table, target.recordIds, policy);
  }
}

export const createBulkDeletePreviewRegistration = (
  planner: BulkDeletePreviewPlanner
): PreviewOperationRegistration<BulkDeletePreviewInput> => ({
  operation: 'records.bulkDelete',
  parseInput: parseBulkDeletePreviewInput,
  planner,
  capability: {
    canonicalWriteRoute: 'DELETE /tables/deleteRecords | DELETE /tables/deleteByRange',
    supportLevel: 'partial',
    requiredPermissionScope: 'record.delete',
    detailLevels: ['summary', 'full'],
    limitations: [
      'Streaming delete is excluded because its plugin policy is prepared per chunk.',
      'Authorization is unknown unless an explicitly read-only record-write policy adapter is registered.',
      'Filter delete preview is unsupported because predicate-aware read authorization is unavailable.',
      'Host trash retention and usage effects require a host preview adapter.',
    ],
  },
});
