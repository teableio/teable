import type { DomainError } from '@teable/v2-core';
import {
  stableHash,
  TableQueryShape,
  type TableQueryExecutionShape,
  type TableQueryOrderFieldShape,
  type TableQuerySqlDiagnostic,
  type TableQueryWhereShape,
  type TableQueryWhereFieldShape,
  type TableQueryOperatorFamily,
} from '@teable/v2-table-query-ops';
import type { Result } from 'neverthrow';
import type { AST, ColumnRefItem, Select } from 'node-sql-parser';

export type BaseSqlFieldObservationTarget = {
  readonly id: string;
  readonly dbFieldName: string;
  readonly type: string;
};

export type BaseSqlTableObservationTarget = {
  readonly tableId: string;
  readonly baseId: string;
  readonly spaceId?: string;
  readonly dbTableName: string;
  readonly fields: ReadonlyArray<BaseSqlFieldObservationTarget>;
};

export type BaseSqlParsedQuery = {
  readonly ast: AST | AST[];
  readonly tableNames: ReadonlyArray<string>;
};

export type BaseSqlQueryObservationShape = {
  readonly shape: TableQueryShape;
  readonly diagnostic: TableQuerySqlDiagnostic;
};

const SYSTEM_SORT_COLUMNS: Readonly<Record<string, true>> = {
  __auto_number: true,
  __created_time: true,
  __last_modified_time: true,
  __version: true,
};

export const buildBaseSqlQueryObservationShape = (input: {
  readonly parsed: BaseSqlParsedQuery;
  readonly target: BaseSqlTableObservationTarget;
  readonly executionShape: TableQueryExecutionShape;
}): Result<BaseSqlQueryObservationShape, DomainError> => {
  const diagnosticBase = buildDiagnostic(input.parsed.ast);
  const select = getSimpleSelect(input.parsed.ast);
  if (!select) {
    return createShape(input.executionShape, undefined, {
      ...diagnosticBase,
      statementKind: 'select_unsupported_statement',
    });
  }

  const source = getSimpleSource(select);
  const metadataFields = new Map(input.target.fields.map((field) => [field.dbFieldName, field]));
  const orderFields = source ? resolveOrderFields(select, source, metadataFields) : undefined;
  const unsupportedReason = !source
    ? 'source'
    : input.parsed.tableNames.length !== 1
      ? 'multiple_tables'
      : orderFields === undefined
        ? 'order'
        : undefined;
  if (unsupportedReason) {
    return createShape(input.executionShape, undefined, {
      ...diagnosticBase,
      statementKind: `select_unsupported_${unsupportedReason}`,
    });
  }

  return createShape(
    input.executionShape,
    orderFields,
    {
      ...diagnosticBase,
      statementKind: 'select',
    },
    source ? resolveWhereShape(select.where, source, metadataFields) : undefined
  );
};

const createShape = (
  executionShape: TableQueryExecutionShape,
  orderFields: ReadonlyArray<TableQueryOrderFieldShape> | undefined,
  diagnostic: TableQuerySqlDiagnostic,
  whereShape?: TableQueryWhereShape
): Result<BaseSqlQueryObservationShape, DomainError> => {
  const shape = TableQueryShape.create({
    queryKind: orderFields?.length ? 'sort' : whereShape?.conditionCount ? 'filter' : 'recordList',
    ...(whereShape ? { whereShape } : {}),
    ...(orderFields?.length ? { orderShape: { fields: orderFields } } : {}),
    executionShape,
  });
  return shape.map((value) => ({ shape: value, diagnostic }));
};

const getSimpleSelect = (ast: AST | AST[]): Select | undefined => {
  const statement = Array.isArray(ast) ? (ast.length === 1 ? ast[0] : undefined) : ast;
  if (!statement || statement.type !== 'select') return undefined;
  const distinct: unknown = statement.distinct;
  const hasDistinct =
    typeof distinct === 'string'
      ? Boolean(distinct)
      : Boolean(distinct && typeof distinct === 'object' && 'type' in distinct && distinct.type);
  if (
    statement.with?.length ||
    statement.set_op ||
    statement._next ||
    hasDistinct ||
    statement.groupby ||
    statement.having ||
    containsComplexExpression(statement.columns) ||
    containsComplexExpression(statement.where)
  )
    return undefined;
  return statement as Select;
};

