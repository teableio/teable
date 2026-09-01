import { FieldType, type DomainError, type Field, type LookupField } from '@teable/v2-core';
import { formatFieldValueAsStringSql } from '@teable/v2-formula-sql-pg';
import { sql, type RawBuilder } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

import { buildDateLikeOrderExpression } from '../dateLikeOrderBy';
import { applyV1NullsOrder } from '../systemOrderColumns';
import {
  buildUserGroupIdentityExpr,
  resolveUserGroupIdentityMultiplicity,
} from '../userSnapshotSql';

export type StoredFieldOrderByClause = {
  readonly expression: RawBuilder<unknown>;
  readonly direction: 'asc' | 'desc';
  /** Match v1 ASC NULLS FIRST / DESC NULLS LAST without a leading IS NULL key. */
  readonly matchV1Nulls?: boolean;
};

type OrderByCapable<T> = {
  orderBy: (
    expression: RawBuilder<unknown>,
    modifiers?: 'asc' | 'desc' | ReturnType<typeof applyV1NullsOrder>
  ) => T;
};

export const applyStoredFieldOrderByClause = <T>(
  query: OrderByCapable<T>,
  clause: StoredFieldOrderByClause
): T =>
  clause.matchV1Nulls
    ? query.orderBy(clause.expression, applyV1NullsOrder(clause.direction))
    : query.orderBy(clause.expression, clause.direction);

const extractSelectChoiceOrder = (
  field: Field
): { mode: 'single' | 'multiple'; values: string[] } | undefined => {
  const candidate = field as Field & {
    selectOptions?: () => ReadonlyArray<{ name: () => { toString: () => string } }>;
    innerField?: () => { isOk: () => boolean; value: unknown };
  };
  const fieldType = field.type();
  const toChoiceNames = (
    options: ReadonlyArray<{ name: () => { toString: () => string } }> | undefined
  ): string[] | undefined => {
    const names = options?.map((option) => option.name().toString()).filter(Boolean);
    return names?.length ? names : undefined;
  };

  if (fieldType.equals(FieldType.singleSelect()) || fieldType.equals(FieldType.multipleSelect())) {
    const values = toChoiceNames(candidate.selectOptions?.());
    return values
      ? {
          mode: fieldType.equals(FieldType.multipleSelect()) ? 'multiple' : 'single',
          values,
        }
      : undefined;
  }

  if (!fieldType.equals(FieldType.lookup())) return undefined;
  const innerFieldResult = candidate.innerField?.();
  if (!innerFieldResult?.isOk()) return undefined;

  const innerField = innerFieldResult.value as {
    type?: () => { equals: (other: unknown) => boolean };
    selectOptions?: () => ReadonlyArray<{ name: () => { toString: () => string } }>;
  };
  const innerType = innerField.type?.();
  if (
    !innerType ||
    (!innerType.equals(FieldType.singleSelect()) && !innerType.equals(FieldType.multipleSelect()))
  ) {
    return undefined;
  }
  const values = toChoiceNames(innerField.selectOptions?.());
  if (!values) return undefined;

  const multiplicityResult = field.isMultipleCellValue();
  const isMultiple =
    multiplicityResult.isOk() &&
    (innerType.equals(FieldType.multipleSelect()) || multiplicityResult.value.isMultiple());
  return { mode: isMultiple ? 'multiple' : 'single', values };
};

const withNullOrdering = (
  expression: RawBuilder<unknown>,
  direction: 'asc' | 'desc'
): StoredFieldOrderByClause[] => [{ expression, direction, matchV1Nulls: true }];

const buildMultipleLookupOrderExpression = (
  field: Field,
  columnRef: RawBuilder<unknown>
): Result<RawBuilder<unknown> | undefined, DomainError> => {
  if (!field.type().equals(FieldType.lookup())) return ok(undefined);

  const lookupField = field as LookupField;
  return lookupField.isMultipleCellValue().andThen((multiplicity) => {
    if (!multiplicity.isMultiple()) return ok(undefined);

    return lookupField.innerField().map((innerField) => {
      const innerType = innerField.type();
      const normalizedArray = sql`CASE
        WHEN ${columnRef} IS NULL THEN '[]'::jsonb
        WHEN jsonb_typeof(${columnRef}::jsonb) = 'array' THEN ${columnRef}::jsonb
        WHEN jsonb_typeof(${columnRef}::jsonb) = 'null' THEN '[]'::jsonb
        ELSE jsonb_build_array(${columnRef}::jsonb)
      END`;

      // v1 compares plain text and checkbox lookups by their first value.
      if (
        innerType.equals(FieldType.singleLineText()) ||
        innerType.equals(FieldType.longText()) ||
        innerType.equals(FieldType.checkbox())
      ) {
        return sql`${normalizedArray} ->> 0`;
      }

      // v1 compares number and date lookups by the complete display string.
      if (innerType.equals(FieldType.number()) || innerType.equals(FieldType.date())) {
        const elementSql = `lookup_element #>> '{}'`;
        const formattedElementSql = formatFieldValueAsStringSql(innerField, elementSql);
        const elementExpression = formattedElementSql
          ? sql.raw(formattedElementSql)
          : sql.raw(elementSql);
        return sql`(
          SELECT string_agg(${elementExpression}, ', ' ORDER BY lookup_ordinality)
          FROM jsonb_array_elements(${normalizedArray})
            WITH ORDINALITY AS lookup_values(lookup_element, lookup_ordinality)
        )`;
      }

      return undefined;
    });
  });
};

