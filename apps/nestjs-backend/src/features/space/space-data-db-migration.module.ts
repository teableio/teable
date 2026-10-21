import { Module } from '@nestjs/common';
import { EventJobModule } from '../../event-emitter/event-job/event-job.module';
import { BASE_IMPORT_CSV_QUEUE } from '../base/base-import-processor/base-import-csv.processor';
import { BASE_IMPORT_JUNCTION_CSV_QUEUE } from '../base/base-import-processor/base-import-junction.processor';
import { TABLE_IMPORT_CSV_CHUNK_QUEUE } from '../import/open-api/import-csv-chunk.processor';
import { TABLE_IMPORT_CSV_QUEUE } from '../import/open-api/import-csv.processor';
import { DataDbBaselineService } from './data-db-baseline.service';
import { DataDbPreflightService } from './data-db-preflight.service';
import { SpaceDataDbCopyModule } from './space-data-db-copy.module';
import { SpaceDataDbMigrationWorkerService } from './space-data-db-migration-worker.service';
import { SpaceDataDbMigrationService } from './space-data-db-migration.service';

/**
 * Slim BYODB space data DB migration surface.
 *
 * Intentionally excludes Space/Base API modules and queue processors. Queue
 * registrations below are producer/inspector-only so
 * SpaceDataDbMigrationService can drain import jobs during cutover — they must
 * never pull @Processor workers into auxiliary graphs.
 */
@Module({
  imports: [
    SpaceDataDbCopyModule,
    EventJobModule.registerQueue(BASE_IMPORT_CSV_QUEUE),
    EventJobModule.registerQueue(BASE_IMPORT_JUNCTION_CSV_QUEUE),
    EventJobModule.registerQueue(TABLE_IMPORT_CSV_CHUNK_QUEUE),
    EventJobModule.registerQueue(TABLE_IMPORT_CSV_QUEUE),
  ],
  providers: [
    DataDbPreflightService,
    DataDbBaselineService,
    SpaceDataDbMigrationService,
    SpaceDataDbMigrationWorkerService,
  ],
  exports: [
    SpaceDataDbCopyModule,
    DataDbPreflightService,
    DataDbBaselineService,
    SpaceDataDbMigrationService,
    SpaceDataDbMigrationWorkerService,
  ],
})
export class SpaceDataDbMigrationModule {}
