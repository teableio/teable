import { domainError, type DomainError, type RecordQueryPluginScope } from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';

import type { DataQueryFieldDependency } from './types';

type DataQueryDependencyOwner = {
  readonly dependencies: ReadonlyArray<DataQueryFieldDependency>;
};

/** A persisted output contract must fail closed, never silently drop a restricted field. */
export const assertDataQueryAccess = (
  binding: DataQueryDependencyOwner,
  scope: RecordQueryPluginScope
): Result<void, DomainError> => {
  const maskedFields = new Set(scope.fieldMasks?.map((mask) => mask.fieldId));
  // A relation edge is usable only when the link value itself is not conditionally hidden.
  for (const dependency of binding.dependencies) {
    if (dependency.usages.includes('relation') && maskedFields.has(dependency.fieldId)) {
      return err(
        domainError.forbidden({
          code: 'data_query.field_forbidden',
          message: 'A field required by the data query is not readable',
          details: { fieldId: dependency.fieldId },
        })
      );
    }
  }
  if (scope.readableFieldIds == null) return ok(undefined);
  for (const dependency of binding.dependencies) {
    if (scope.readableFieldIds.has(dependency.fieldId)) continue;
    const exposesValue = dependency.usages.some(
      (usage) => usage === 'projection' || usage === 'group' || usage === 'relation'
    );
    if (!exposesValue && maskedFields.has(dependency.fieldId)) continue;
    return err(
      domainError.forbidden({
        code: 'data_query.field_forbidden',
        message: 'A field required by the data query is not readable',
        details: { fieldId: dependency.fieldId },
      })
    );
  }
  return ok(undefined);
};
