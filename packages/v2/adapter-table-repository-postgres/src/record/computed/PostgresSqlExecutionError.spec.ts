import { PostgresSqlExecutionError } from '@teable/v2-adapter-db-postgres-shared';
import { describe, expect, it } from 'vitest';

describe('PostgresSqlExecutionError', () => {
  it('captures redacted SQL diagnostics without parameter values', () => {
    const cause = Object.assign(new Error('CASE types integer and jsonb cannot be matched'), {
      code: '42804',
      severity: 'ERROR',
      position: '42',
      routine: 'select_common_type',
      detail: 'sensitive detail must not be copied',
    });
    const error = new PostgresSqlExecutionError(
      cause,
      {
        sql: `update "base"."table" set "value" = CASE WHEN "id" = $1 THEN 123 ELSE 'secret' END`,
        parameters: ['sensitive-parameter'],
      },
      {
        source: 'computed_update',
        tableId: 'tbl123',
        fieldIds: ['fld123'],
        stepLevel: 2,
      }
    );

    expect(error.message).toContain('CASE types integer and jsonb');
    expect(error.diagnostics.postgres).toEqual({
      sqlState: '42804',
      severity: 'ERROR',
      position: 42,
      routine: 'select_common_type',
      schema: undefined,
      table: undefined,
      column: undefined,
      dataType: undefined,
      constraint: undefined,
    });
    expect(error.diagnostics.statement).toEqual(
      expect.objectContaining({
        kind: 'update',
        parameterCount: 1,
        parametersCaptured: false,
      })
    );
    expect(error.diagnostics.statement.normalizedSql).toContain("'<literal>'");
    expect(error.diagnostics.statement.normalizedSql).toContain('<number>');
    expect(JSON.stringify(error.diagnostics)).not.toContain('sensitive-parameter');
    expect(JSON.stringify(error.diagnostics)).not.toContain('sensitive detail');
  });
});
