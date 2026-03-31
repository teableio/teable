import { describe, expect, it } from 'vitest';

import * as packageExports from './index';
import { registerV2TableRepositoryPostgresAdapter } from './di/register';
import { referenceError } from './meta';
import { PostgresTableRecordRepository } from './record';
import { v2PostgresDdlAdapterConfigSchema } from './schema/config';
import { hasPgInputIsValid } from './utils';

describe('package exports', () => {
  it('re-exports the main API surface from the package root', () => {
    expect(packageExports.registerV2TableRepositoryPostgresAdapter).toBe(
      registerV2TableRepositoryPostgresAdapter
    );
    expect(packageExports.v2PostgresDdlAdapterConfigSchema).toBe(v2PostgresDdlAdapterConfigSchema);
    expect(packageExports.hasPgInputIsValid).toBe(hasPgInputIsValid);
    expect(packageExports.referenceError).toBe(referenceError);
    expect(packageExports.PostgresTableRecordRepository).toBe(PostgresTableRecordRepository);
    expect(packageExports.convertNameToValidCharacter('123 field')).toBe('t123_field');
  });
});