const containsComplexExpression = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(containsComplexExpression);
  if (!value || typeof value !== 'object') return false;
  const node = value as Record<string, unknown>;
  if (
    node.type === 'select' ||
    node.type === 'aggr_func' ||
    node.type === 'window_func' ||
    node.over
  )
    return true;
  return Object.values(node).some(containsComplexExpression);
};

const getSimpleSource = (
  select: Select
): { readonly alias?: string; readonly table: string } | undefined => {
  if (!Array.isArray(select.from) || select.from.length !== 1) return undefined;
  const source = select.from[0];
  if (!source || typeof source !== 'object' || !('table' in source)) return undefined;
  const typed = source as { table?: unknown; as?: unknown; join?: unknown };
  if (typeof typed.table !== 'string' || typed.join) return undefined;
  return {
    table: typed.table,
    alias: typeof typed.as === 'string' ? typed.as : undefined,
  };
};

type SqlSource = { readonly alias?: string; readonly table: string };

const sourceColumn = (value: unknown, source: SqlSource): string | undefined => {
  const reference = columnReference(value);
  if (!reference || (reference.table && reference.table !== (source.alias ?? source.table)))
    return undefined;
  return columnName(reference.column) || undefined;
};

const constantOperandTypes: Readonly<Record<string, true>> = {
  single_quote_string: true,
  number: true,
  bigint: true,
  bool: true,
  boolean: true,
  null: true,
  param: true,
};

const isBoundParameter = (node: Record<string, unknown>): boolean =>
  node.type === 'var' &&
  node.prefix === '$' &&
  typeof node.name === 'number' &&
  Number.isInteger(node.name) &&
  node.name > 0;

const isConstantOperand = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const node = value as Record<string, unknown>;
  if (typeof node.type === 'string' && constantOperandTypes[node.type] === true) return true;
  if (isBoundParameter(node)) return true;
  return (
    node.type === 'expr_list' &&
    Array.isArray(node.value) &&
    node.value.length > 0 &&
    node.value.every(isConstantOperand)
  );
};

const predicateFamily = (operator: string, value: unknown): TableQueryOperatorFamily => {
  const right = value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
  if (operator === 'IS' && right?.type === 'null') return 'empty';
  if (!isConstantOperand(value)) return 'unknown';
  // Non-null and inequality predicates are not equality prefixes for a composite sort index.
  switch (operator) {
    case '=':
      return 'equality';
    case '>':
    case '>=':
    case '<':
    case '<=':
    case 'BETWEEN':
      return 'range';
    case 'IN':
      return 'selection';
    default:
      return 'unknown';
  }
};

const resolveWhereShape = (
  where: unknown,
  source: SqlSource,
  metadataFields: ReadonlyMap<string, BaseSqlFieldObservationTarget>
): TableQueryWhereShape | undefined => {
  if (!where) return undefined;
  let conditionCount = 0;
  let andDepth = 0;
  let orDepth = 0;
  const fields = new Map<string, TableQueryWhereFieldShape>();
  const visit = (value: unknown, andLevel: number, orLevel: number): void => {
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    const operator = typeof node.operator === 'string' ? node.operator.toUpperCase() : '';
    if (node.type === 'binary_expr' && (operator === 'AND' || operator === 'OR')) {
      const nextAnd = andLevel + Number(operator === 'AND');
      const nextOr = orLevel + Number(operator === 'OR');
      andDepth = Math.max(andDepth, nextAnd);
      orDepth = Math.max(orDepth, nextOr);
      visit(node.left, nextAnd, nextOr);
      visit(node.right, nextAnd, nextOr);
      return;
    }
    conditionCount++;
    const column = sourceColumn(node.left, source);
    const field = column ? metadataFields.get(column) : undefined;
    if (!field) return;
    const operatorFamily = predicateFamily(operator, node.right);
    fields.set(`${field.id}:${operatorFamily}`, {
      fieldId: field.id,
      fieldType: field.type,
      operatorFamily,
    });
  };
  visit(where, 0, 0);
  return { conditionCount, andDepth, orDepth, fields: [...fields.values()] };
};

