/* eslint-disable sonarjs/cognitive-complexity -- one recursive visitor over an untrusted SQL AST keeps each capability check beside the grammar node it inspects; splitting it moves shared state into parameters and hides omissions. Boundary behavior is covered by structured-coverage.spec.ts. */
import { createHash } from 'node:crypto';
import type { AST } from 'node-sql-parser';

const STRUCTURED_COVERAGE_VERSION = 2;
export const STRUCTURED_COVERAGE_ATTRIBUTE_PREFIX = 'teable.data_query.coverage';

export type StructuredCoverageCandidate = 'records' | 'aggregate';

export type StructuredCoverageFeature =
  | 'aggregate'
  | 'filter'
  | 'group'
  | 'join'
  | 'pagination'
  | 'sort'
  | 'subquery'
  | 'window';

export type StructuredCoverageGap =
  | 'aggregate_expression'
  | 'aggregate_filter'
  | 'common_table_expression'
  | 'distinct_projection'
  | 'filter_expression'
  | 'group_expression'
  | 'having'
  | 'join'
  | 'missing_aggregate'
  | 'missing_source'
  | 'multiple_statements'
  | 'non_select_statement'
  | 'pagination_expression'
  | 'projection_expression'
  | 'set_operation'
  | 'sort_expression'
  | 'sort_nulls'
  | 'source_expression'
  | 'subquery'
  | 'window';

export type StructuredCoverageUnknown = 'unknown_clause' | 'unknown_expression';

/**
 * A structural migration candidate, not a claim of semantic equivalence.
 * Field types, permissions, formula semantics and result ordering still need
 * validation before a SQL query can be migrated to the structured language.
 */
export type StructuredCoverage = {
  readonly version: typeof STRUCTURED_COVERAGE_VERSION;
  readonly candidate: StructuredCoverageCandidate | null;
  readonly gaps: ReadonlyArray<StructuredCoverageGap>;
  readonly features: ReadonlyArray<StructuredCoverageFeature>;
  readonly unknown: ReadonlyArray<StructuredCoverageUnknown>;
  /** Hash of AST structure only: literals and every identifier are removed. */
  readonly fingerprint: string;
};

type AstNode = Record<string, unknown>;

const expressibleAggregates: Readonly<Record<string, true>> = {
  count: true,
  sum: true,
  avg: true,
  min: true,
  max: true,
};

const knownSelectKeys: Readonly<Record<string, true>> = {
  with: true,
  type: true,
  options: true,
  distinct: true,
  columns: true,
  into: true,
  from: true,
  where: true,
  groupby: true,
  having: true,
  orderby: true,
  limit: true,
  window: true,
  set_op: true,
  _next: true,
  loc: true,
};

const asArray = <T>(value: T | T[] | null | undefined): T[] =>
  value == null ? [] : Array.isArray(value) ? value : [value];

const asNode = (value: unknown): AstNode | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as AstNode)
    : undefined;

const walk = (value: unknown, visit: (node: AstNode) => void): void => {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  const node = value as AstNode;
  visit(node);
  for (const child of Object.values(node)) walk(child, visit);
};

const unwrapExpression = (value: unknown): AstNode | undefined => {
  let node = asNode(value);
  while (node?.type === 'expr') node = asNode(node.expr);
  return node;
};

const isPlainColumn = (value: unknown): boolean => unwrapExpression(value)?.type === 'column_ref';

const isStar = (value: unknown): boolean => unwrapExpression(value)?.type === 'star';

const aggregateName = (node: AstNode): string | undefined => {
  if (typeof node.name === 'string') return node.name.toLowerCase();
  const name = node.name as { name?: Array<{ value?: unknown }> } | undefined;
  const last = name?.name?.[name.name.length - 1]?.value;
  return typeof last === 'string' ? last.toLowerCase() : undefined;
};

const isExpressibleAggregate = (node: AstNode): boolean => {
  const name = aggregateName(node);
  if (!name || expressibleAggregates[name] !== true || node.filter || node.over) return false;
  const args = asNode(node.args);
  const argument = args?.expr;
  if (name === 'count') return isPlainColumn(argument) || isStar(argument);
  return !args?.distinct && isPlainColumn(argument);
};

