import {
  type BulkRecordPreparationFacts,
  BulkRecordPreparationService,
  FieldKeyResolverService,
  type BulkRecordPreparedPolicy,
  type IReadOnlyBulkRecordPolicy,
  type IExecutionContext,
  TableQueryService,
  UpdateRecordsCommand,
  type DomainError,
  type Table,
} from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';

import type {
  IPreviewPlanner,
  OperationPreviewPlan,
  PreviewEffect,
  PreviewIssue,
  PreviewComplexityProjection,
  PreviewMeasure,
  PreviewOperationRegistration,
  PreviewOptions,
} from './types';

const countMeasure = (value: number | null, unit: string, reason: string): PreviewMeasure =>
  value == null ? { basis: 'unknown', unit, reason } : { basis: 'exact', value, unit };

const schemaEffects = (facts: BulkRecordPreparationFacts): ReadonlyArray<PreviewEffect> =>
  facts.schemaEffects.map((effect) => ({
    code: 'records.bulkUpdate.select_options_create',
    kind: 'dependency.change',
    resource: {
      visibility: 'authorized',
      kind: 'field',
      id: effect.fieldId.toString(),
    },
    measures: {
      createdOptions: {
        basis: 'exact',
        value: effect.options.length,
        unit: 'select-options',
      },
    },
  }));

const rowsEffect = (table: Table, facts: BulkRecordPreparationFacts): PreviewEffect => ({
  code: 'records.bulkUpdate.rows',
  kind: 'record.update',
  resource: {
    visibility: 'authorized',
    kind: 'table',
    id: table.id().toString(),
    name: table.name().toString(),
  },
  measures: {
    requestedRows: countMeasure(
      facts.requestedCount,
      'rows',
      'The write uses a selector rather than explicit record ids.'
    ),
    loadedRows: { basis: 'exact', value: facts.loadedCount, unit: 'rows' },
    selectedRows: { basis: 'exact', value: facts.selectedCount, unit: 'rows' },
    authorizedRows: countMeasure(
      facts.authorizedCount,
      'rows',
      'Record-write plugin policy was not checked by a read-only adapter.'
    ),
    acceptedRows: countMeasure(
      facts.acceptedCount,
      'rows',
      'Record-write plugin policy was not checked by a read-only adapter.'
    ),
    missingRows: countMeasure(
      facts.missingCount,
      'rows',
      'Missing rows cannot be distinguished for a selector.'
    ),
    pluginFilteredRows: countMeasure(
      facts.pluginFilteredCount,
      'rows',
      'Record-write plugin policy was not checked by a read-only adapter.'
    ),
    affectedRows: countMeasure(
      facts.affectedCount,
      'rows',
      'Actual updates depend on stored-value equality and persistence-time mutation resolution.'
    ),
  },
});

const buildEffects = (
  table: Table,
  facts: BulkRecordPreparationFacts,
  maxItems: number
): {
  readonly effects: ReadonlyArray<PreviewEffect>;
  readonly includedSchemaEffectCount: number;
  readonly projectedSchemaEffectCount: number;
} => {
  const projected = schemaEffects(facts);
  const included = projected.slice(0, Math.max(0, maxItems - 1));
  return {
    effects: [rowsEffect(table, facts), ...included],
    includedSchemaEffectCount: included.length,
    projectedSchemaEffectCount: projected.length,
  };
};

const collectIssues = (
  command: UpdateRecordsCommand,
  facts: BulkRecordPreparationFacts,
  effectCounts: { readonly includedSchemaEffects: number; readonly projectedSchemaEffects: number }
): { readonly blockers: PreviewIssue[]; readonly warnings: PreviewIssue[] } => {
  const blockers: PreviewIssue[] = [];
  const warnings: PreviewIssue[] = [];
  const filteredCount = facts.pluginFilteredCount ?? 0;
  const hasExplicitRequestedRows = command.records != null || command.recordIds != null;
  if (hasExplicitRequestedRows && facts.policyChecked && filteredCount > 0) {
    blockers.push({
      code: 'records.bulkUpdate.requested_rows_forbidden',
      message: 'One or more explicitly requested rows are outside the writable scope.',
    });
  } else if (filteredCount > 0) {
    warnings.push({
      code: 'records.bulkUpdate.selector_rows_filtered',
      message: 'The record-write policy excludes part of the selector result.',
    });
  }
  if ((facts.missingCount ?? 0) > 0) {
    warnings.push({
      code: 'records.bulkUpdate.requested_rows_missing',
      message: 'One or more explicitly requested rows do not exist.',
    });
  }
  if (!facts.policyChecked) {
    warnings.push({
      code: 'records.bulkUpdate.plugin_policy_not_checked',
      message: 'No explicitly read-only record-write policy adapter is registered.',
    });
  }
  if (effectCounts.includedSchemaEffects < effectCounts.projectedSchemaEffects) {
    warnings.push({
      code: 'records.bulkUpdate.effects_truncated',
      message: `Only ${effectCounts.includedSchemaEffects} of ${effectCounts.projectedSchemaEffects} schema effects are included.`,
    });
  }
  return { blockers, warnings };
};