export const buildStoredFieldOrderByClauses = (
  field: Field,
  column: string,
  direction: 'asc' | 'desc',
  tableAlias: string,
  options?: {
    /** Grouped value expression to order by instead of the raw column. */
    readonly columnExpression?: RawBuilder<unknown>;
    /** Collate a user field like its group buckets ({id, title} identity). */
    readonly groupIdentityCollation?: boolean;
  }
): Result<ReadonlyArray<StoredFieldOrderByClause>, DomainError> => {
  const columnExpression = options?.columnExpression;
  const fieldType = field.type();
  const columnRef = columnExpression ?? sql.ref(`${tableAlias}.${column}`);
  const selectChoiceOrder = extractSelectChoiceOrder(field);

  if (selectChoiceOrder) {
    const choiceArrayLiteral = sql`ARRAY[${sql.join(
      selectChoiceOrder.values.map((name) => sql`${name}`),
      sql`, `
    )}]`;
    const choiceIndexExpression =
      selectChoiceOrder.mode === 'multiple'
        ? sql`CASE
            WHEN ${columnRef} IS NULL THEN NULL
            WHEN jsonb_typeof(${columnRef}::jsonb) = 'array'
              THEN ARRAY_POSITION(${choiceArrayLiteral}, jsonb_path_query_first(${columnRef}::jsonb, '$[0]') #>> '{}')
            ELSE ARRAY_POSITION(${choiceArrayLiteral}, ${columnRef}::text)
          END`
        : sql`ARRAY_POSITION(${choiceArrayLiteral}, ${columnRef}::text)`;
    const clauses = withNullOrdering(choiceIndexExpression, direction);
    return ok(
      selectChoiceOrder.mode === 'multiple'
        ? [...clauses, { expression: sql`${columnRef}::jsonb::text`, direction }]
        : clauses
    );
  }

  const multipleLookupOrderExpression = buildMultipleLookupOrderExpression(field, columnRef);
  if (multipleLookupOrderExpression.isErr()) return err(multipleLookupOrderExpression.error);
  if (multipleLookupOrderExpression.value) {
    return ok(withNullOrdering(multipleLookupOrderExpression.value, direction));
  }

  const userIdentityMultiplicity = resolveUserGroupIdentityMultiplicity(field);
  if (userIdentityMultiplicity.isErr()) return err(userIdentityMultiplicity.error);
  if (
    userIdentityMultiplicity.value != null &&
    (columnExpression || options?.groupIdentityCollation)
  ) {
    const isMultiple = userIdentityMultiplicity.value;
    const columnJson = sql`${columnRef}::jsonb`;
    const identityJson = columnExpression
      ? columnJson
      : buildUserGroupIdentityExpr(columnRef, isMultiple);
    if (isMultiple) {
      return ok([
        {
          expression: sql`COALESCE(jsonb_path_query_array(${identityJson}, '$[*].title')::text, '[]')`,
          direction,
        },
        { expression: identityJson, direction },
      ]);
    }
    return ok([
      ...withNullOrdering(sql`${identityJson} ->> 'title'`, direction),
      { expression: identityJson, direction },
    ]);
  }

  const isUserLike =
    fieldType.equals(FieldType.user()) ||
    fieldType.equals(FieldType.link()) ||
    fieldType.equals(FieldType.createdBy()) ||
    fieldType.equals(FieldType.lastModifiedBy());
  if (isUserLike) {
    const multiplicityResult = field.isMultipleCellValue();
    if (multiplicityResult.isErr()) return err(multiplicityResult.error);

    const source =
      fieldType.equals(FieldType.createdBy()) || fieldType.equals(FieldType.lastModifiedBy())
        ? 'system'
        : 'field';
    const columnJson = source === 'field' ? sql`${columnRef}::jsonb` : sql`to_jsonb(${columnRef})`;
    // Plain sorts keep the V1 collation: title only, with later
    // view-row/auto-number tie-breakers instead of clustering by id.
    const arrayLikeColumnJson =
      source === 'field'
        ? sql`CASE
            WHEN jsonb_typeof(${columnJson}) = 'array' THEN ${columnJson}
            WHEN jsonb_typeof(${columnJson}) = 'object' THEN jsonb_build_array(${columnJson})
            ELSE '[]'::jsonb
          END`
        : sql`CASE
            WHEN jsonb_typeof(${columnJson}) = 'array' THEN ${columnJson}
            ELSE '[]'::jsonb
          END`;
    const titleExpression = multiplicityResult.value.isMultiple()
      ? sql`jsonb_path_query_array(${arrayLikeColumnJson}, '$[*].title')::text`
      : source === 'field'
        ? sql`${columnJson} ->> 'title'`
        : sql`coalesce(${columnJson} ->> 'title', ${columnJson} ->> 'name', ${columnJson} #>> '{}')`;
    return ok(withNullOrdering(titleExpression, direction));
  }

  // An explicit columnExpression (error fallback, grouped date bucket) is
  // already the value to order by; rebuilding from the raw column would
  // reference an ungrouped column in grouped queries.
  const dateExpression = columnExpression
    ? null
    : buildDateLikeOrderExpression(field, tableAlias, column);
  return ok(withNullOrdering(dateExpression ?? sql`${columnRef}`, direction));
};
