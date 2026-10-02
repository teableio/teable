import { TableRecord } from '../domain/table/records/TableRecord';
import type { Table } from '../domain/table/Table';
import type { RecordQueryFieldMask } from '../ports/RecordQueryPlugin';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';

/**
 * Collect field ids referenced by a condition specification tree
 * (left/right field of conditions + field-reference values).
 * Used so mask evaluation can load dependency columns that are not returned.
 */
const collectFieldIdsFromSpec = (spec: unknown): ReadonlySet<string> => {
  const ids = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') {
      return;
    }
    const candidate = node as {
      leftSpec?: () => unknown;
      rightSpec?: () => unknown;
      innerSpec?: () => unknown;
      field?: () => { id: () => { toString: () => string } };
      value?: () => unknown;
    };
    if (typeof candidate.leftSpec === 'function' && typeof candidate.rightSpec === 'function') {
      walk(candidate.leftSpec());
      walk(candidate.rightSpec());
      return;
    }
    if (typeof candidate.innerSpec === 'function') {
      walk(candidate.innerSpec());
      return;
    }
    if (typeof candidate.field === 'function') {
      try {
        ids.add(candidate.field().id().toString());
      } catch {
        // ignore non-field specs
      }
    }
    if (typeof candidate.value === 'function') {
      const value = candidate.value();
      if (
        value &&
        typeof value === 'object' &&
        typeof (value as { field?: unknown }).field === 'function'
      ) {
        try {
          ids.add(
            (value as { field: () => { id: () => { toString: () => string } } })
              .field()
              .id()
              .toString()
          );
        } catch {
          // ignore
        }
      }
    }
  };
  walk(spec);
  return ids;
};

export const collectMaskDependencyFieldIds = (
  fieldMasks: ReadonlyArray<RecordQueryFieldMask> | undefined
): ReadonlySet<string> => {
  const ids = new Set<string>();
  for (const mask of fieldMasks ?? []) {
    for (const fieldId of collectFieldIdsFromSpec(mask.visibleWhen)) {
      ids.add(fieldId);
    }
  }
  return ids;
};

/**
 * Apply conditional field masks (visibleWhen) after read.
 * Fields that fail the mask are omitted from the result payload (null-out).
 *
 * Fail-closed: if a mask dependency field was not loaded into the evaluation
 * projection, the masked field is stripped (never fail-open on missing deps).
 */
export const applyFieldMasksToRecords = (
  table: Table,
  records: ReadonlyArray<TableRecordReadModel>,
  fieldMasks: ReadonlyArray<RecordQueryFieldMask> | undefined,
  evaluationFieldIds?: ReadonlySet<string>
): ReadonlyArray<TableRecordReadModel> => {
  if (!fieldMasks?.length || !records.length) {
    return records;
  }

  const maskDepsByFieldId = new Map(
    fieldMasks.map((mask) => [mask.fieldId, collectFieldIdsFromSpec(mask.visibleWhen)] as const)
  );

  return records.map((record) => {
    const domainRecordResult = TableRecord.fromRawFieldValues({
      id: record.id,
      tableId: table.id(),
      fields: record.fields,
    });
    // Fail-closed: if we cannot evaluate masks, strip all masked fields.
    if (domainRecordResult.isErr()) {
      const nextFields = { ...record.fields };
      for (const mask of fieldMasks) {
        delete nextFields[mask.fieldId];
      }
      return { ...record, fields: nextFields };
    }
    const domainRecord = domainRecordResult.value;
    let changed = false;
    const nextFields = { ...record.fields };
    for (const mask of fieldMasks) {
      if (!Object.hasOwn(nextFields, mask.fieldId)) {
        continue;
      }
      const deps = maskDepsByFieldId.get(mask.fieldId);
      // Fail-closed when a dependency was never loaded into the evaluation
      // projection. (isEmpty/isNot on undefined fail-open — do not evaluate.)
      // Null values that were projected still evaluate normally.
      const missingFromProjection =
        evaluationFieldIds != null &&
        deps != null &&
        [...deps].some((depId) => !evaluationFieldIds.has(depId));
      if (missingFromProjection) {
        delete nextFields[mask.fieldId];
        changed = true;
        continue;
      }
      if (!mask.visibleWhen.isSatisfiedBy(domainRecord)) {
        delete nextFields[mask.fieldId];
        changed = true;
      }
    }
    return changed ? { ...record, fields: nextFields } : record;
  });
};
