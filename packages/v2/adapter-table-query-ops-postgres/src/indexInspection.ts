import { type DomainError, type IExecutionContext, type Table } from '@teable/v2-core';
import {
  TableQueryIndexInspection,
  type TableQueryIndexKind,
  type TableQueryShape,
} from '@teable/v2-table-query-ops';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { err, type Result } from 'neverthrow';

import { getTablePhysicalName, toInfrastructureError } from './helpers';
import type { UnknownPostgresDatabase } from './types';

export class PostgresTableQueryIndexInspector {
  constructor(private readonly dataDb: Kysely<UnknownPostgresDatabase>) {}

  async inspect(
    _context: IExecutionContext,
    table: Table,
    shape: TableQueryShape
  ): Promise<Result<TableQueryIndexInspection, DomainError>> {
    const physical = getTablePhysicalName(table);
    if (physical.isErr()) return err(physical.error);
    try {
      const rows = await sql<{ indexname: string; indexdef: string }>`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = ${physical.value.schema}
          AND tablename = ${physical.value.tableName}
      `.execute(this.dataDb);
      const existingIndexes = rows.rows.map((row) => ({
        name: row.indexname,
        definition: row.indexdef,
      }));
      const expected = collectExpectedIndexCandidates(table, shape);
      const missingIndexCandidates = expected.filter(
        (candidate) => !hasMatchingIndex(existingIndexes, candidate)
      );
      const invalidRows = await sql<{ index_name: string; reason: string }>`
        SELECT c.relname AS index_name, 'invalid_index' AS reason
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_class t ON t.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = ${physical.value.schema}
          AND t.relname = ${physical.value.tableName}
          AND NOT i.indisvalid
      `.execute(this.dataDb);
      const abnormalIndexes = invalidRows.rows.map((row) => ({
        name: row.index_name,
        reason: row.reason,
      }));
      const state =
        abnormalIndexes.length > 0
          ? 'invalid'
          : missingIndexCandidates.length > 0
            ? 'missing'
            : 'ready';
      return TableQueryIndexInspection.create({
        state,
        usefulIndexes: expected
          .filter((candidate) => hasMatchingIndex(existingIndexes, candidate))
          .map((candidate) => ({
            fieldId: candidate.fieldId,
            fieldDbName: candidate.fieldDbName,
            fields: candidate.fields,
            kind: candidate.kind,
            accessPath: candidate.accessPath,
            valid: true,
            name: existingIndexes.find((index) => hasMatchingIndex([index], candidate))?.name,
          })),
        missingIndexCandidates,
        abnormalIndexes,
      });
    } catch (error) {
      return err(toInfrastructureError(error, 'Failed to inspect table query indexes'));
    }
  }
}

type ExpectedIndexCandidate = {
  readonly fieldId?: string;
  readonly fieldDbName?: string;
  readonly fields: ReadonlyArray<ExpectedIndexField>;
  readonly kind: TableQueryIndexKind;
  readonly accessPath: 'single_field' | 'composite' | 'expression';
  readonly reason: string;
};

type ExpectedIndexField = {
  readonly fieldId?: string;
  readonly fieldDbName?: string;
  readonly direction?: 'asc' | 'desc';
  readonly role?:
    | 'filter'
    | 'sort'
    | 'group'
    | 'search'
    | 'formula_result'
    | 'formula_source'
    | 'formula_expression';
  readonly sourceKind?: 'direct_field' | 'formula_result' | 'formula_source' | 'formula_expression';
  readonly formulaFieldId?: string;
  readonly formulaFunctionNames?: ReadonlyArray<string>;
  readonly formulaSkippedReasons?: ReadonlyArray<string>;
  readonly formulaPredicatePushdown?: {
    readonly supported: boolean;
    readonly operatorFamilies: ReadonlyArray<string>;
    readonly sourceFunctionNames: ReadonlyArray<string>;
    readonly skippedReasons: ReadonlyArray<string>;
  };
};

