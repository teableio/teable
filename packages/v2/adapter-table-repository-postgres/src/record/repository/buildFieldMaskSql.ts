import type { DomainError, RecordQueryFieldMask } from '@teable/v2-core';
import { sql, type Expression, type SqlBool } from 'kysely';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';
import type { FieldMaskSqlMap } from '../query-builder/ITableRecordQueryBuilder';

import { buildRecordWhereClause } from './buildRecordWhereClause';

/**
 * Compile conditional field masks (visibleWhen specs) into standalone SQL
 * predicates so ORDER BY / GROUP BY / search can evaluate over the masked
 * value domain (T6997). The caller's table alias must match the query the
 * predicate is injected into.
 */
export const buildFieldMaskSqlMap = (
  fieldMasks: ReadonlyArray<RecordQueryFieldMask> | undefined,
  tableAlias: string
): Result<FieldMaskSqlMap | undefined, DomainError> => {
  if (!fieldMasks?.length) {
    return ok(undefined);
  }
  const map = new Map<string, Expression<SqlBool>>();
  for (const mask of fieldMasks) {
    // The plugin runner merges same-field masks with AND upstream; the guard
    // only protects against hand-built duplicate entries.
    if (map.has(mask.fieldId)) {
      continue;
    }
    const compiled = buildRecordWhereClause(mask.visibleWhen, { tableAlias });
    if (compiled.isErr()) {
      return err(compiled.error);
    }
    // An empty where means the visibility spec is tautological (always visible).
    map.set(mask.fieldId, compiled.value ?? sql`true`);
  }
  return ok(map);
};