const coverageFor = (
  command: UpdateRecordsCommand,
  facts: BulkRecordPreparationFacts
): OperationPreviewPlan['coverage'] => ({
  known: [
    'write-input',
    'record-selection',
    'existing-records',
    ...(facts.policyChecked ? ['record-write-policy', 'accepted-records'] : []),
    ...(command.typecast && facts.policyChecked ? ['typecast-schema-effects'] : []),
  ],
  unknown: [
    ...(facts.policyChecked ? [] : ['record-write-plugin-policy', 'authorized-records']),
    ...(command.typecast && !facts.policyChecked ? ['typecast-schema-effects'] : []),
    ...(facts.affectedCount == null ? ['affected-records'] : []),
    'record-write-plugin-before-persist',
    'record-write-plugin-after-commit',
  ],
});

const complexityProjectionFor = (
  command: UpdateRecordsCommand,
  facts: BulkRecordPreparationFacts,
  changedFieldIds: ReadonlySet<string>
): PreviewComplexityProjection => ({
  tableId: command.tableId.toString(),
  operation: {
    kind: 'update',
    tableId: command.tableId.toString(),
    changedFieldIds: [...changedFieldIds],
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
            message: 'The authorized bulk-update selection is unavailable to complexity analysis.',
          },
        ]
      : []),
  ],
});

const collectChangedFieldIds = (
  table: Table,
  command: UpdateRecordsCommand
): Result<ReadonlySet<string>, DomainError> => {
  const changedFieldIds = new Set<string>();
  const fieldValueGroups = command.records
    ? command.records.map((record) => record.fieldValues)
    : [command.fieldValues];
  for (const fieldValues of fieldValueGroups) {
    const resolved = FieldKeyResolverService.resolveFieldKeys(
      table,
      Object.fromEntries(fieldValues),
      command.fieldKeyType
    );
    if (resolved.isErr()) return err(resolved.error);
    for (const fieldId of Object.keys(resolved.value)) changedFieldIds.add(fieldId);
  }
  return ok(changedFieldIds);
};

export const parseBulkUpdatePreviewInput = (
  input: unknown
): Result<UpdateRecordsCommand, DomainError> => UpdateRecordsCommand.create(input);

export class BulkUpdatePreviewPlanner implements IPreviewPlanner<UpdateRecordsCommand> {
  readonly operation = 'records.bulkUpdate' as const;
  readonly plannerVersion = 'records-bulk-update-v1';
  readonly executionPath = 'UpdateRecordsCommand';

  constructor(
    private readonly tableQueryService: TableQueryService,
    private readonly preparationService: BulkRecordPreparationService,
    private readonly readOnlyPolicy?: IReadOnlyBulkRecordPolicy
  ) {}

  async preview(
    context: IExecutionContext,
    command: UpdateRecordsCommand,
    options: PreviewOptions
  ): Promise<Result<OperationPreviewPlan, DomainError>> {
    const tableResult = await this.tableQueryService.getById(context, command.tableId);
    if (tableResult.isErr()) return err(tableResult.error);
    const table = tableResult.value;

    const policy = await this.prepareReadOnlyPolicy(context, table, command);
    if (policy.isErr()) return err(policy.error);

    const factsResult = await this.preparationService.update(
      context,
      table,
      {
        ...(command.records ? { records: command.records } : {}),
        ...(command.recordIds ? { recordIds: command.recordIds } : {}),
        fieldValues: command.fieldValues,
        filter: command.filter,
        fieldKeyType: command.fieldKeyType,
        typecast: command.typecast,
        hasOrder: command.order != null,
      },
      policy.value
    );
    if (factsResult.isErr()) return err(factsResult.error);
    const facts = factsResult.value;

    const changedFieldIds = collectChangedFieldIds(table, command);
    if (changedFieldIds.isErr()) return err(changedFieldIds.error);

    const built = buildEffects(table, facts, options.maxItems);
    const issues = collectIssues(command, facts, {
      includedSchemaEffects: built.includedSchemaEffectCount,
      projectedSchemaEffects: built.projectedSchemaEffectCount,
    });

    return ok({
      effects: built.effects,
      blockers: issues.blockers,
      warnings: issues.warnings,
      coverage: coverageFor(command, facts),
      complexity: null,
      complexityProjection: complexityProjectionFor(command, facts, changedFieldIds.value),
      authorization: 'checked',
      consistency: 'best-effort',
    });
  }

  private async prepareReadOnlyPolicy(
    context: IExecutionContext,
    table: Table,
    command: UpdateRecordsCommand
  ): Promise<Result<BulkRecordPreparedPolicy | undefined, DomainError>> {
    if (!this.readOnlyPolicy) return ok(undefined);
    return this.readOnlyPolicy.prepare(context, {
      operation: 'update',
      table,
      ...(command.recordIds ? { recordIds: command.recordIds } : {}),
      fieldValues: command.records
        ? command.records.map((record) => record.fieldValues)
        : [command.fieldValues],
      typecast: command.typecast,
    });
  }
}

export const createBulkUpdatePreviewRegistration = (
  planner: BulkUpdatePreviewPlanner
): PreviewOperationRegistration<UpdateRecordsCommand> => ({
  operation: 'records.bulkUpdate',
  parseInput: parseBulkUpdatePreviewInput,
  planner,
  capability: {
    canonicalWriteRoute: 'POST /tables/updateRecords',
    supportLevel: 'partial',
    requiredPermissionScope: 'record.update',
    detailLevels: ['summary', 'full'],
    limitations: [
      'Authorization is unknown unless an explicitly read-only record-write policy adapter is registered.',
      'Affected rows remain unknown until persistence resolves stored-value equality.',
    ],
  },
});