type FieldResolver = (
  fieldId: string | undefined,
  input?: {
    readonly direction?: 'asc' | 'desc';
    readonly role?: ExpectedIndexField['role'];
    readonly sourceKind?: ExpectedIndexField['sourceKind'];
    readonly formulaFieldId?: string;
    readonly formulaFunctionNames?: ReadonlyArray<string>;
    readonly formulaSkippedReasons?: ReadonlyArray<string>;
    readonly formulaPredicatePushdown?: ExpectedIndexField['formulaPredicatePushdown'];
  }
) => ExpectedIndexField | undefined;

const collectExpectedIndexCandidates = (
  table: Table,
  shape: TableQueryShape
): ReadonlyArray<ExpectedIndexCandidate> => {
  const candidates = new Map<string, ExpectedIndexCandidate>();
  const resolveField = createFieldResolver(table);
  const snapshot = shape.snapshot();
  const btreeFields = collectBtreeAccessPathFields(snapshot, resolveField);
  const compositeFields = selectCompositeBtreeFields(btreeFields);

  if (compositeFields.length > 1) {
    addExpectedIndexCandidate(
      candidates,
      compositeFields,
      'btree',
      'Table query shape can use one composite btree index for filter and sort/group access'
    );
  }

  addWhereIndexCandidates(candidates, snapshot, {
    resolveField,
    btreeFilterFields: btreeFields.btreeFilterFields,
    compositeFields,
  });
  addOrderIndexCandidates(candidates, btreeFields.orderFields, compositeFields);
  addSearchIndexCandidates(candidates, table, snapshot, resolveField);
  return [...candidates.values()].filter((candidate) => candidate.fieldDbName);
};

const createFieldResolver = (table: Table): FieldResolver => {
  const fieldsById = new Map(table.getFields().map((field) => [field.id().toString(), field]));
  return (fieldId, input) => {
    if (!fieldId) return;
    const field = fieldsById.get(fieldId);
    if (!field) return;
    const dbFieldName = field.dbFieldName();
    if (dbFieldName.isErr()) return;
    const dbFieldNameValue = dbFieldName.value.value();
    if (dbFieldNameValue.isErr()) return;
    return {
      fieldId,
      fieldDbName: dbFieldNameValue.value,
      direction: input?.direction,
      role: input?.role,
      sourceKind: input?.sourceKind,
      formulaFieldId: input?.formulaFieldId,
      formulaFunctionNames: input?.formulaFunctionNames,
      formulaSkippedReasons: input?.formulaSkippedReasons,
      formulaPredicatePushdown: input?.formulaPredicatePushdown,
    };
  };
};

const addExpectedIndexCandidate = (
  candidates: Map<string, ExpectedIndexCandidate>,
  fields: ReadonlyArray<ExpectedIndexField | undefined>,
  kind: TableQueryIndexKind,
  reason: string,
  accessPathOverride?: ExpectedIndexCandidate['accessPath']
): void => {
  const resolvedFields = fields.filter((field): field is ExpectedIndexField =>
    Boolean(field?.fieldDbName)
  );
  if (resolvedFields.length === 0) return;
  const firstField = resolvedFields[0];
  const accessPath =
    accessPathOverride ?? (resolvedFields.length > 1 ? 'composite' : 'single_field');
  const key = `${kind}:${accessPath}:${resolvedFields
    .map(
      (field) =>
        `${field.fieldDbName}:${field.direction ?? ''}:${field.role ?? ''}:${
          field.sourceKind ?? ''
        }`
    )
    .join('|')}`;
  candidates.set(key, {
    fieldId: firstField?.fieldId,
    fieldDbName: firstField?.fieldDbName,
    fields: resolvedFields,
    kind,
    accessPath,
    reason,
  });
};

