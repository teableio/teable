/* eslint-disable @typescript-eslint/naming-convention */
// SQLSTATE and driver-code keys below are PostgreSQL/node identifiers, not code style.
import type {
  IDataDbRuntimeErrorClassification,
  IDataDbRuntimeErrorCode,
} from '../../global/data-db-runtime-error';

/**
 * Bounded database error taxonomy. This list is a contract with the external collector:
 * the strings are metric attribute values (`teable.database.error.class`) and diagnostic
 * field values, so adding or renaming one is a breaking change for both.
 */
export const DATABASE_ERROR_CLASSES = [
  'timeout',
  'statement_timeout',
  'cancel',
  'deadlock',
  'transaction_aborted',
  'connection_failed',
  'connection_lost',
  'connection_timeout',
  'pool_exhausted',
  'auth_failed',
  'database_missing',
  'schema_missing',
  'object_missing',
  'permission_denied',
  'unique_violation',
  'foreign_key_violation',
  'not_null_violation',
  'data_validation',
  'syntax_error',
  'serialization_failure',
  'other',
  'unclassified',
] as const;

export type DatabaseErrorClass = (typeof DATABASE_ERROR_CLASSES)[number];

export interface IDatabaseErrorClassification {
  errorClass: DatabaseErrorClass;
  pgCode?: string;
  driverCode?: string;
  /** True when retrying the same operation may succeed without a code or data change. */
  retryable: boolean;
  /** Raw BYODB (`data_db.*`) code when the CLS data-db context produced the result. */
  dataDbCode?: IDataDbRuntimeErrorCode;
}

/** Retrying helps for infrastructure and concurrency failures, not for bad SQL or data. */
const RETRYABLE_CLASSES: Record<DatabaseErrorClass, boolean> = {
  timeout: true,
  statement_timeout: false,
  cancel: false,
  deadlock: true,
  transaction_aborted: true,
  connection_failed: true,
  connection_lost: true,
  connection_timeout: true,
  pool_exhausted: true,
  auth_failed: false,
  database_missing: false,
  schema_missing: false,
  object_missing: false,
  permission_denied: false,
  unique_violation: false,
  foreign_key_violation: false,
  not_null_violation: false,
  data_validation: false,
  syntax_error: false,
  serialization_failure: true,
  other: false,
  unclassified: false,
};

/** PostgreSQL SQLSTATE class 03 + the node driver codes Prisma/pg surface for the same failure. */
const CLASS_BY_SQLSTATE: Record<string, DatabaseErrorClass> = {
  '08000': 'connection_lost',
  '08001': 'connection_lost',
  '08003': 'connection_lost',
  '08004': 'connection_lost',
  '08006': 'connection_lost',
  '08007': 'connection_lost',
  '57P01': 'connection_lost',
  '57P02': 'connection_lost',
  '57P03': 'connection_lost',
  // 57014 is `query_canceled`: a user cancel unless the message says statement timeout.
  '57014': 'cancel',
  '55P03': 'deadlock',
  // Deadlock wins over serialization failure for 40P01 (both are retryable).
  '40P01': 'deadlock',
  '25P02': 'transaction_aborted',
  '53300': 'pool_exhausted',
  '53400': 'pool_exhausted',
  '28P01': 'auth_failed',
  '28000': 'auth_failed',
  '3D000': 'database_missing',
  '3F000': 'schema_missing',
  '42P01': 'object_missing',
  '42501': 'permission_denied',
  '23505': 'unique_violation',
  '23503': 'foreign_key_violation',
  '23502': 'not_null_violation',
  '22007': 'data_validation',
  '22008': 'data_validation',
  '42601': 'syntax_error',
  '40001': 'serialization_failure',
};

const CLASS_BY_DRIVER_CODE: Record<string, DatabaseErrorClass> = {
  ECONNREFUSED: 'connection_failed',
  ECONNRESET: 'connection_lost',
  EPIPE: 'connection_lost',
  ETIMEDOUT: 'connection_timeout',
  ENOTFOUND: 'connection_failed',
  EAI_AGAIN: 'connection_failed',
  ENETUNREACH: 'connection_failed',
  EHOSTUNREACH: 'connection_failed',
};

/**
 * Order matters: the first match wins. `statement timeout` is checked before `cancel`
 * because pg reports both through 57014, and `relation ... does not exist` before
 * `schema ... does not exist` because a relation name can contain "schema".
 */
const CLASS_BY_MESSAGE: ReadonlyArray<readonly [RegExp, DatabaseErrorClass]> = [
  [/timeout exceeded when trying to connect/i, 'connection_timeout'],
  [/connection terminated due to connection timeout/i, 'connection_timeout'],
  [/connection terminated unexpectedly/i, 'connection_lost'],
  [/statement timeout|canceling statement due to statement timeout/i, 'statement_timeout'],
  [/canceling statement due to user request/i, 'cancel'],
  [/deadlock detected/i, 'deadlock'],
  [/current transaction is aborted/i, 'transaction_aborted'],
  [/too many clients|sorry, too many clients already/i, 'pool_exhausted'],
  [/database ".+" does not exist/i, 'database_missing'],
  [/relation ".+" does not exist|column ".+" does not exist/i, 'object_missing'],
  [/schema ".+" does not exist/i, 'schema_missing'],
  [/permission denied/i, 'permission_denied'],
  [/duplicate key value violates unique constraint/i, 'unique_violation'],
  [/violates foreign key constraint/i, 'foreign_key_violation'],
  [/null value in column/i, 'not_null_violation'],
  [/invalid input syntax|out of range|invalid text representation/i, 'data_validation'],
  [/syntax error/i, 'syntax_error'],
  [/could not serialize access/i, 'serialization_failure'],
];

