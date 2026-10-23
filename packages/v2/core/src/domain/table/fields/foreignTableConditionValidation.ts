import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import type { Table } from '../Table';
import type { ForeignTableValidationContext } from './ForeignTableRelatedField';
import { FieldCondition, isRecordIdFieldId } from './types/FieldCondition';

type RawFilterItem = {
  fieldId: string;
  operator?: unknown;
  value?: unknown;
  isSymbol?: unknown;
};

const INVALID_OPERATOR_CODE = 'field.condition.invalid_operator_for_field';
const MAX_FILTER_DEPTH = 16;

const collectFilterItems = (node: unknown, items: RawFilterItem[], depth = 0): RawFilterItem[] => {
  if (!node || typeof node !== 'object' || depth > MAX_FILTER_DEPTH) return items;
  if ('filterSet' in node && Array.isArray(node.filterSet)) {
    for (const entry of node.filterSet) collectFilterItems(entry, items, depth + 1);
    return items;
  }
  if ('fieldId' in node) {
    const fieldId = node.fieldId;
    if (typeof fieldId === 'string') {
      items.push({ ...node, fieldId });
    }
  }
  return items;
};

const referencedFieldId = (item: RawFilterItem): string | null => {
  if (item.isSymbol === true && typeof item.value === 'string') return item.value;

  const value = item.value;
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'type' in value &&
    value.type === 'field' &&
    'fieldId' in value &&
    typeof value.fieldId === 'string'
  ) {
    return value.fieldId;
  }
  return null;
};

/**
 * Validates a conditional field's filter against the tables that will evaluate
 * it. Rejected here: an operator the target field's value shape cannot
 * evaluate, and a value the condition schema refuses or leaves incomplete
 * (either would later drop the predicate or dead-letter the backfill). Shapes a
 * legacy row can legitimately carry (a predicate on a field that is not on the
 * foreign table, a still-pending lookup) stay tolerated, matching the runtime's
 * skipped-predicate behavior. Checking per item keeps a brand-new invalid
 * operator detectable even when another predicate in the same filter is stale.
 */
export const validateForeignTableCondition = (
  condition: FieldCondition,
  context: ForeignTableValidationContext,
  foreignTable: Table
): Result<void, DomainError> => {
  const foreignFieldIds = new Set(foreignTable.getFields().map((field) => field.id().toString()));
  const hostFieldIds = new Set(context.hostTable.getFields().map((field) => field.id().toString()));

  for (const item of collectFilterItems(condition.toDto().filter, [])) {
    if (!isRecordIdFieldId(item.fieldId) && !foreignFieldIds.has(item.fieldId)) continue;

    const referenced = referencedFieldId(item);
    if (
      referenced &&
      !isRecordIdFieldId(referenced) &&
      !foreignFieldIds.has(referenced) &&
      !hostFieldIds.has(referenced)
    ) {
      continue;
    }

    const itemConditionResult = FieldCondition.create({
      filter: { conjunction: 'and', filterSet: [item] },
    });
    if (itemConditionResult.isErr()) continue;

    const specResult = itemConditionResult.value.toRecordConditionSpec(
      foreignTable,
      context.hostTable
    );
    if (specResult.isErr()) {
      const error = specResult.error;
      if (error.code === INVALID_OPERATOR_CODE) return err(error);
      if (error.tags.includes('validation') && !error.code.startsWith('field.condition.')) {
        return err(error);
      }
      if (
        error.tags.includes('unexpected') &&
        /record condition (?:requires|expects)/i.test(error.message)
      ) {
        return err(
          domainError.validation({
            code: 'field.condition.invalid_value',
            message: error.message,
          })
        );
      }
      continue;
    }
  }

  return ok(undefined);
};