const collectBtreeAccessPathFields = (
  snapshot: ReturnType<TableQueryShape['snapshot']>,
  resolveField: FieldResolver
) => {
  const btreeFilterFields =
    snapshot.whereShape?.fields
      .filter((field) =>
        ['equality', 'range', 'selection', 'empty', 'link'].includes(field.operatorFamily)
      )
      .map((field) =>
        resolveField(field.fieldId, {
          role: field.sourceKind === 'formula_source' ? 'formula_source' : 'filter',
          sourceKind: field.sourceKind,
          formulaFieldId: field.formula?.formulaFieldId,
          formulaFunctionNames: field.formula?.functionNames,
          formulaSkippedReasons: field.formula?.skippedReasons,
          formulaPredicatePushdown: field.formula?.predicatePushdown,
        })
      )
      .filter((field): field is ExpectedIndexField => Boolean(field?.fieldDbName)) ?? [];
  const equalityFilterFields =
    snapshot.whereShape?.fields
      .filter((field) => ['equality', 'selection', 'empty', 'link'].includes(field.operatorFamily))
      .map((field) =>
        resolveField(field.fieldId, {
          role: field.sourceKind === 'formula_source' ? 'formula_source' : 'filter',
          sourceKind: field.sourceKind,
          formulaFieldId: field.formula?.formulaFieldId,
          formulaFunctionNames: field.formula?.functionNames,
          formulaSkippedReasons: field.formula?.skippedReasons,
          formulaPredicatePushdown: field.formula?.predicatePushdown,
        })
      )
      .filter((field): field is ExpectedIndexField => Boolean(field?.fieldDbName)) ?? [];
  const rangeFilterFields =
    snapshot.whereShape?.fields
      .filter((field) => field.operatorFamily === 'range')
      .map((field) =>
        resolveField(field.fieldId, {
          role: field.sourceKind === 'formula_source' ? 'formula_source' : 'filter',
          sourceKind: field.sourceKind,
          formulaFieldId: field.formula?.formulaFieldId,
          formulaFunctionNames: field.formula?.functionNames,
          formulaSkippedReasons: field.formula?.skippedReasons,
          formulaPredicatePushdown: field.formula?.predicatePushdown,
        })
      )
      .filter((field): field is ExpectedIndexField => Boolean(field?.fieldDbName)) ?? [];
  const orderFields =
    snapshot.orderShape?.fields
      .filter((field) => field.fieldId && field.source !== 'tieBreaker')
      .map((field) =>
        resolveField(field.fieldId, {
          direction: field.direction,
          role: field.source === 'group' ? 'group' : 'sort',
        })
      )
      .filter((field): field is ExpectedIndexField => Boolean(field?.fieldDbName)) ?? [];
  return {
    btreeFilterFields,
    equalityFilterFields,
    rangeFilterFields,
    orderFields,
  };
};

