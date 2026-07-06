import { describe, expect, it } from 'vitest';

import { createTableQuerySqlDiagnosticsCollector } from './sqlDiagnostics';

const SECRET_PARAMETER = 'customer-secret';

describe('TableQuerySqlDiagnosticsCollector', () => {
  it('records SQL fingerprints without SQL samples by default', () => {
    const collector = createTableQuerySqlDiagnosticsCollector();

    collector.record({
      source: 'record_find',
      sql: 'select * from "tbl" where "name" ilike $1',
      parameters: [SECRET_PARAMETER],
    });

    const diagnostics = collector.snapshot();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      source: 'record_find',
      statementKind: 'select',
      parameterCount: 1,
      sampled: false,
    });
    expect(diagnostics[0]?.fingerprint).toBeTruthy();
    expect(diagnostics[0]?.normalizedSql).toBeUndefined();
  });

  it('records normalized SQL samples only when enabled', () => {
    const collector = createTableQuerySqlDiagnosticsCollector({
      captureSqlSample: true,
      maxSampleLength: 80,
    });

    collector.record({
      source: 'record_count',
      sql: `
        select count(*)
        from "tbl"
        where "name" ilike $1
      `,
      parameters: [SECRET_PARAMETER],
    });

    const diagnostic = collector.snapshot()[0];
    expect(diagnostic?.sampled).toBe(true);
    expect(diagnostic?.normalizedSql).toContain('where "name" ilike $1');
    expect(diagnostic?.normalizedSql).not.toContain(SECRET_PARAMETER);
  });
});
