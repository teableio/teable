import { HttpErrorCode } from '@teable/core';
import { describe, expect, it } from 'vitest';
import {
  getDbConnectionCreateErrorI18nKey,
  readonlyRolePrivilegeUnavailableReason,
} from './db-connection-errors';

describe('getDbConnectionCreateErrorI18nKey', () => {
  it('uses BYODB readonly capability copy for scoped role or grant privilege failures', () => {
    expect(
      getDbConnectionCreateErrorI18nKey({
        code: HttpErrorCode.DATABASE_CONNECTION_UNAVAILABLE,
        data: {
          reason: readonlyRolePrivilegeUnavailableReason,
        },
      })
    ).toBe('table:connection.readonlyUnavailable');
  });

  it('falls back to the existing create failure copy for other errors', () => {
    expect(
      getDbConnectionCreateErrorI18nKey({
        code: HttpErrorCode.RESTRICTED_RESOURCE,
      })
    ).toBe('table:connection.createFailed');
  });
});
