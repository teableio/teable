import {
  DeleteTableCommand,
  type DomainError,
  type IExecutionContext,
  type ITableDeletionPreparationService,
  type TableDeletionPreparation,
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

type TableDeletionReaction = TableDeletionPreparation['sideEffects']['reactionEffects'][number];

const exactOne = (unit: string) => ({ basis: 'exact' as const, value: 1, unit });
export type TableDeletePreviewResource = {
  readonly kind: 'table' | 'field';
  readonly id: string;
  readonly tableId?: string;
};

export interface ITableDeletePreviewAuthorization {
  canReadResource(
    context: IExecutionContext,
    resource: TableDeletePreviewResource
  ): Promise<Result<boolean, DomainError>>;
}

const redactedResource = (
  kind: TableDeletePreviewResource['kind'],
  reason: string
): PreviewResourceReference => ({
  visibility: 'redacted',
  kind,
  quantity: { basis: 'unknown', unit: kind, reason },
  reason,
});

const resourceReference = async (
  context: IExecutionContext,
  authorization: ITableDeletePreviewAuthorization | undefined,
  resource: TableDeletePreviewResource,
  name: string
): Promise<Result<PreviewResourceReference, DomainError>> => {
  if (!authorization) {
    return ok(redactedResource(resource.kind, 'authorization-scope-unavailable'));
  }
  const allowed = await authorization.canReadResource(context, resource);
  if (allowed.isErr()) {
    return allowed.error.tags.some((tag) => tag === 'forbidden')
      ? ok(redactedResource(resource.kind, 'resource-authorization-denied'))
      : err(allowed.error);
  }
  return ok(
    allowed.value
      ? { visibility: 'authorized', kind: resource.kind, id: resource.id, name }
      : redactedResource(resource.kind, 'resource-not-authorized')
  );
};

const visibleOne = (resource: PreviewResourceReference, unit: string) =>
  resource.visibility === 'authorized'
    ? exactOne(unit)
    : { basis: 'unknown' as const, unit, reason: 'resource-redacted' };

const blockerPlan = (
  error: DomainError,
  authorization: 'checked' | 'not-applicable'
): OperationPreviewPlan => ({
  effects: [],
  blockers: [{ code: error.code, message: error.message }],
  warnings: [],
  coverage: {
    known: ['table-delete-domain-invariants'],
    unknown: ['table-delete-effects', 'host.trash-retention', 'host.usage-effects'],
  },
  complexity: null,
  authorization,
  consistency: 'best-effort',
});

/** Validation/conflict/invariant failures describe the write, so they are returned as blockers. */
const isPreviewablePreparationFailure = (error: DomainError): boolean =>
  error.tags.some(
    (tag) =>
      tag === 'validation' || tag === 'conflict' || tag === 'invariant' || tag === 'forbidden'
  );

const describeReaction = (
  consequence: TableDeletionReaction['consequence']
): Pick<PreviewEffect, 'code' | 'kind' | 'summary'> => {
  if (consequence === 'inbound-link-converted-to-text') {
    return {
      code: 'table.delete.inbound_link.converted_to_text',
      kind: 'field.conversion',
      summary: 'An inbound link field will be converted to text.',
    };
  }
  if (consequence === 'dependent-field-marked-error') {
    return {
      code: 'table.delete.dependent_field.marked_error',
      kind: 'dependency.change',
      summary: 'A dependent field will be updated because its referenced table is deleted.',
    };
  }
  return {
    code: 'table.delete.dependent_field.updated',
    kind: 'dependency.change',
    summary: 'A dependent field will be updated because its referenced table is deleted.',
  };
};

const collectWarnings = (
  value: TableDeletionPreparation,
  authorizedReactionsTruncated: boolean
): PreviewIssue[] => {
  const warnings: PreviewIssue[] = [];
  if (value.sourceState === 'trashed') {
    warnings.push({
      code: 'table.delete.already_trashed',
      message: 'The table is already trashed and will now be permanently deleted.',
    });
  }
  if (value.sideEffects.candidateEvidence === 'unknown') {
    warnings.push({
      code: 'table.delete.inbound_reference_metadata_unknown',
      message: 'Available candidate metadata does not establish complete inbound impact.',
    });
  }
  if (authorizedReactionsTruncated) {
    warnings.push({
      code: 'table.delete.effects_truncated',
      message: 'Authorized field effect details were truncated.',
    });
  }
  if (value.sideEffects.downstreamCascadeEvidence === 'unknown') {
    warnings.push({
      code: 'table.delete.downstream_cascade_unknown',
      message:
        'Inbound-link after-persist cascades are execution-only and not included in projected field effects.',
    });
  }
  return warnings;
};

export class TableDeletePreviewPlanner implements IPreviewPlanner<DeleteTableCommand> {
  readonly operation = 'table.delete' as const;
  readonly plannerVersion = '1';
  readonly executionPath = 'DeleteTableHandler/TableDeletionPreparationService';

  constructor(
    private readonly preparationService: ITableDeletionPreparationService,
    private readonly authorization?: ITableDeletePreviewAuthorization
  ) {}

  async preview(
    context: IExecutionContext,
    command: DeleteTableCommand,
    options: PreviewOptions
  ): Promise<Result<OperationPreviewPlan, DomainError>> {
    const preparation = await this.preparationService.prepare(context, command);
    if (preparation.isErr()) {
      if (!isPreviewablePreparationFailure(preparation.error)) return err(preparation.error);
      return ok(blockerPlan(preparation.error, this.authorization ? 'checked' : 'not-applicable'));
    }

    const value = preparation.value;
    const limit = options.detail === 'full' ? options.maxItems : Math.min(10, options.maxItems);

    const targetEffect = await this.describeTargetEffect(context, value);
    if (targetEffect.isErr()) return err(targetEffect.error);

    const reactionEffects = await this.describeReactionEffects(context, value, limit);
    if (reactionEffects.isErr()) return err(reactionEffects.error);

    return ok({
      effects: [targetEffect.value, ...reactionEffects.value.effects],
      blockers: value.blockers.map((blocker) => ({
        code: blocker.code,
        message: blocker.message,
      })),
      warnings: [
        ...collectWarnings(value, reactionEffects.value.authorizedReactionsTruncated),
        ...this.scopeWarnings(),
      ],
      coverage: {
        known: ['target-table', 'delete-mode', 'core-table-deletion-direct-reactions'],
        unknown: [
          ...this.unknownCoverage(value),
          ...(reactionEffects.value.resourcesRedacted ||
          targetEffect.value.resource?.visibility === 'redacted'
            ? ['redacted-dependent-resource-cardinality']
            : []),
        ],
      },
      complexity: null,
      authorization: this.authorization ? 'checked' : 'not-applicable',
      consistency: 'best-effort',
    });
  }

  private async describeTargetEffect(
    context: IExecutionContext,
    value: TableDeletionPreparation
  ): Promise<Result<PreviewEffect, DomainError>> {
    const resource = await resourceReference(
      context,
      this.authorization,
      { kind: 'table', id: value.table.id().toString() },
      value.table.name().toString()
    );
    if (resource.isErr()) return err(resource.error);
    const soft = value.mode === 'soft';
    return ok({
      code: soft ? 'table.delete.resource.trashed' : 'table.delete.resource.permanently_deleted',
      kind: soft ? 'resource.trash' : 'resource.permanent-delete',
      summary: soft
        ? 'The table will be moved to trash.'
        : 'The table will be permanently deleted.',
      resource: resource.value,
      measures: { tables: visibleOne(resource.value, 'table') },
    });
  }

  private async describeReactionEffects(
    context: IExecutionContext,
    value: TableDeletionPreparation,
    limit: number
  ): Promise<
    Result<
      {
        effects: PreviewEffect[];
        authorizedReactionsTruncated: boolean;
        resourcesRedacted: boolean;
      },
      DomainError
    >
  > {
    const authorizedEffects: PreviewEffect[] = [];
    let resourcesRedacted = false;
    for (const reaction of value.sideEffects.reactionEffects) {
      const fieldResource = await resourceReference(
        context,
        this.authorization,
        { kind: 'field', id: reaction.fieldId, tableId: reaction.tableId },
        reaction.fieldName
      );
      if (fieldResource.isErr()) return err(fieldResource.error);
      if (fieldResource.value.visibility === 'redacted') {
        resourcesRedacted = true;
        continue;
      }
      const tableResource = await resourceReference(
        context,
        this.authorization,
        { kind: 'table', id: reaction.tableId },
        reaction.tableName
      );
      if (tableResource.isErr()) return err(tableResource.error);
      if (tableResource.value.visibility === 'redacted') {
        resourcesRedacted = true;
        continue;
      }
      authorizedEffects.push({
        ...describeReaction(reaction.consequence),
        resource: fieldResource.value,
        relatedResources: [tableResource.value],
        measures: { fields: visibleOne(fieldResource.value, 'field') },
      });
    }
    const effects = authorizedEffects.slice(0, limit);
    if (resourcesRedacted) {
      const resource = redactedResource('field', 'dependent-resource-redacted');
      // Neither the number of reactions nor their categories are authorized for disclosure.
      effects.push({
        code: 'table.delete.dependent_resources.redacted',
        kind: 'dependency.change',
        summary: 'Dependent resource details are redacted.',
        resource,
        measures: { fields: visibleOne(resource, 'field') },
      });
    }
    return ok({
      effects,
      authorizedReactionsTruncated: authorizedEffects.length > limit,
      resourcesRedacted,
    });
  }

  private scopeWarnings(): PreviewIssue[] {
    if (this.authorization) return [];
    return [
      {
        code: 'table.delete.authorization_scope_unavailable',
        message:
          'Resource identities are redacted because no preview authorization adapter is registered.',
      },
    ];
  }

  private unknownCoverage(value: TableDeletionPreparation): string[] {
    const unknown = ['host.trash-retention', 'host.usage-effects'];
    if (value.sideEffects.candidateEvidence === 'unknown') {
      unknown.unshift('inbound-reference-metadata');
    }
    if (value.sideEffects.downstreamCascadeEvidence === 'unknown') {
      unknown.push('inbound-link-downstream-cascades');
    }
    if (!this.authorization) {
      unknown.push('dependent-resource-authorization');
    }
    return unknown;
  }
}

export const createTableDeletePreviewRegistration = (
  planner: TableDeletePreviewPlanner
): PreviewOperationRegistration<DeleteTableCommand> => ({
  operation: 'table.delete',
  parseInput: DeleteTableCommand.create,
  planner,
  capability: {
    canonicalWriteRoute: 'DELETE /tables/delete',
    supportLevel: 'partial',
    requiredPermissionScope: 'table.delete',
    detailLevels: ['summary', 'full'],
    limitations: [
      'A preview authorization adapter is required to return resource identities.',
      'Host trash retention and usage effects require the host preview adapter.',
      'Execution-only inbound-link cascades are reported as unknown.',
    ],
  },
});
