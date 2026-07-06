import {
  analyzeFormulaIndexability,
  type DomainError,
  FieldId,
  FieldType,
  type FormulaField,
  type Table,
} from '@teable/v2-core';
import { type Result } from 'neverthrow';

import {
  TableQueryShapeFactory,
  type TableQueryAggregationShape,
  type TableQueryExecutionShape,
  type TableQueryFormulaAccessPathShape,
  type TableQueryOperatorFamily,
  type TableQueryOrderFieldShape,
  type TableQueryRelationShape,
  type TableQueryShape,
} from './domain';

export type QueryConfigShapeInput = {
  readonly table: Table;
  readonly filter?: unknown;
  readonly sort?: unknown;
  readonly group?: unknown;
  readonly relationShape?: TableQueryRelationShape;
  readonly executionShape?: TableQueryExecutionShape;
};

export type ParsedFilterLeaf = {
  readonly fieldId: string;
  readonly operator: string;
  readonly isFieldReference?: boolean;
};

export type ParsedFilterStats = {
  readonly conditionCount: number;
  readonly andDepth: number;
  readonly orDepth: number;
  readonly leaves: ReadonlyArray<ParsedFilterLeaf>;
};

export const buildQueryConfigShape = (
  input: QueryConfigShapeInput
): Result<TableQueryShape | undefined, DomainError> => {
  const filterStats = parseFilterStats(input.filter);
  const sortFields = parseSortFields(input.sort, 'sort');
  const groupFields = parseGroupFields(input.group);

  if (!filterStats && sortFields.length === 0 && groupFields.length === 0) {
    return input.relationShape
      ? buildShape(input.table, undefined, [], input.relationShape, input.executionShape)
      : TableQueryShapeFactory.fromQuery({
          table: input.table,
          queryKind: 'recordList',
          executionShape: input.executionShape ?? {
            durationMs: 0,
            timedOut: false,
            resultCountBucket: 'none',
          },
        }).map(() => undefined);
  }

  return buildShape(
    input.table,
    filterStats,
    [...sortFields, ...groupFields],
    input.relationShape,
    input.executionShape
  );
};

const buildShape = (
  table: Table,
  filterStats: ParsedFilterStats | undefined,
  orderFields: ReadonlyArray<TableQueryOrderFieldShape>,
  relationShape: TableQueryRelationShape | undefined,
  executionShape: TableQueryExecutionShape | undefined
): Result<TableQueryShape, DomainError> => {
  const fieldsById = new Map(table.getFields().map((field) => [field.id().toString(), field]));
  const fieldIds = new Set(fieldsById.keys());
  const whereFields = (filterStats?.leaves ?? [])
    .filter((leaf) => fieldIds.has(leaf.fieldId))
    .map((leaf) => {
      const fieldId = FieldId.create(leaf.fieldId);
      if (fieldId.isErr()) return undefined;
      const field = fieldsById.get(leaf.fieldId);
      const formula = field?.type().equals(FieldType.formula())
        ? buildFormulaAccessPathShape(field as FormulaField)
        : undefined;
      const formulaSourceFieldId =
        formula?.sourceKind === 'formula_source' && formula.referencedFieldIds.length === 1
          ? formula.referencedFieldIds[0]
          : undefined;
      const effectiveFieldId = formulaSourceFieldId
        ? FieldId.create(formulaSourceFieldId)
        : fieldId;
      if (effectiveFieldId.isErr()) return undefined;
      const operatorFamily = toFormulaAwareOperatorFamily(
        toOperatorFamily(leaf.operator, leaf.isFieldReference),
        formula
      );
      return {
        fieldId: effectiveFieldId.value,
        operatorFamily,
        ...(formula
          ? {
              sourceKind:
                formula.sourceKind === 'formula_source'
                  ? 'formula_source'
                  : formula.sourceKind === 'formula_expression'
                    ? 'formula_expression'
                    : 'formula_result',
            }
          : {}),
        ...(formula ? { formula } : {}),
      };
    })
    .filter(
      (
        field
      ): field is {
        fieldId: FieldId;
        operatorFamily: TableQueryOperatorFamily;
        sourceKind?: 'direct_field' | 'formula_result' | 'formula_source' | 'formula_expression';
        formula?: TableQueryFormulaAccessPathShape;
      } => Boolean(field)
    );
  const orderBy = orderFields
    .filter((field) => field.fieldId && fieldIds.has(field.fieldId))
    .map((field) => {
      const fieldId = FieldId.create(field.fieldId!);
      if (fieldId.isErr()) return undefined;
      return {
        fieldId: fieldId.value,
        direction: field.direction,
        source: field.source,
      };
    })
    .filter(
      (field): field is { fieldId: FieldId; direction: 'asc' | 'desc'; source: 'sort' | 'group' } =>
        Boolean(field)
    );

  const aggregationShape = orderBy.some((field) => field.source === 'group')
    ? ({
        groupFieldCount: orderBy.filter((field) => field.source === 'group').length,
        metricCount: 0,
        hasFilter: Boolean(filterStats),
      } satisfies TableQueryAggregationShape)
    : undefined;

  return TableQueryShapeFactory.fromQuery({
    table,
    queryKind: relationShape
      ? 'relation'
      : filterStats
        ? 'filter'
        : orderBy.some((field) => field.source === 'group')
          ? 'group'
          : 'sort',
    whereShape: filterStats
      ? {
          conditionCount: filterStats.conditionCount,
          andDepth: filterStats.andDepth,
          orDepth: filterStats.orDepth,
          fields: whereFields,
        }
      : undefined,
    orderBy,
    aggregationShape,
    relationShape,
    executionShape: executionShape ?? {
      durationMs: 0,
      timedOut: false,
      resultCountBucket: 'none',
    },
  });
};

