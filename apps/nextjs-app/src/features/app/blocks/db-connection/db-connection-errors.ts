import { HttpErrorCode, type IHttpError } from '@teable/core';

export const readonlyRolePrivilegeUnavailableReason = 'readonly_role_privilege_unavailable';

export const getDbConnectionCreateErrorI18nKey = (error: unknown) => {
  const httpError = error as Partial<IHttpError>;
  const data = httpError.data as { reason?: unknown } | undefined;

  if (
    httpError.code === HttpErrorCode.DATABASE_CONNECTION_UNAVAILABLE &&
    data?.reason === readonlyRolePrivilegeUnavailableReason
  ) {
    return 'table:connection.readonlyUnavailable';
  }

  return 'table:connection.createFailed';
};
