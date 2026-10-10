import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { andSpec } from '../domain/shared/specification/AndSpec';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { notSpec } from '../domain/shared/specification/NotSpec';
import { orSpec } from '../domain/shared/specification/OrSpec';
import type { Field } from '../domain/table/fields/Field';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldType } from '../domain/table/fields/FieldType';
import { ConditionalLookupField } from '../domain/table/fields/types/ConditionalLookupField';
import { LookupField } from '../domain/table/fields/types/LookupField';
import type { ITableReadModel } from '../domain/table/ITableReadModel';
import {
  conditionNullMatch,
  conditionNullMatchForSpec,
  type ConditionNullMatch,
} from '../domain/table/records/specs/ConditionNullSemantics';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { RecordConditionOperator } from '../domain/table/records/specs/RecordConditionOperators';
import { RecordValueConditionSpec } from '../domain/table/records/specs/RecordConditionSpec';
import type { RecordConditionValue } from '../domain/table/records/specs/RecordConditionValues';
import {
  RecordConditionDateValue,
  RecordConditionFieldReferenceValue,
  RecordConditionLiteralListValue,
  RecordConditionLiteralValue,
} from '../domain/table/records/specs/RecordConditionValues';
import type { TableRecord } from '../domain/table/records/TableRecord';
import { TableId } from '../domain/table/TableId';
import type { RecordQueryFieldMask } from '../ports/RecordQueryPlugin';
import {
  isRecordFilterCondition,
  isRecordFilterDateValue,
  isRecordFilterFieldReferenceValue,
  isRecordFilterGroup,
  isRecordFilterNot,
  type RecordFilter,
  type RecordFilterNode,
  type RecordFilterValue,
} from './RecordFilterDto';

type FieldMaskMap = ReadonlyMap<
  string,
  ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
>;

const currentUserFilterValue = 'Me';

const resolveField = (table: ITableReadModel, rawFieldId: string) => {
  return FieldId.create(rawFieldId).andThen((fieldId) =>
    table
      .getField((candidate) => candidate.id().equals(fieldId))
      .mapErr(() => domainError.notFound({ message: 'Filter field not found' }))
  );
};

const buildConditionValue = (
  table: ITableReadModel,
  rawValue: RecordFilterValue
): Result<RecordConditionValue | undefined, DomainError> => {
  if (rawValue === null) return ok(undefined);

  if (isRecordFilterFieldReferenceValue(rawValue)) {
    return FieldId.create(rawValue.fieldId).andThen((fieldId) => {
      return table
        .getField((candidate) => candidate.id().equals(fieldId))
        .mapErr(() => domainError.notFound({ message: 'Filter field reference not found' }))
        .andThen((field) => {
          if (rawValue.tableId) {
            const tableIdResult = TableId.create(rawValue.tableId);
            if (tableIdResult.isErr()) return err(tableIdResult.error);
            if (!tableIdResult.value.equals(table.id()))
              return err(domainError.unexpected({ message: 'Filter field table mismatch' }));
          }

          return RecordConditionFieldReferenceValue.create(field);
        });
    });
  }

  if (isRecordFilterDateValue(rawValue)) {
    return RecordConditionDateValue.create(rawValue);
  }

  if (Array.isArray(rawValue)) {
    return RecordConditionLiteralListValue.create(rawValue);
  }

  return RecordConditionLiteralValue.create(rawValue);
};

/**
 * Three-valued CASE WHEN null-when-hidden semantics, encoded as a dual polarity
 * pair for 2-valued WHERE matching:
 * - isTrue  ⇔ formula is definitely true  (WHERE includes row)
 * - isFalse ⇔ formula is definitely false (WHERE includes NOT formula)
 *
 * Algebra (Kleene):
 *   NOT p:     isTrue = p.isFalse, isFalse = p.isTrue
 *   p AND q:   isTrue = p.isTrue ∧ q.isTrue, isFalse = p.isFalse ∨ q.isFalse
 *   p OR q:    isTrue = p.isTrue ∨ q.isTrue, isFalse = p.isFalse ∧ q.isFalse
 *
 * Leaf NULL match (when mask M is false) comes from {@link conditionNullMatch}
 * on the **canonical** operator/value after FieldConditionSpecBuilder:
 * - true:    isTrue = ¬M ∨ c,  isFalse = M ∧ ¬c
 * - false:   isTrue = M ∧ c,   isFalse = ¬M ∨ ¬c
 * - unknown: isTrue = M ∧ c,   isFalse = M ∧ ¬c
 */
type FilterPolarity = {
  readonly isTrue: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>;
  readonly isFalse: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>;
};

