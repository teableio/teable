import {
  DeleteFieldCommand,
  type DomainError,
  type FieldDeletionPreparation,
  type FieldDeletionPreparationService,
  type IExecutionContext,
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

const exact = (value: number, unit: string) => ({ basis: 'exact' as const, value, unit });

export type FieldDeletePreviewResource = {
  readonly kind: 'field' | 'table' | 'view';
  readonly id: string;
  readonly tableId?: string;
};

export interface IFieldDeletePreviewAuthorization {
  canReadResource(
    context: IExecutionContext,
    resource: FieldDeletePreviewResource
  ): Promise<Result<boolean, DomainError>>;
}

const redactedResource = (
  kind: FieldDeletePreviewResource['kind'],
  reason: string
): PreviewResourceReference => ({
  visibility: 'redacted',
  kind,
  quantity: { basis: 'unknown', unit: kind, reason },
  reason,
});

const resourceReference = async (
  context: IExecutionContext,
  authorization: IFieldDeletePreviewAuthorization | undefined,
  resource: FieldDeletePreviewResource,
  name?: string
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
      ? {
          visibility: 'authorized',
          kind: resource.kind,
          id: resource.id,
          ...(name ? { name } : {}),
        }
      : redactedResource(resource.kind, 'resource-not-authorized')
  );
};

const visibleMeasure = (
  resources: ReadonlyArray<PreviewResourceReference>,
  value: number,
  unit: string
) =>
  resources.every((resource) => resource.visibility === 'authorized')
    ? exact(value, unit)
    : {
        basis: 'unknown' as const,
        unit,
        reason: 'one-or-more-resources-redacted',
      };

type FieldDeleteEffects = {
  readonly effects: ReadonlyArray<PreviewEffect>;
  readonly authorizedResourcesTruncated: boolean;
  readonly resourcesRedacted: boolean;
};

const effectsFrom = async (
  context: IExecutionContext,
  authorization: IFieldDeletePreviewAuthorization | undefined,
  preparation: FieldDeletionPreparation,
  options: PreviewOptions
): Promise<Result<FieldDeleteEffects, DomainError>> => {
  const effects: PreviewEffect[] = [];
  let authorizedResourcesTruncated = false;
  let resourcesRedacted = false;
  for (const target of preparation.directTargets) {
    const resource = await resourceReference(
      context,
      authorization,
      { kind: 'field', id: target.fieldId, tableId: target.tableId },
      target.fieldName
    );
    if (resource.isErr()) return err(resource.error);
    const table = await resourceReference(
      context,
      authorization,
      { kind: 'table', id: target.tableId },
      target.tableName
    );
    if (table.isErr()) return err(table.error);
    resourcesRedacted ||=
      resource.value.visibility === 'redacted' || table.value.visibility === 'redacted';
    effects.push({
      code: 'field.delete.target',
      kind: 'resource.permanent-delete',
      resource: resource.value,
      relatedResources: [table.value],
      measures: { fields: visibleMeasure([resource.value], 1, 'field') },
    });
  }

  const addRelatedEffect = async (
    code: string,
    items: ReadonlyArray<{ id: string; name: string; tableId: string }>,
    kind: 'field' | 'view',
    unit: 'field' | 'view'
  ): Promise<Result<void, DomainError>> => {
    if (items.length === 0) return ok(undefined);
    const checkedResources: PreviewResourceReference[] = [];
    const detailLimit =
      options.detail === 'full' ? options.maxItems : Math.min(10, options.maxItems);
    for (const item of items) {
      const resource = await resourceReference(
        context,
        authorization,
        { kind, id: item.id, tableId: item.tableId },
        item.name
      );
      if (resource.isErr()) return err(resource.error);
      checkedResources.push(resource.value);
    }

    const authorizedResources = checkedResources.filter(
      (resource) => resource.visibility === 'authorized'
    );
    const firstRedactedResource = checkedResources.find(
      (resource) => resource.visibility === 'redacted'
    );
    if (authorizedResources.length > 0) {
      const includedResources = authorizedResources.slice(0, detailLimit);
      authorizedResourcesTruncated ||= includedResources.length < authorizedResources.length;
      effects.push({
        code,
        kind: 'dependency.change',
        relatedResources: includedResources,
        measures: { [`${unit}s`]: exact(authorizedResources.length, unit) },
      });
    }
    if (firstRedactedResource) {
      resourcesRedacted = true;
      effects.push({
        code,
        kind: 'dependency.change',
        relatedResources: [firstRedactedResource],
        measures: {
          [`${unit}s`]: {
            basis: 'unknown',
            unit,
            reason: 'one-or-more-resources-redacted',
          },
        },
      });
    }
    return ok(undefined);
  };

  const symmetricResult = await addRelatedEffect(
    'field.delete.symmetric_link_removed',
    preparation.symmetricTargets.map((target) => ({
      id: target.fieldId,
      name: target.fieldName,
      tableId: target.tableId,
    })),
    'field',
    'field'
  );
  if (symmetricResult.isErr()) return err(symmetricResult.error);
  const dependentResult = await addRelatedEffect(
    'field.delete.dependent_field_changed',
    preparation.dependentFields.map((effect) => ({
      id: effect.fieldId,
      name: effect.fieldName,
      tableId: effect.tableId,
    })),
    'field',
    'field'
  );
  if (dependentResult.isErr()) return err(dependentResult.error);
  const viewResult = await addRelatedEffect(
    'field.delete.view_changed',
    preparation.views.map((effect) => ({
      id: effect.viewId,
      name: effect.viewName,
      tableId: effect.tableId,
    })),
    'view',
    'view'
  );
  if (viewResult.isErr()) return err(viewResult.error);
  return ok({ effects, authorizedResourcesTruncated, resourcesRedacted });
};