/** BYODB taxonomy (`classifyDataDbRuntimeError`) mapped onto the bounded enum. */
const CLASS_BY_DATA_DB_CODE: Record<IDataDbRuntimeErrorCode, DatabaseErrorClass> = {
  'data_db.timeout': 'timeout',
  'data_db.connection_refused': 'connection_failed',
  'data_db.network_unreachable': 'connection_failed',
  'data_db.connection_lost': 'connection_lost',
  'data_db.auth_failed': 'auth_failed',
  'data_db.database_missing': 'database_missing',
  'data_db.tenant_missing': 'database_missing',
  'data_db.schema_missing': 'schema_missing',
  'data_db.relation_missing': 'object_missing',
  'data_db.permission_denied': 'permission_denied',
  'data_db.pool_exhausted': 'pool_exhausted',
};

/**
 * Node error codes and pg error codes share one `code` field. `P1001` (Prisma) also
 * matches the SQLSTATE shape but is not one, so it is reported as a driver code.
 */
const isPostgresSqlState = (code: string): boolean => /^[0-9A-Z]{5}$/.test(code);
const isPrismaDriverCode = (code: string): boolean => /^P\d{4}$/.test(code);

const readErrorCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const candidate =
    'code' in error && typeof error.code === 'string'
      ? error.code
      : 'errorCode' in error && typeof error.errorCode === 'string'
        ? error.errorCode
        : undefined;
  return candidate?.trim() || undefined;
};

const readErrorText = (error: unknown): string | undefined => {
  if (error === null || error === undefined) {
    return undefined;
  }
  if (typeof error === 'string') {
    return error.trim() || undefined;
  }
  if (error instanceof Error) {
    return error.message.trim() || undefined;
  }
  if (typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message.trim() || undefined;
  }
  return String(error).trim() || undefined;
};

const readCodes = (code: string | undefined): { pgCode?: string; driverCode?: string } => {
  if (!code) {
    return {};
  }
  // A node driver code wins over the SQLSTATE shape: `EPIPE` would otherwise be read as a
  // five-character SQLSTATE. Prisma's `P1001` matches the shape too but is not SQLSTATE.
  if (CLASS_BY_DRIVER_CODE[code] || isPrismaDriverCode(code)) {
    return { driverCode: code };
  }
  return isPostgresSqlState(code) ? { pgCode: code } : { driverCode: code };
};

const classifySqlState = (
  pgCode: string,
  message: string | undefined
): DatabaseErrorClass | undefined => {
  // 57014 is `query_canceled`, reported for both a user cancel and a statement timeout.
  if (pgCode === '57014' && message && /statement timeout/i.test(message)) {
    return 'statement_timeout';
  }
  const known = CLASS_BY_SQLSTATE[pgCode];
  if (known) {
    return known;
  }
  // Unlisted SQLSTATEs still carry a class: 22xxx = data exception, 42xxx = syntax/access.
  if (pgCode.startsWith('22')) {
    return 'data_validation';
  }
  return pgCode.startsWith('42') ? 'syntax_error' : undefined;
};

const classifyMessage = (message: string | undefined): DatabaseErrorClass | undefined => {
  if (!message) {
    return undefined;
  }
  for (const [pattern, errorClass] of CLASS_BY_MESSAGE) {
    if (pattern.test(message)) {
      return errorClass;
    }
  }
  return undefined;
};

const fromDataDbClassification = (
  byodbs: IDataDbRuntimeErrorClassification,
  pgCode: string | undefined,
  driverCode: string | undefined
): IDatabaseErrorClassification => {
  // The BYODB classifier already knows the pinned-pooler failure modes (tenant gone,
  // project deleted); its verdict and retryability win over the generic chain.
  const dataDbPgCode = byodbs.pgCode ?? pgCode;
  const dataDbDriverCode = byodbs.driverCode ?? driverCode;
  return {
    errorClass: CLASS_BY_DATA_DB_CODE[byodbs.code],
    retryable: byodbs.retryable,
    dataDbCode: byodbs.code,
    ...(dataDbPgCode ? { pgCode: dataDbPgCode } : {}),
    ...(dataDbDriverCode ? { driverCode: dataDbDriverCode } : {}),
  };
};

export const classifyDatabaseError = (
  error: unknown,
  options: { dataDbClassification?: IDataDbRuntimeErrorClassification | null } = {}
): IDatabaseErrorClassification => {
  const code = readErrorCode(error);
  const message = readErrorText(error);
  const { pgCode, driverCode } = readCodes(code);

  const byodbs = options.dataDbClassification;
  if (byodbs) {
    return fromDataDbClassification(byodbs, pgCode, driverCode);
  }

  const errorClass =
    (pgCode ? classifySqlState(pgCode, message) : undefined) ??
    (driverCode ? CLASS_BY_DRIVER_CODE[driverCode] : undefined) ??
    classifyMessage(message) ??
    (message || code ? 'other' : 'unclassified');

  return {
    errorClass,
    retryable: RETRYABLE_CLASSES[errorClass],
    ...(pgCode ? { pgCode } : {}),
    ...(driverCode ? { driverCode } : {}),
  };
};

/**
 * Picks the SQLSTATE embedded in pg's sanitized exception message
 * (`PostgreSQL error of type 'X' occurred (code: 57014)`), which instrumentation-pg
 * records on spans instead of the raw error. `UNKNOWN` means the driver had no code.
 */
export const extractSpanErrorCode = (message: string | undefined): string | undefined => {
  const matched = message?.match(/\(code: ([0-9A-Z]{5})\)/)?.[1];
  return matched && matched !== 'UNKNOWN' ? matched : undefined;
};
