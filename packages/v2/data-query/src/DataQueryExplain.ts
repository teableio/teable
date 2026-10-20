import { z } from 'zod';

/**
 * Explain output is a diagnostic projection, never a second query surface.
 *
 * The compiled SELECT may contain host-injected row/field scopes, so the public
 * text is caller-scoped only. The plan is always projected through a fixed
 * allow-list: PostgreSQL custom plans inline bound values and permission
 * predicates, and neither may leave the database boundary.
 */

export type DataQueryExplainPlanMode = 'generic' | 'structural' | 'unavailable';

export type DataQueryExplainPlanNode = {
  readonly nodeType: string;
  readonly strategy?: string;
  readonly joinType?: string;
  readonly parentRelationship?: string;
  readonly startupCost?: number;
  readonly totalCost?: number;
  readonly planRows?: number;
  readonly planWidth?: number;
  readonly sortMethod?: string;
  readonly children?: ReadonlyArray<DataQueryExplainPlanNode>;
};

export type DataQueryExplainPlan = {
  readonly mode: DataQueryExplainPlanMode;
  readonly analyzed: false;
  readonly format: 'json';
  /** Always caller scope: host row/field policy never changes the shown plan. */
  readonly scope: 'caller';
  readonly root?: DataQueryExplainPlanNode;
};

export interface DataQueryExplainParameterDefinition {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
}

export interface DataQueryExplainParameters {
  /** Declared names in canonical definition order; never values or defaults. */
  readonly order: ReadonlyArray<string>;
  /** Declaration order, never claimed to be SQL $n positions. */
  readonly orderKind: 'declaration';
  readonly redaction: 'bind-values-hidden';
  readonly bindCount: number;
  readonly definitions: ReadonlyArray<DataQueryExplainParameterDefinition>;
}

export interface DataQueryExplainHostScope {
  readonly rowScope: 'applied';
  readonly fieldScope: 'applied';
  readonly fieldMaskCount: number | null;
}

export interface DataQueryExplainTiming {
  readonly planningMs: number;
  readonly totalMs: number;
}

export interface DataQueryExplainResult {
  /** Caller-authored statement with placeholders; host predicates are summarized below. */
  readonly sql: string;
  readonly sqlScope: 'caller';
  readonly hostScope: DataQueryExplainHostScope;
  readonly parameters: DataQueryExplainParameters;
  readonly plan: DataQueryExplainPlan;
  readonly timing: DataQueryExplainTiming;
}

const numericKeys = {
  'Startup Cost': 'startupCost',
  'Total Cost': 'totalCost',
  'Plan Rows': 'planRows',
  'Plan Width': 'planWidth',
} as const;

const stringKeys = {
  'Node Type': 'nodeType',
  Strategy: 'strategy',
  'Join Type': 'joinType',
  'Parent Relationship': 'parentRelationship',
  'Sort Method': 'sortMethod',
} as const;

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asShortLabel = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : undefined;

/**
 * Fixed allow-list: node shape, planner estimates and safe strategy labels.
 * Relation names, index names, sort keys, outputs, filters, conditions and any
 * other expression text are intentionally absent.
 */
export const projectExplainPlanNode = (
  value: unknown,
  depth = 0
): DataQueryExplainPlanNode | undefined => {
  if (depth > 64 || typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const nodeType = asShortLabel(record['Node Type']);
  if (!nodeType) return undefined;
  const node: Record<string, unknown> = { nodeType };
  for (const [key, alias] of Object.entries(stringKeys)) {
    if (alias === 'nodeType') continue;
    const label = asShortLabel(record[key]);
    if (label !== undefined) node[alias] = label;
  }
  for (const [key, alias] of Object.entries(numericKeys)) {
    const number = asFiniteNumber(record[key]);
    if (number !== undefined) node[alias] = number;
  }
  const children = record['Plans'];
  if (Array.isArray(children)) {
    const projected = children
      .map((child) => projectExplainPlanNode(child, depth + 1))
      .filter((child): child is DataQueryExplainPlanNode => child !== undefined);
    if (projected.length) node.children = projected;
  }
  return node as DataQueryExplainPlanNode;
};

const parsePlanDocument = (raw: unknown): unknown => {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return raw;
};

/** PostgreSQL returns `[{ Plan: ... }]`; never trust or forward the rest of the document. */
export const projectExplainPlanDocument = (
  raw: unknown,
  mode: Exclude<DataQueryExplainPlanMode, 'unavailable'>
): DataQueryExplainPlan => {
  const document = parsePlanDocument(raw);
  const first = Array.isArray(document) ? document[0] : undefined;
  const plan =
    typeof first === 'object' && first !== null
      ? (first as Record<string, unknown>)['Plan']
      : undefined;
  const root = projectExplainPlanNode(plan);
  return root
    ? { mode, analyzed: false, format: 'json', scope: 'caller', root }
    : { mode: 'unavailable', analyzed: false, format: 'json', scope: 'caller' };
};

/** Last line of defense before serialization; a value hit is a programming error. */
export const explainResultContainsSecret = (
  value: unknown,
  secrets: ReadonlyArray<string | number>
): boolean => {
  const text = JSON.stringify(value);
  return secrets
    .map((secret) => String(secret))
    .filter((secret) => secret.length > 0)
    .some((secret) => text.includes(secret));
};

export const explainPlanNodeSchema: z.ZodType<DataQueryExplainPlanNode> = z.lazy(() =>
  z
    .object({
      nodeType: z.string(),
      strategy: z.string().optional(),
      joinType: z.string().optional(),
      parentRelationship: z.string().optional(),
      startupCost: z.number().optional(),
      totalCost: z.number().optional(),
      planRows: z.number().optional(),
      planWidth: z.number().optional(),
      sortMethod: z.string().optional(),
      children: z.array(explainPlanNodeSchema).optional(),
    })
    .strict()
);

/**
 * Wire result. `sqlScope: 'caller'` is a security assertion, not a hint: the SQL
 * excludes host-injected row/field policy, and no bind value appears anywhere.
 */
export const queryExplainResultSchema = z
  .object({
    sql: z.string(),
    sqlScope: z.literal('caller'),
    hostScope: z
      .object({
        rowScope: z.literal('applied'),
        fieldScope: z.literal('applied'),
        fieldMaskCount: z.number().int().nonnegative().nullable(),
      })
      .strict(),
    parameters: z
      .object({
        order: z.array(z.string()),
        orderKind: z.literal('declaration'),
        redaction: z.literal('bind-values-hidden'),
        bindCount: z.number().int().nonnegative(),
        definitions: z.array(
          z
            .object({
              name: z.string(),
              type: z.string(),
              nullable: z.boolean(),
            })
            .strict()
        ),
      })
      .strict(),
    plan: z
      .object({
        mode: z.enum(['generic', 'structural', 'unavailable']),
        analyzed: z.literal(false),
        format: z.literal('json'),
        scope: z.literal('caller'),
        root: explainPlanNodeSchema.optional(),
      })
      .strict(),
    timing: z
      .object({ planningMs: z.number().nonnegative(), totalMs: z.number().nonnegative() })
      .strict(),
  })
  .strict();
export type DataQueryExplainResultDto = z.infer<typeof queryExplainResultSchema>;