const blockerPlan = (error: DomainError): OperationPreviewPlan => ({
  effects: [],
  blockers: [{ code: error.code, message: error.message }],
  warnings: [],
  coverage: {
    known: ['field-operation domain invariants'],
    unknown: ['field-operation execution plugins', 'host authorization and external hooks'],
  },
  complexity: null,
  authorization: 'not-applicable',
  consistency: 'best-effort',
});

export class FieldDeletePreviewPlanner implements IPreviewPlanner<DeleteFieldCommand> {
  readonly operation = 'field.delete' as const;
  readonly plannerVersion = 'field-delete-v1';
  readonly executionPath = 'DeleteFieldHandler/FieldDeletionPreparationService';

  constructor(
    private readonly preparationService: FieldDeletionPreparationService,
    private readonly authorization?: IFieldDeletePreviewAuthorization
  ) {}

  async preview(
    context: IExecutionContext,
    command: DeleteFieldCommand,
    options: PreviewOptions
  ): Promise<Result<OperationPreviewPlan, DomainError>> {
    const preparation = await this.preparationService.prepare(context, {
      baseId: command.baseId,
      tableId: command.tableId,
      fieldIds: [command.fieldId],
    });
    if (preparation.isErr()) {
      if (
        preparation.error.tags.some(
          (tag) =>
            tag === 'validation' || tag === 'conflict' || tag === 'invariant' || tag === 'forbidden'
        )
      ) {
        return ok(blockerPlan(preparation.error));
      }
      return err(preparation.error);
    }
    const effects = await effectsFrom(context, this.authorization, preparation.value, options);
    if (effects.isErr()) return err(effects.error);

    const warnings: PreviewIssue[] =
      preparation.value.missingMetadata.length === 0
        ? []
        : [
            {
              code: 'field.delete.foreign_metadata_missing',
              message:
                'Referenced foreign table metadata was unavailable; cross-table deletion impact is unknown',
              resource: {
                visibility: 'redacted',
                kind: 'table',
                quantity: {
                  basis: 'unknown',
                  unit: 'table',
                  reason: 'foreign-table-not-loaded',
                },
                reason: 'foreign-table-not-loaded',
              },
            },
          ];
    const known = [
      'direct field removal',
      'surviving dependent field changes',
      'view metadata and query changes',
      'loaded symmetric link removals',
      'field-operation domain invariants',
    ];
    const unknown = ['field-operation execution plugins', 'host external hooks'];
    if (!this.authorization) unknown.push('resource authorization and identity visibility');
    if (effects.value.resourcesRedacted) {
      unknown.push('redacted resource identities and cardinalities');
    }
    if (preparation.value.missingMetadata.length > 0) {
      unknown.push('cross-table effects for missing foreign table metadata');
    }

    if (effects.value.authorizedResourcesTruncated) {
      warnings.push({
        code: 'preview.items_truncated',
        message:
          'Authorized effect resource details were truncated; authorized aggregate measures remain exact.',
      });
    }

    return ok({
      effects: effects.value.effects,
      blockers: [],
      warnings,
      coverage: { known, unknown },
      complexity: null,
      complexityProjection: {
        tableId: command.tableId.toString(),
        operation: {
          kind: 'field-change',
          tableId: command.tableId.toString(),
          changedFieldIds: [command.fieldId.toString()],
          fieldChange: 'delete',
          dataPresence: 'unknown',
        },
        includeCatalogStats: true,
        coverage: {
          known: ['complexity-operation-descriptor'],
          unknown: ['complexity-planner-projection', 'complexity-selection'],
        },
        warnings: [
          {
            code: 'preview.complexity.planner_projection_unknown',
            message:
              'The write planner projection is unavailable; complexity uses schema-potential propagation only.',
          },
          {
            code: 'preview.complexity.selection_unknown',
            message: 'The field deletion rewrite row count is unavailable.',
          },
        ],
      },
      authorization: this.authorization ? 'checked' : 'not-applicable',
      consistency: 'best-effort',
    });
  }
}

export const createFieldDeletePreviewRegistration = (
  planner: FieldDeletePreviewPlanner
): PreviewOperationRegistration<DeleteFieldCommand> => ({
  operation: 'field.delete',
  parseInput: DeleteFieldCommand.create,
  planner,
  capability: {
    canonicalWriteRoute: 'DELETE /tables/deleteField',
    supportLevel: 'partial',
    requiredPermissionScope: 'field.delete',
    detailLevels: ['summary', 'full'],
    limitations: [
      'A preview authorization adapter is required to return resource identities.',
      'Execution-only field operation plugins and host hooks are reported as unknown.',
    ],
  },
});