const projectionAliases = (columns: Select['columns']) => {
  const aliases = new Map<string, ColumnRefItem | undefined>();
  for (const column of columns ?? []) {
    if (!column || typeof column !== 'object' || !('expr' in column)) continue;
    const typed = column as { expr?: unknown; as?: unknown };
    const alias = aliasName(typed.as);
    if (alias) aliases.set(alias, aliases.has(alias) ? undefined : columnReference(typed.expr));
  }
  return aliases;
};

const resolveOrderField = (
  order: { readonly expr: unknown; readonly type?: unknown; readonly nulls?: unknown },
  source: SqlSource,
  metadataFields: ReadonlyMap<string, BaseSqlFieldObservationTarget>,
  aliases: ReadonlyMap<string, ColumnRefItem | undefined>
): TableQueryOrderFieldShape | undefined => {
  const direction = order.type ?? 'ASC';
  if ((direction !== 'ASC' && direction !== 'DESC') || order.nulls) return undefined;
  const reference = columnReference(order.expr);
  if (!reference) return undefined;
  const orderName = columnName(reference.column);
  const expression =
    !reference.table && aliases.has(orderName) ? aliases.get(orderName) : reference;
  const column = sourceColumn(expression, source);
  if (!column) return undefined;
  const sortDirection = direction === 'DESC' ? 'desc' : 'asc';
  if (SYSTEM_SORT_COLUMNS[column] === true)
    return { systemColumn: column, direction: sortDirection, source: 'sort' };
  const field = metadataFields.get(column);
  return field ? { fieldId: field.id, direction: sortDirection, source: 'sort' } : undefined;
};

const resolveOrderFields = (
  select: Select,
  source: SqlSource,
  metadataFields: ReadonlyMap<string, BaseSqlFieldObservationTarget>
): ReadonlyArray<TableQueryOrderFieldShape> | undefined => {
  if (!select.orderby?.length) return [];
  const aliases = projectionAliases(select.columns);
  const fields: TableQueryOrderFieldShape[] = [];
  for (const order of select.orderby) {
    const field = resolveOrderField(order, source, metadataFields, aliases);
    if (!field) return undefined;
    fields.push(field);
  }
  return fields;
};

const columnReference = (value: unknown): ColumnRefItem | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const typed = value as { type?: unknown; expr?: unknown };
  if (typed.type === 'expr') return columnReference(typed.expr);
  return typed.type === 'column_ref' && 'column' in value ? (value as ColumnRefItem) : undefined;
};

const aliasName = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const typed = value as { value?: unknown };
  return typeof typed.value === 'string' ? typed.value : '';
};

const columnName = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const typed = value as { expr?: { value?: unknown } };
  return typeof typed.expr?.value === 'string' ? typed.expr.value : '';
};

const buildDiagnostic = (ast: AST | AST[]): TableQuerySqlDiagnostic => ({
  source: 'base_sql_executor',
  statementKind: 'select',
  fingerprint: stableHash({ sqlAst: sanitizeAst(ast) }),
  parameterCount: countParameters(ast),
  sampled: false,
});

const sanitizeAst = (value: unknown, parentType?: string): unknown => {
  if (Array.isArray(value)) return value.map((item) => sanitizeAst(item, parentType));
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : parentType;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (key === 'loc') continue;
    if (key === 'value' && type !== 'double_quote_string' && parentType !== 'identifier') {
      result[key] = '<literal>';
      continue;
    }
    const childContext = type === 'function' && key === 'name' ? 'identifier' : type;
    result[key] = sanitizeAst(child, childContext);
  }
  return result;
};

const countParameters = (value: unknown): number => {
  if (Array.isArray(value)) return value.reduce((count, item) => count + countParameters(item), 0);
  if (!value || typeof value !== 'object') return 0;
  const record = value as Record<string, unknown>;
  const own = record.type === 'param' || isBoundParameter(record) ? 1 : 0;
  return (
    own + Object.values(record).reduce<number>((count, item) => count + countParameters(item), 0)
  );
};