const addWhereIndexCandidates = (
  candidates: Map<string, ExpectedIndexCandidate>,
  snapshot: ReturnType<TableQueryShape['snapshot']>,
  input: {
    readonly resolveField: FieldResolver;
    readonly btreeFilterFields: ReadonlyArray<ExpectedIndexField>;
    readonly compositeFields: ReadonlyArray<ExpectedIndexField>;
  }
): void => {
  for (const field of snapshot.whereShape?.fields ?? []) {
    addFormulaExpressionIndexCandidate(candidates, field, input.resolveField);
    if (field.operatorFamily === 'text_contains') {
      addExpectedIndexCandidate(
        candidates,
        [
          input.resolveField(field.fieldId, {
            role: field.sourceKind === 'formula_source' ? 'formula_source' : 'search',
            sourceKind: field.sourceKind,
            formulaFieldId: field.formula?.formulaFieldId,
            formulaFunctionNames: field.formula?.functionNames,
            formulaSkippedReasons: field.formula?.skippedReasons,
            formulaPredicatePushdown: field.formula?.predicatePushdown,
          }),
        ],
        'gin_trgm',
        field.sourceKind === 'formula_source'
          ? 'Formula source text lookup can use trigram index'
          : 'Text contains filter can use trigram index'
      );
    } else if (field.operatorFamily === 'text_prefix') {
      addExpectedIndexCandidate(
        candidates,
        [
          input.resolveField(field.fieldId, {
            role: field.sourceKind === 'formula_source' ? 'formula_source' : 'filter',
            sourceKind: field.sourceKind,
            formulaFieldId: field.formula?.formulaFieldId,
            formulaFunctionNames: field.formula?.functionNames,
            formulaSkippedReasons: field.formula?.skippedReasons,
            formulaPredicatePushdown: field.formula?.predicatePushdown,
          }),
        ],
        'btree',
        field.sourceKind === 'formula_source'
          ? 'Formula source prefix lookup can use btree index'
          : 'Text prefix filter can use btree index'
      );
    } else if (
      ['equality', 'range', 'selection', 'empty', 'link', 'formula_result'].includes(
        field.operatorFamily
      )
    ) {
      const resolved =
        input.btreeFilterFields.find((candidate) => candidate.fieldId === field.fieldId) ??
        input.resolveField(field.fieldId, {
          role:
            field.sourceKind === 'formula_result'
              ? 'formula_result'
              : field.sourceKind === 'formula_expression'
                ? 'formula_expression'
                : 'filter',
          sourceKind: field.sourceKind,
          formulaFieldId: field.formula?.formulaFieldId,
          formulaFunctionNames: field.formula?.functionNames,
          formulaSkippedReasons: field.formula?.skippedReasons,
          formulaPredicatePushdown: field.formula?.predicatePushdown,
        });
      if (!isCoveredByCompositeCandidate(resolved, input.compositeFields)) {
        addExpectedIndexCandidate(
          candidates,
          [resolved],
          'btree',
          field.sourceKind === 'formula_expression'
            ? 'Formula expression filter can use a validated expression index'
            : field.sourceKind === 'formula_result'
              ? 'Formula result filter can use btree index'
              : 'Filter predicate can use btree index',
          field.sourceKind === 'formula_expression' ? 'expression' : undefined
        );
      }
    }
  }
};

type SnapshotWhereField = NonNullable<
  ReturnType<TableQueryShape['snapshot']>['whereShape']
>['fields'][number];

const addFormulaExpressionIndexCandidate = (
  candidates: Map<string, ExpectedIndexCandidate>,
  field: SnapshotWhereField,
  resolveField: FieldResolver
): void => {
  const formula = field.formula;
  if (!formula?.stable || !formula.sqlTranslatable) return;
  if (!formula.expressionIndexable) return;
  if (!formula.candidateIndexes.includes('btree')) return;
  const resolved = resolveField(formula.formulaFieldId, {
    role: 'formula_expression',
    sourceKind: 'formula_expression',
    formulaFieldId: formula.formulaFieldId,
    formulaFunctionNames: formula.functionNames,
    formulaSkippedReasons: [
      ...formula.skippedReasons,
      ...(formula.expressionIndexSkippedReasons ?? []),
    ],
    formulaPredicatePushdown: formula.predicatePushdown,
  });
  addExpectedIndexCandidate(
    candidates,
    [resolved],
    'btree',
    'Formula field can use a validated expression index',
    'expression'
  );
};

const addOrderIndexCandidates = (
  candidates: Map<string, ExpectedIndexCandidate>,
  orderFields: ReadonlyArray<ExpectedIndexField>,
  compositeFields: ReadonlyArray<ExpectedIndexField>
): void => {
  for (const field of orderFields) {
    if (!isCoveredByCompositeCandidate(field, compositeFields)) {
      addExpectedIndexCandidate(
        candidates,
        [field],
        'btree',
        'Sort or group field can use btree index'
      );
    }
  }
};

