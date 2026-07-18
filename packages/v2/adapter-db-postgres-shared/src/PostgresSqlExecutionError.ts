import type { CompiledQuery } from 'kysely';

const MAX_SQL_SAMPLE_LENGTH = 4000;

type PostgresErrorLike = {
  code?: unknown;
  severity?: unknown;
  position?: unknown;
  routine?: unknown;
  schema?: unknown;
  table?: unknown;
  column?: unknown;
  dataType?: unknown;
  constraint?: unknown;
};

export type PostgresSqlExecutionContext = {
  readonly source: string;
  readonly tableId?: string;
  readonly tableName?: string;
  readonly fieldIds?: ReadonlyArray<string>;
  readonly stepLevel?: number;
};

export type PostgresSqlExecutionDiagnostics = {
  readonly version: 1;
  readonly source: string;
  readonly statement: {
    readonly kind: string;
    readonly fingerprint: string;
    readonly sqlLength: number;
    readonly parameterCount: number;
    readonly parametersCaptured: false;
    readonly normalizedSql: string;
    readonly sampleStart: number;
    readonly truncated: boolean;
  };
  readonly postgres?: {
    readonly sqlState?: string;
    readonly severity?: string;
    readonly position?: number;
    readonly routine?: string;
    readonly schema?: string;
    readonly table?: string;
    readonly column?: string;
    readonly dataType?: string;
    readonly constraint?: string;
  };
  readonly context?: {
    readonly tableId?: string;
    readonly tableName?: string;
    readonly fieldIds?: ReadonlyArray<string>;
    readonly stepLevel?: number;
  };
};

const stringValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const parsePosition = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const redactSqlLiterals = (sql: string): string =>
  sql
    .replace(/'(?:''|[^'])*'/g, "'<literal>'")
    .replace(/\b\d+(?:\.\d+)?\b/g, '<number>')
    .replace(/\s+/g, ' ')
    .trim();

const fingerprint = (value: string): string => {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
};

const statementKind = (sql: string): string => sql.match(/^[a-z]+/i)?.[0]?.toLowerCase() ?? 'sql';

const buildSqlSample = (
  sql: string,
  errorPosition?: number
): { normalizedSql: string; sampleStart: number; truncated: boolean } => {
  const zeroBasedPosition = errorPosition == null ? 0 : Math.max(0, errorPosition - 1);
  const sampleStart = Math.max(
    0,
    Math.min(sql.length - MAX_SQL_SAMPLE_LENGTH, zeroBasedPosition - MAX_SQL_SAMPLE_LENGTH / 2)
  );
  const sample = sql.slice(sampleStart, sampleStart + MAX_SQL_SAMPLE_LENGTH);
  return {
    normalizedSql: redactSqlLiterals(sample),
    sampleStart,
    truncated: sampleStart > 0 || sample.length < sql.length,
  };
};

const buildPostgresFields = (
  error: PostgresErrorLike
): PostgresSqlExecutionDiagnostics['postgres'] | undefined => {
  const fields = {
    sqlState: stringValue(error.code),
    severity: stringValue(error.severity),
    position: parsePosition(error.position),
    routine: stringValue(error.routine),
    schema: stringValue(error.schema),
    table: stringValue(error.table),
    column: stringValue(error.column),
    dataType: stringValue(error.dataType),
    constraint: stringValue(error.constraint),
  };
  return Object.values(fields).some((value) => value !== undefined) ? fields : undefined;
};

export class PostgresSqlExecutionError extends Error {
  readonly diagnostics: PostgresSqlExecutionDiagnostics;

  constructor(
    cause: unknown,
    compiled: Pick<CompiledQuery, 'sql' | 'parameters'>,
    context: PostgresSqlExecutionContext
  ) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(message, { cause });
    this.name = cause instanceof Error ? cause.name : 'PostgresSqlExecutionError';

    const postgres = buildPostgresFields((cause ?? {}) as PostgresErrorLike);
    const sample = buildSqlSample(compiled.sql, postgres?.position);
    const normalizedStatement = redactSqlLiterals(compiled.sql);
    const diagnosticContext = {
      tableId: context.tableId,
      tableName: context.tableName,
      fieldIds: context.fieldIds,
      stepLevel: context.stepLevel,
    };
    this.diagnostics = {
      version: 1,
      source: context.source,
      statement: {
        kind: statementKind(normalizedStatement),
        fingerprint: fingerprint(normalizedStatement),
        sqlLength: compiled.sql.length,
        parameterCount: compiled.parameters.length,
        parametersCaptured: false,
        ...sample,
      },
      ...(postgres ? { postgres } : {}),
      ...(Object.values(diagnosticContext).some((value) => value !== undefined)
        ? { context: diagnosticContext }
        : {}),
    };
  }
}

export const getPostgresSqlExecutionDiagnostics = (
  error: unknown
): PostgresSqlExecutionDiagnostics | undefined =>
  error instanceof PostgresSqlExecutionError ? error.diagnostics : undefined;
