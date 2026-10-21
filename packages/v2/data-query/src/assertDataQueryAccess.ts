import { domainError, type DomainError, type RecordQueryPluginScope } from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';

import type { DataQueryBinding } from './DataQueryBinding';

/** A persisted output contract must fail closed, never silently drop a restricted field. */
export const assertDataQueryAccess = (
  binding: DataQueryBinding,
  scope: RecordQueryPluginScope
): Result<void, DomainError> => {
  if (scope.readableFieldIds == null) return ok(undefined);
  const maskedFields = new Set(scope.fieldMasks?.map((mask) => mask.fieldId));
  for (const dependency of binding.dependencies) {
    if (scope.readableFieldIds.has(dependency.fieldId)) continue;
    const exposesValue = dependency.usages.some(
      (usage) => usage === 'projection' || usage === 'group'
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
