import { domainError, type DomainError, type RecordQueryPluginScope } from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';

import type { BoundDataQueryPlanUsage } from './BoundDataQueryPlan';

/** The authorization view of a bound plan: the only field usage it may rely on. */
export type DataQueryAccessPlan = {
  readonly usage: ReadonlyArray<BoundDataQueryPlanUsage>;
};

/** A persisted output contract must fail closed, never silently drop a restricted field. */
export const assertDataQueryAccess = (
  plan: DataQueryAccessPlan,
  scope: RecordQueryPluginScope
): Result<void, DomainError> => {
  const maskedFields = new Set(scope.fieldMasks?.map((mask) => mask.fieldId));
  // A relation edge is usable only when the link value itself is not conditionally hidden.
  for (const usage of plan.usage) {
    if (usage.usages.includes('relation') && maskedFields.has(usage.fieldId)) {
      return err(
        domainError.forbidden({
          code: 'data_query.field_forbidden',
          message: 'A field required by the data query is not readable',
          details: { fieldId: usage.fieldId },
        })
      );
    }
  }
  if (scope.readableFieldIds == null) return ok(undefined);
  for (const usage of plan.usage) {
    if (scope.readableFieldIds.has(usage.fieldId)) continue;
    const exposesValue = usage.usages.some(
      (candidate) => candidate === 'projection' || candidate === 'group' || candidate === 'relation'
    );
    if (!exposesValue && maskedFields.has(usage.fieldId)) continue;
    return err(
      domainError.forbidden({
        code: 'data_query.field_forbidden',
        message: 'A field required by the data query is not readable',
        details: { fieldId: usage.fieldId },
      })
    );
  }
  return ok(undefined);
};

/** One source's slice of `plan.usage`; a relation source is authorized on its own scope. */
export const dataQueryAccessForSource = (
  plan: DataQueryAccessPlan,
  source: string
): DataQueryAccessPlan => ({
  usage: plan.usage.filter((usage) => usage.source === source),
});
