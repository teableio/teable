import { Module } from '@nestjs/common';
import { installPgPoolObserver } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import {
  databaseHealthDiagnostics,
  DatabaseHealthDiagnostics,
} from './database-health.diagnostics';
import { databaseHealthMetrics, DatabaseHealthMetricsService } from './database-health.metrics';

/**
 * Registers the process-wide database-health instrumentation with DI.
 *
 * The providers hand out the same instances `tracing.ts` registered as the span processor,
 * so the pool observer, the span processor and the diagnostic emitter all write into one set
 * of instruments (a second instance would register duplicate instruments and double count).
 *
 * The pool observer is installed here rather than injected: `PrismaModule` declares
 * `PgPoolRegistry`, so Nest resolves `PG_POOL_OBSERVER` in that module's scope and the app
 * cannot override it without re-providing `PgPoolRegistry` (which would duplicate physical
 * pools). `installPgPoolObserver` is the app-side half of that DI seam.
 */
@Module({
  providers: [
    {
      provide: DatabaseHealthMetricsService,
      useFactory: () => {
        installPgPoolObserver(databaseHealthMetrics);
        return databaseHealthMetrics;
      },
    },
    {
      provide: DatabaseHealthDiagnostics,
      useFactory: (cls: ClsService<IClsStore> | undefined) => {
        databaseHealthDiagnostics.bindClsService(cls);
        return databaseHealthDiagnostics;
      },
      // Optional: the emitter works without CLS, it just reports no correlation ids.
      inject: [{ token: ClsService, optional: true }],
    },
  ],
})
export class DatabaseHealthModule {}