const buildLeafPolarity = (
  nullMatch: Exclude<ConditionNullMatch, 'dynamic'>,
  conditionSpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
  mask: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined
): Result<FilterPolarity, DomainError> => {
  return notSpec(conditionSpec).andThen((notCondition) => {
    if (!mask) {
      return ok({ isTrue: conditionSpec, isFalse: notCondition });
    }

    if (nullMatch === 'true') {
      return notSpec(mask).andThen((notMask) =>
        orSpec(notMask, conditionSpec).andThen((isTrue) =>
          andSpec(mask, notCondition).map((isFalse) => ({ isTrue, isFalse }))
        )
      );
    }
    if (nullMatch === 'false') {
      return andSpec(mask, conditionSpec).andThen((isTrue) =>
        notSpec(mask).andThen((notMask) =>
          orSpec(notMask, notCondition).map((isFalse) => ({ isTrue, isFalse }))
        )
      );
    }
    // unknown: hidden ⇒ both false.
    return andSpec(mask, conditionSpec).andThen((isTrue) =>
      andSpec(mask, notCondition).map((isFalse) => ({ isTrue, isFalse }))
    );
  });
};

/**
 * Prefer the built condition **spec type** (CheckboxConditionSpec,
 * ConditionalLookupConditionSpec, …) so Lookup&lt;Checkbox&gt; and special
 * visitor dispatch stay aligned with SQL.
 */
const resolveCanonicalNullMatch = (
  field: Parameters<typeof conditionNullMatch>[0],
  conditionSpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
  rawOperator: string
): ConditionNullMatch => {
  if (conditionSpec instanceof RecordValueConditionSpec) {
    return conditionNullMatchForSpec(
      conditionSpec as RecordValueConditionSpec<RecordConditionOperator>
    );
  }
  return conditionNullMatch(field, rawOperator as RecordConditionOperator);
};

const andPolarities = (
  left: FilterPolarity,
  right: FilterPolarity
): Result<FilterPolarity, DomainError> =>
  andSpec(left.isTrue, right.isTrue).andThen((isTrue) =>
    orSpec(left.isFalse, right.isFalse).map((isFalse) => ({ isTrue, isFalse }))
  );

const orPolarities = (
  left: FilterPolarity,
  right: FilterPolarity
): Result<FilterPolarity, DomainError> =>
  orSpec(left.isTrue, right.isTrue).andThen((isTrue) =>
    andSpec(left.isFalse, right.isFalse).map((isFalse) => ({ isTrue, isFalse }))
  );

const buildPolarityFromNode = (
  table: ITableReadModel,
  node: RecordFilterNode,
  fieldMasks?: FieldMaskMap
): Result<FilterPolarity, DomainError> => {
  if (isRecordFilterCondition(node)) {
    // RHS field-reference to a masked field would read raw values (relation oracle).
    if (
      fieldMasks &&
      isRecordFilterFieldReferenceValue(node.value) &&
      fieldMasks.has(node.value.fieldId)
    ) {
      return err(
        domainError.validation({
          message: 'Filter field reference to a conditionally masked field is not allowed',
        })
      );
    }
    // LHS masked + field-reference RHS: NULL truth is row-dependent
    // (NULL IS DISTINCT FROM NULL = false, [] isNotExactly [] = false). Fail closed.
    if (fieldMasks?.has(node.fieldId) && isRecordFilterFieldReferenceValue(node.value)) {
      return err(
        domainError.validation({
          code: 'record.filter.masked_field_reference_lhs',
          message:
            'Filter comparing a conditionally masked field to another field is not allowed until mask-aware SQL CASE WHEN is available',
        })
      );
    }
    return resolveField(table, node.fieldId).andThen((field) =>
      buildConditionValue(table, node.value).andThen((value) =>
        field
          .spec()
          .create({ operator: node.operator, value })
          .andThen((conditionSpec) => {
            const mask = fieldMasks?.get(node.fieldId);
            if (!mask) {
              // No mask: polarity does not rewrite for NULL-when-hidden.
              return buildLeafPolarity('unknown', conditionSpec, undefined);
            }
            const nullMatch = resolveCanonicalNullMatch(field, conditionSpec, node.operator);
            if (nullMatch === 'dynamic') {
              return err(
                domainError.validation({
                  code: 'record.filter.masked_dynamic_null',
                  message:
                    'Filter on a conditionally masked field has row-dependent NULL semantics and is not allowed',
                })
              );
            }
            return buildLeafPolarity(nullMatch, conditionSpec, mask);
          })
      )
    );
  }

  if (isRecordFilterNot(node)) {
    return buildPolarityFromNode(table, node.not, fieldMasks).map(({ isTrue, isFalse }) => ({
      isTrue: isFalse,
      isFalse: isTrue,
    }));
  }

  if (isRecordFilterGroup(node)) {
    if (!node.items.length) {
      return err(domainError.validation({ message: 'Filter group is empty' }));
    }
    let combined: FilterPolarity | undefined;
    for (const item of node.items) {
      const childResult = buildPolarityFromNode(table, item, fieldMasks);
      if (childResult.isErr()) return err(childResult.error);
      if (!combined) {
        combined = childResult.value;
        continue;
      }
      const next =
        node.conjunction === 'and'
          ? andPolarities(combined, childResult.value)
          : orPolarities(combined, childResult.value);
      if (next.isErr()) return err(next.error);
      combined = next.value;
    }
    return ok(combined!);
  }

  return err(domainError.validation({ message: 'Invalid record filter node' }));
};