export const parseFilterStats = (value: unknown): ParsedFilterStats | undefined => {
  const root = parseJsonObject(value);
  if (!root) return undefined;
  const leaves: ParsedFilterLeaf[] = [];

  const walk = (
    node: unknown,
    depth: { readonly andDepth: number; readonly orDepth: number }
  ): { readonly andDepth: number; readonly orDepth: number } => {
    if (!node || typeof node !== 'object') return depth;
    const item = node as Record<string, unknown>;
    if (typeof item.fieldId === 'string' && typeof item.operator === 'string') {
      leaves.push({
        fieldId: item.fieldId,
        operator: item.operator,
        isFieldReference: item.isSymbol === true || containsFieldReference(item.value),
      });
      return depth;
    }
    if (!Array.isArray(item.filterSet)) return depth;
    const conjunction = item.conjunction === 'or' ? 'or' : 'and';
    const nextDepth = {
      andDepth: conjunction === 'and' ? depth.andDepth + 1 : depth.andDepth,
      orDepth: conjunction === 'or' ? depth.orDepth + 1 : depth.orDepth,
    };
    return item.filterSet.reduce(
      (maxDepth, child) => {
        const childDepth = walk(child, nextDepth);
        return {
          andDepth: Math.max(maxDepth.andDepth, childDepth.andDepth),
          orDepth: Math.max(maxDepth.orDepth, childDepth.orDepth),
        };
      },
      { andDepth: nextDepth.andDepth, orDepth: nextDepth.orDepth }
    );
  };

  const depth = walk(root, { andDepth: 0, orDepth: 0 });
  return leaves.length
    ? {
        conditionCount: leaves.length,
        andDepth: depth.andDepth,
        orDepth: depth.orDepth,
        leaves,
      }
    : undefined;
};

export const parseSortFields = (
  value: unknown,
  source: 'sort'
): ReadonlyArray<TableQueryOrderFieldShape> => {
  const root = parseJsonObject(value);
  if (!root) return [];
  const sortObjects = Array.isArray(root.sortObjs) ? root.sortObjs : [root];
  return sortObjects.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const sortItem = item as Record<string, unknown>;
    if (typeof sortItem.fieldId !== 'string') return [];
    return [
      {
        fieldId: sortItem.fieldId,
        direction: sortItem.order === 'desc' ? 'desc' : 'asc',
        source,
      },
    ];
  });
};

export const parseGroupFields = (value: unknown): ReadonlyArray<TableQueryOrderFieldShape> => {
  const root = parseJsonArray(value);
  if (!root) return [];
  return root.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const groupItem = item as Record<string, unknown>;
    if (typeof groupItem.fieldId !== 'string') return [];
    return [
      {
        fieldId: groupItem.fieldId,
        direction: groupItem.order === 'desc' ? 'desc' : 'asc',
        source: 'group',
      },
    ];
  });
};

