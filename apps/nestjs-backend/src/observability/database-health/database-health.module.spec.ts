import { Test } from '@nestjs/testing';
import { getPgPoolObserver, installPgPoolObserver } from '@teable/db-main-prisma';
import { afterEach, describe, expect, it } from 'vitest';
import {
  databaseHealthDiagnostics,
  DatabaseHealthDiagnostics,
} from './database-health.diagnostics';
import { databaseHealthMetrics, DatabaseHealthMetricsService } from './database-health.metrics';
import { DatabaseHealthModule } from './database-health.module';

describe('DatabaseHealthModule', () => {
  afterEach(() => installPgPoolObserver(undefined));

  it('shares one instrument set and installs the pool observer without CLS present', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseHealthModule],
    }).compile();
    await moduleRef.init();

    // The span processor registered in tracing.ts holds these very instances: a second set
    // would register duplicate instruments and double count.
    expect(moduleRef.get(DatabaseHealthMetricsService)).toBe(databaseHealthMetrics);
    expect(moduleRef.get(DatabaseHealthDiagnostics)).toBe(databaseHealthDiagnostics);
    expect(getPgPoolObserver()).toBe(databaseHealthMetrics);
    // No ClsModule in this test: the optional injection must degrade to "no correlation".
    expect(databaseHealthDiagnostics.readDataDbContext()).toBeUndefined();

    await moduleRef.close();
  });
});
