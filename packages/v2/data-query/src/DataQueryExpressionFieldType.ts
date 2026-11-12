import {
  ConditionalLookupField,
  FieldValueTypeVisitor,
  LookupField,
  type DomainError,
  type Field,
} from '@teable/v2-core';
import { err, ok, safeTry, type Result } from 'neverthrow';
import type { BoundDataQueryExpressionType } from './BoundDataQueryExpression';
import { queryError } from './DataQueryDefinition';

/** Inspect live scalar capability and every lookup inner representation, not display names. */
export const dataQueryExpressionFieldType = (
  field: Field
): Result<BoundDataQueryExpressionType, DomainError> =>
  safeTry(function* () {
    const valueType = yield* field
      .accept(new FieldValueTypeVisitor())
      .mapErr(() => queryError('unsupported_type', 'Cannot resolve expression field value type'));
    let inner = field;
    const visited = new Set<Field>();
    for (;;) {
      if (visited.has(inner))
        return err(queryError('field_semantics', 'An expression field has cyclic inner semantics'));
      visited.add(inner);
      if (inner.hasError().toBoolean())
        return err(queryError('field_error', 'An expression field has an unresolved schema error'));
      if (inner instanceof LookupField || inner instanceof ConditionalLookupField) {
        inner = yield* inner
          .innerField()
          .mapErr(() =>
            queryError('field_semantics', 'An expression lookup has unresolved inner semantics')
          );
        continue;
      }
      // Authorization masks may return NULL even for physically required fields.
      // Keep this public contract scope-independent across authority changes.
      return ok({
        valueType: valueType.cellValueType,
        multiplicity: valueType.isMultipleCellValue,
        nullable: true,
        field,
      });
    }
  });