const containsNode = (value: unknown, predicate: (node: AstNode) => boolean): boolean => {
  let found = false;
  walk(value, (node) => {
    if (!found && predicate(node)) found = true;
  });
  return found;
};

const containsSelect = (value: unknown): boolean =>
  containsNode(value, (node) => node.type === 'select' || asNode(node.ast)?.type === 'select');

const containsWindow = (value: unknown): boolean =>
  containsNode(
    value,
    (node) => node.type === 'window_func' || node.over != null || node.window != null
  );

const functionName = (node: AstNode): string | undefined => {
  const name = node.name as { name?: Array<{ value?: unknown }> } | undefined;
  const value = name?.name?.[name.name.length - 1]?.value;
  return typeof value === 'string' ? value.toUpperCase() : undefined;
};

const isConstantOrParameter = (value: unknown): boolean => {
  const node = unwrapExpression(value);
  if (!node) return false;
  if (
    ['single_quote_string', 'number', 'bigint', 'bool', 'boolean', 'null', 'param'].includes(
      String(node.type)
    )
  )
    return true;
  return (
    node.type === 'var' &&
    node.prefix === '$' &&
    typeof node.name === 'number' &&
    Number.isInteger(node.name)
  );
};

const inspectFilter = (
  value: unknown,
  gaps: Set<StructuredCoverageGap>,
  unknown: Set<StructuredCoverageUnknown>
): void => {
  if (!value) return;
  const node = unwrapExpression(value);
  if (!node) {
    unknown.add('unknown_expression');
    return;
  }
  if (containsSelect(node)) gaps.add('subquery');
  if (node.type === 'binary_expr') {
    const operator = typeof node.operator === 'string' ? node.operator.toUpperCase() : '';
    if (operator === 'AND' || operator === 'OR') {
      inspectFilter(node.left, gaps, unknown);
      inspectFilter(node.right, gaps, unknown);
      return;
    }
    if (!isPlainColumn(node.left)) gaps.add('filter_expression');
    if (!isConstantOrParameter(node.right)) {
      const right = unwrapExpression(node.right);
      const isConstantList =
        right?.type === 'expr_list' &&
        asArray(right.value).length > 0 &&
        asArray(right.value).every(isConstantOrParameter);
      if (!isConstantList) gaps.add('filter_expression');
    }
    return;
  }
  if (node.type === 'unary_expr' && String(node.operator).toUpperCase() === 'NOT') {
    inspectFilter(node.expr, gaps, unknown);
    return;
  }
  if (node.type === 'function' && functionName(node) === 'NOT') {
    const args = asNode(node.args);
    const values = asArray(args?.value);
    if (values.length === 1) inspectFilter(values[0], gaps, unknown);
    else unknown.add('unknown_expression');
    return;
  }
  gaps.add('filter_expression');
};

const hasDistinct = (distinct: unknown): boolean =>
  typeof distinct === 'string' ? distinct.length > 0 : Boolean(asNode(distinct)?.type);

const hasPagination = (select: AstNode): boolean => {
  const limit = asNode(select.limit);
  return Boolean(limit && asArray(limit.value).length > 0);
};

const paginationIsExpressible = (select: AstNode): boolean => {
  const values = asArray(asNode(select.limit)?.value);
  return values.every(isConstantOrParameter);
};

const sanitizeStructure = (value: unknown, key?: string, dropValue = true): unknown => {
  if (Array.isArray(value)) return value.map((item) => sanitizeStructure(item, key, dropValue));
  if (!value || typeof value !== 'object') {
    if (key && ['table', 'db', 'as', 'schema'].includes(key)) return '<identifier>';
    if (key === 'value' && dropValue) return '<literal_or_identifier>';
    return value;
  }
  const record = value as AstNode;
  const nodeType = typeof record.type === 'string' ? record.type : undefined;
  const result: Record<string, unknown> = {};
  for (const [childKey, child] of Object.entries(record)) {
    if (childKey === 'loc' || childKey === 'tableList' || childKey === 'columnList') continue;
    // Function names describe the shape and are not data; keep them so different
    // functions do not collapse into one fingerprint.
    const keepName =
      childKey === 'name' && ['function', 'aggr_func', 'window_func'].includes(String(nodeType));
    result[childKey] = sanitizeStructure(child, childKey, keepName ? false : dropValue);
  }
  return result;
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  const record = value as AstNode;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonicalize(record[key])])
  );
};

