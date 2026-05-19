export type IDataDbRuntimeErrorCode =
  | 'data_db.database_missing'
  | 'data_db.auth_failed'
  | 'data_db.connection_refused'
  | 'data_db.timeout'
  | 'data_db.network_unreachable'
  | 'data_db.connection_lost'
  | 'data_db.schema_missing'
  | 'data_db.relation_missing'
  | 'data_db.permission_denied'
  | 'data_db.pool_exhausted';

export type IDataDbRuntimeErrorClassification = {
  code: IDataDbRuntimeErrorCode;
  message: string;
  retryable: boolean;
  userActionable: boolean;
  pgCode?: string;
  driverCode?: string;
};

const getErrorCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const candidate = error as { code?: unknown; errorCode?: unknown };
  return typeof candidate.code === 'string'
    ? candidate.code
    : typeof candidate.errorCode === 'string'
      ? candidate.errorCode
      : undefined;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const buildClassification = (
  error: unknown,
  code: IDataDbRuntimeErrorCode,
  message: string,
  options: Pick<IDataDbRuntimeErrorClassification, 'retryable' | 'userActionable'>
): IDataDbRuntimeErrorClassification => {
  const driverCode = getErrorCode(error);
  const isPgCode = driverCode
    ? /^[0-9A-Z]{5}$/.test(driverCode) && !/^P\d{4}$/.test(driverCode)
    : false;
  return {
    code,
    message,
    ...options,
    ...(driverCode ? { driverCode } : {}),
    ...(isPgCode ? { pgCode: driverCode } : {}),
  };
};

export const classifyDataDbRuntimeError = (
  error: unknown
): IDataDbRuntimeErrorClassification | null => {
  const driverCode = getErrorCode(error);
  const message = getErrorMessage(error);

  switch (driverCode) {
    case '3D000':
    case 'P1003':
      return buildClassification(
        error,
        'data_db.database_missing',
        'The bound data database no longer exists or cannot be selected.',
        { retryable: false, userActionable: true }
      );
    case '28P01':
    case 'P1000':
      return buildClassification(
        error,
        'data_db.auth_failed',
        'The bound data database rejected the configured credentials.',
        { retryable: false, userActionable: true }
      );
    case 'ECONNREFUSED':
      return buildClassification(
        error,
        'data_db.connection_refused',
        'The bound data database refused the connection.',
        { retryable: true, userActionable: true }
      );
    case 'ETIMEDOUT':
    case 'P1008':
    case '57014':
      return buildClassification(error, 'data_db.timeout', 'The bound data database timed out.', {
        retryable: true,
        userActionable: true,
      });
    case 'ENOTFOUND':
    case 'ENETUNREACH':
    case 'EHOSTUNREACH':
    case 'EAI_AGAIN':
    case 'P1001':
      return buildClassification(
        error,
        'data_db.network_unreachable',
        'The bound data database host is not reachable.',
        { retryable: true, userActionable: true }
      );
    case 'ECONNRESET':
    case '08000':
    case '08001':
    case '08003':
    case '08004':
    case '08006':
    case '08007':
    case '57P01':
    case 'P1017':
      return buildClassification(
        error,
        'data_db.connection_lost',
        'The bound data database connection was interrupted.',
        { retryable: true, userActionable: true }
      );
    case '3F000':
      return buildClassification(
        error,
        'data_db.schema_missing',
        'The bound data database internal schema is missing.',
        { retryable: false, userActionable: true }
      );
    case '42P01':
    case 'P2021':
      return buildClassification(
        error,
        'data_db.relation_missing',
        'A required table or relation is missing from the bound data database.',
        { retryable: false, userActionable: true }
      );
    case '42501':
      return buildClassification(
        error,
        'data_db.permission_denied',
        'The bound data database user does not have the required permissions.',
        { retryable: false, userActionable: true }
      );
    case '53300':
    case '53400':
    case 'P2024':
      return buildClassification(
        error,
        'data_db.pool_exhausted',
        'The bound data database does not have enough available connections.',
        { retryable: true, userActionable: true }
      );
    default:
      break;
  }

  if (/database ".+" does not exist/i.test(message)) {
    return buildClassification(
      error,
      'data_db.database_missing',
      'The bound data database no longer exists or cannot be selected.',
      { retryable: false, userActionable: true }
    );
  }
  if (/password authentication failed/i.test(message)) {
    return buildClassification(
      error,
      'data_db.auth_failed',
      'The bound data database rejected the configured credentials.',
      { retryable: false, userActionable: true }
    );
  }
  if (/relation ".+" does not exist/i.test(message)) {
    return buildClassification(
      error,
      'data_db.relation_missing',
      'A required table or relation is missing from the bound data database.',
      { retryable: false, userActionable: true }
    );
  }
  if (/permission denied/i.test(message)) {
    return buildClassification(
      error,
      'data_db.permission_denied',
      'The bound data database user does not have the required permissions.',
      { retryable: false, userActionable: true }
    );
  }
  if (/Unable to start a transaction|Timed out fetching a new connection/i.test(message)) {
    return buildClassification(
      error,
      'data_db.pool_exhausted',
      'The bound data database does not have enough available connections.',
      { retryable: true, userActionable: true }
    );
  }
  if (/Can't reach database server|connect ETIMEDOUT|connection timed out/i.test(message)) {
    return buildClassification(error, 'data_db.timeout', 'The bound data database timed out.', {
      retryable: true,
      userActionable: true,
    });
  }

  return null;
};