const parseJsonObject = (value: unknown): Record<string, unknown> | undefined => {
  if (!value) return undefined;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

const parseJsonArray = (value: unknown): unknown[] | undefined => {
  if (!value) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const containsFieldReference = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsFieldReference);
  const record = value as Record<string, unknown>;
  return (
    typeof record.fieldId === 'string' ||
    typeof record.field === 'string' ||
    Object.values(record).some(containsFieldReference)
  );
};

const buildFormulaAccessPathShape = (
  field: FormulaField
): TableQueryFormulaAccessPathShape | undefined => {
  const analysis = analyzeFormulaIndexability(field.expression());
  if (analysis.isErr()) {
    return {
      formulaFieldId: field.id().toString(),
      referencedFieldIds: [],
      functionNames: [],
      stable: false,
      sourceKind: 'formula_result',
      operatorFamilies: [],
      candidateIndexes: [],
      skippedReasons: ['formula_parse_failed'],
      expressionIndexable: false,
      expressionIndexSkippedReasons: ['formula_parse_failed'],
      sqlTranslatable: false,
    };
  }
  return {
    formulaFieldId: field.id().toString(),
    referencedFieldIds: analysis.value.referencedFieldIds,
    functionNames: analysis.value.functions.map((item) => item.name),
    stable: analysis.value.stable,
    sourceKind: analysis.value.sourceKind,
    operatorFamilies: analysis.value.operatorFamilies,
    candidateIndexes: analysis.value.candidateIndexes,
    skippedReasons: analysis.value.skippedReasons,
    expressionIndexable: analysis.value.expressionIndexable,
    expressionIndexSkippedReasons: analysis.value.expressionIndexSkippedReasons,
    ...(analysis.value.predicatePushdown
      ? {
          predicatePushdown: {
            supported: analysis.value.predicatePushdown.supported,
            operatorFamilies: analysis.value.predicatePushdown.operatorFamilies,
            sourceFunctionNames: analysis.value.predicatePushdown.sourceFunctionNames,
            skippedReasons: analysis.value.predicatePushdown.skippedReasons,
          },
        }
      : {}),
    sqlTranslatable: analysis.value.stable,
  };
};

const toFormulaAwareOperatorFamily = (
  operatorFamily: TableQueryOperatorFamily,
  formula: TableQueryFormulaAccessPathShape | undefined
): TableQueryOperatorFamily => {
  if (!formula) return operatorFamily;
  if (!formula.stable) return 'formula_result';
  const predicateFamilies = formula.predicatePushdown?.supported
    ? formula.predicatePushdown.operatorFamilies
    : [];
  if (formula.sourceKind === 'formula_source') {
    if (predicateFamilies.includes('text_contains')) return 'text_contains';
    if (predicateFamilies.includes('text_prefix')) return 'text_prefix';
    if (predicateFamilies.includes('equality')) return 'equality';
    if (predicateFamilies.includes('range')) return 'range';
    if (formula.operatorFamilies.includes('text_contains')) return 'text_contains';
    if (formula.operatorFamilies.includes('text_prefix')) return 'text_prefix';
    if (operatorFamily === 'equality' || operatorFamily === 'range') return operatorFamily;
  }
  if (formula.sourceKind === 'formula_expression') return 'formula_result';
  return 'formula_result';
};

const toOperatorFamily = (
  operator: string,
  isFieldReference: boolean | undefined
): TableQueryOperatorFamily => {
  if (isFieldReference) return 'link';
  switch (operator) {
    case 'contains':
    case 'doesNotContain':
    case 'LIKE':
    case 'NOT LIKE':
      return 'text_contains';
    case 'startsWith':
    case 'doesNotStartWith':
    case 'starts_with':
    case 'STARTS_WITH':
      return 'text_prefix';
    case 'isGreater':
    case 'isGreaterEqual':
    case 'isLess':
    case 'isLessEqual':
    case 'isBefore':
    case 'isAfter':
    case 'isOnOrBefore':
    case 'isOnOrAfter':
    case '>':
    case '>=':
    case '<':
    case '<=':
      return 'range';
    case 'isEmpty':
    case 'isNotEmpty':
      return 'empty';
    case 'hasAnyOf':
    case 'hasAllOf':
    case 'isAnyOf':
      return 'selection';
    case 'is':
    case 'isNot':
    case '=':
    case '!=':
    case 'eq':
      return 'equality';
    default:
      return 'unknown';
  }
};