const addSearchIndexCandidates = (
  candidates: Map<string, ExpectedIndexCandidate>,
  table: Table,
  snapshot: ReturnType<TableQueryShape['snapshot']>,
  resolveField: FieldResolver
): void => {
  if (snapshot.searchShape) {
    const searchFields = snapshot.searchShape.allFields
      ? table.getFields()
      : table
          .getFields()
          .filter((field) =>
            snapshot.whereShape?.fields.some(
              (whereField) => whereField.fieldId === field.id().toString()
            )
          );
    for (const field of searchFields) {
      addExpectedIndexCandidate(
        candidates,
        [resolveField(field.id().toString(), { role: 'search' })],
        'gin_trgm',
        'Search field can use trigram index'
      );
    }
  }
};

const selectCompositeBtreeFields = (input: {
  readonly equalityFilterFields: ReadonlyArray<ExpectedIndexField>;
  readonly rangeFilterFields: ReadonlyArray<ExpectedIndexField>;
  readonly orderFields: ReadonlyArray<ExpectedIndexField>;
}): ReadonlyArray<ExpectedIndexField> => {
  const fields = [
    ...input.equalityFilterFields,
    ...(input.orderFields.length > 0 ? input.orderFields : input.rangeFilterFields.slice(0, 1)),
  ];
  return dedupeFields(fields).slice(0, 3);
};

const dedupeFields = (
  fields: ReadonlyArray<ExpectedIndexField>
): ReadonlyArray<ExpectedIndexField> => {
  const seen = new Set<string>();
  return fields.filter((field) => {
    const key = field.fieldDbName ?? field.fieldId;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const isCoveredByCompositeCandidate = (
  field: ExpectedIndexField | undefined,
  compositeFields: ReadonlyArray<ExpectedIndexField>
): boolean => {
  if (!field?.fieldDbName || compositeFields.length <= 1) return false;
  return compositeFields.some((candidate) => candidate.fieldDbName === field.fieldDbName);
};

const hasMatchingIndex = (
  existingIndexes: ReadonlyArray<{ readonly name: string; readonly definition: string }>,
  candidate: ExpectedIndexCandidate
): boolean => {
  return existingIndexes.some((index) => {
    const definition = index.definition.toLowerCase();
    const fieldDbName = candidate.fieldDbName;
    if (candidate.kind === 'gin_trgm') {
      if (!fieldDbName) return false;
      return (
        containsColumnReference(definition, fieldDbName) &&
        definition.includes(' using gin ') &&
        definition.includes('gin_trgm_ops')
      );
    }
    if (definition.includes(' using gin ')) return false;
    const indexColumns = parseIndexColumns(definition);
    return candidate.fields.every((field, index) =>
      matchesIndexColumn(indexColumns[index], field.fieldDbName)
    );
  });
};

const parseIndexColumns = (lowercaseIndexDefinition: string): ReadonlyArray<string> => {
  const usingMatch = /\susing\s+\w+\s*\((.*)\)/i.exec(lowercaseIndexDefinition);
  const columnsSql = usingMatch?.[1];
  if (!columnsSql) return [];
  return columnsSql
    .split(',')
    .map((column) => column.trim())
    .filter(Boolean);
};

const matchesIndexColumn = (
  indexColumn: string | undefined,
  fieldDbName: string | undefined
): boolean => {
  if (!indexColumn || !fieldDbName) return false;
  const lowercaseField = fieldDbName.toLowerCase();
  const quotedColumn = `"${lowercaseField.replace(/"/g, '""')}"`;
  return indexColumn.startsWith(quotedColumn) || indexColumn.startsWith(lowercaseField);
};

const containsColumnReference = (
  lowercaseIndexDefinition: string,
  fieldDbName: string
): boolean => {
  const lowercaseField = fieldDbName.toLowerCase();
  const quotedColumn = `"${lowercaseField.replace(/"/g, '""')}"`;
  if (lowercaseIndexDefinition.includes(quotedColumn)) return true;
  return new RegExp(`(^|[\\s(,])${escapeRegExp(lowercaseField)}([\\s),]|$)`).test(
    lowercaseIndexDefinition
  );
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