const buildSpecFromNode = (
  table: ITableReadModel,
  node: RecordFilterNode,
  fieldMasks?: FieldMaskMap
): Result<ISpecification<TableRecord, ITableRecordConditionSpecVisitor>, DomainError> =>
  buildPolarityFromNode(table, node, fieldMasks).map((polarity) => polarity.isTrue);

const sanitizeNode = (
  table: ITableReadModel,
  node: RecordFilterNode
): Result<RecordFilterNode | null, DomainError> => {
  if (isRecordFilterCondition(node)) {
    const fieldResult = resolveField(table, node.fieldId);
    if (fieldResult.isErr()) return ok(null);

    const valueResult = buildConditionValue(table, node.value);
    if (valueResult.isErr()) return ok(null);

    const specResult = fieldResult.value.spec().create({
      operator: node.operator,
      value: valueResult.value,
    });
    if (specResult.isErr()) return ok(null);

    return ok(node);
  }

  if (isRecordFilterNot(node)) {
    return sanitizeNode(table, node.not).map((sanitized) =>
      sanitized ? { not: sanitized } : null
    );
  }

  if (isRecordFilterGroup(node)) {
    const items: RecordFilterNode[] = [];
    for (const item of node.items) {
      const sanitized = sanitizeNode(table, item);
      if (sanitized.isErr()) return err(sanitized.error);
      if (sanitized.value) {
        items.push(sanitized.value);
      }
    }

    if (items.length === 0) {
      return ok(null);
    }

    return ok({
      conjunction: node.conjunction,
      items,
    });
  }

  return err(domainError.validation({ message: 'Invalid record filter node' }));
};

function isUserLikeField(field: Field): boolean {
  if (field instanceof LookupField || field instanceof ConditionalLookupField) {
    const innerField = field.innerField();
    return innerField.isOk() && isUserLikeField(innerField.value);
  }
  const type = field.type();
  return (
    type.equals(FieldType.user()) ||
    type.equals(FieldType.createdBy()) ||
    type.equals(FieldType.lastModifiedBy())
  );
}

export function replaceCurrentUserTagInFilter(
  table: ITableReadModel,
  filter: RecordFilter | null | undefined,
  actorId: string
): RecordFilter | null | undefined {
  if (!filter) {
    return filter;
  }

  const replaceNode = (node: RecordFilterNode): RecordFilterNode => {
    if (isRecordFilterNot(node)) {
      return { not: replaceNode(node.not) };
    }

    if (isRecordFilterGroup(node)) {
      return {
        ...node,
        items: node.items.map((item) => replaceNode(item)),
      };
    }

    if (!isRecordFilterCondition(node)) {
      return node;
    }

    const fieldResult = table.getField((field) => field.id().toString() === node.fieldId);
    if (fieldResult.isErr() || !isUserLikeField(fieldResult.value)) {
      return node;
    }

    const replaceValue = (value: RecordFilterValue): RecordFilterValue => {
      if (Array.isArray(value)) {
        return value.map((item) => (item === currentUserFilterValue ? actorId : item));
      }
      return value === currentUserFilterValue ? actorId : value;
    };

    return {
      ...node,
      value: replaceValue(node.value),
    };
  };

  return replaceNode(filter);
}

export const buildRecordConditionSpec = (
  table: ITableReadModel,
  filter: RecordFilter,
  fieldMasks?: ReadonlyArray<RecordQueryFieldMask>
): Result<ISpecification<TableRecord, ITableRecordConditionSpecVisitor>, DomainError> => {
  if (!filter) return err(domainError.validation({ message: 'Filter is empty' }));
  const maskMap: FieldMaskMap | undefined = fieldMasks?.length
    ? new Map(fieldMasks.map((mask) => [mask.fieldId, mask.visibleWhen]))
    : undefined;
  return buildSpecFromNode(table, filter, maskMap);
};

export const sanitizeRecordFilter = (
  table: ITableReadModel,
  filter: RecordFilter | null | undefined
): Result<RecordFilter | null | undefined, DomainError> => {
  if (filter === undefined || filter === null) {
    return ok(filter);
  }

  return sanitizeNode(table, filter).map((sanitized) => sanitized ?? null);
};

export const buildSanitizedRecordConditionSpec = (
  table: ITableReadModel,
  filter: RecordFilter | null | undefined
): Result<
  ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined,
  DomainError
> => {
  return sanitizeRecordFilter(table, filter).andThen((sanitized) =>
    sanitized ? buildRecordConditionSpec(table, sanitized) : ok(undefined)
  );
};