const fingerprintStructuredSql = (ast: AST | AST[]): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        version: STRUCTURED_COVERAGE_VERSION,
        ast: canonicalize(sanitizeStructure(ast)),
      })
    )
    .digest('hex')
    .slice(0, 16);

export const classifyStructuredCoverage = (ast: AST | AST[]): StructuredCoverage => {
  const gaps = new Set<StructuredCoverageGap>();
  const unknown = new Set<StructuredCoverageUnknown>();
  const features = new Set<StructuredCoverageFeature>();
  const statements = Array.isArray(ast) ? ast : [ast];
  const select = statements.length === 1 ? asNode(statements[0]) : undefined;
  if (statements.length !== 1) gaps.add('multiple_statements');
  else if (!select || select.type !== 'select') gaps.add('non_select_statement');

  let candidate: StructuredCoverageCandidate | null = null;
  if (select?.type === 'select' && statements.length === 1) {
    if (asArray(select.with).length) gaps.add('common_table_expression');
    if (select.set_op || select._next) gaps.add('set_operation');
    if (hasDistinct(select.distinct)) gaps.add('distinct_projection');
    if (select.where) features.add('filter');
    if (asArray(select.orderby).length) features.add('sort');
    if (hasPagination(select)) features.add('pagination');

    const sources = asArray(select.from as AstNode[] | AstNode | undefined);
    if (sources.length === 0) gaps.add('missing_source');
    if (sources.length > 1) gaps.add('join');
    for (const source of sources) {
      if (typeof source.table !== 'string') {
        const expression = asNode(source.expr);
        gaps.add(
          expression?.type === 'select' || asNode(expression?.ast)?.type === 'select'
            ? 'subquery'
            : 'source_expression'
        );
      }
      if (Array.isArray(source.join) && source.join.length) gaps.add('join');
    }
    if (gaps.has('join')) features.add('join');

    if (containsWindow([select.columns, select.orderby, select.window])) gaps.add('window');
    if (
      containsSelect([select.columns, select.where, select.groupby, select.having, select.orderby])
    )
      gaps.add('subquery');
    if (gaps.has('subquery')) features.add('subquery');
    if (gaps.has('window')) features.add('window');

    const columns = asArray(select.columns as AstNode[] | AstNode | undefined);
    const aggregateNodes: AstNode[] = [];
    for (const column of columns) {
      const expression = unwrapExpression(column.expr ?? column);
      if (expression?.type === 'aggr_func') {
        aggregateNodes.push(expression);
        if (!isExpressibleAggregate(expression)) {
          if (expression.filter) gaps.add('aggregate_filter');
          gaps.add('aggregate_expression');
        }
      } else if (!isPlainColumn(expression)) {
        gaps.add('projection_expression');
      }
    }
    if (aggregateNodes.length) features.add('aggregate');

    const groupBy = asArray(asNode(select.groupby)?.columns);
    if (groupBy.some((group) => !isPlainColumn(asNode(group)?.expr ?? group)))
      gaps.add('group_expression');
    if (select.having) gaps.add('having');
    if (groupBy.length && aggregateNodes.length === 0) gaps.add('missing_aggregate');
    if (groupBy.length) features.add('group');

    candidate =
      aggregateNodes.length > 0 || groupBy.length > 0 || select.having ? 'aggregate' : 'records';
    inspectFilter(select.where, gaps, unknown);

    for (const order of asArray(select.orderby as AstNode[] | AstNode | undefined)) {
      if (!isPlainColumn(order.expr)) gaps.add('sort_expression');
      // Explicit null ordering is expressible through the sort item's `nulls`
      // option, so it is no longer a structural gap.
    }
    if (hasPagination(select) && !paginationIsExpressible(select))
      gaps.add('pagination_expression');

    for (const key of Object.keys(select)) {
      if (knownSelectKeys[key] !== true && select[key] != null) unknown.add('unknown_clause');
    }
  }

  return {
    version: STRUCTURED_COVERAGE_VERSION,
    candidate,
    features: [...features].sort(),
    gaps: [...gaps].sort(),
    unknown: [...unknown].sort(),
    fingerprint: fingerprintStructuredSql(ast),
  };
};
