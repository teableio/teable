import { Module } from '@nestjs/common';
import { EventJobModule } from '../../event-emitter/event-job/event-job.module';
import { StorageModule } from '../attachments/plugins/storage.module';
import { PermissionModule } from '../auth/permission.module';
import { BASE_IMPORT_CSV_QUEUE } from '../base/base-import-processor/base-import-csv.processor';
import { BASE_IMPORT_JUNCTION_CSV_QUEUE } from '../base/base-import-processor/base-import-junction.processor';
import { BaseModule } from '../base/base.module';
import { CollaboratorModule } from '../collaborator/collaborator.module';
import { TABLE_IMPORT_CSV_CHUNK_QUEUE } from '../import/open-api/import-csv-chunk.processor';
import { TABLE_IMPORT_CSV_QUEUE } from '../import/open-api/import-csv.processor';
import { InvitationModule } from '../invitation/invitation.module';
import { SettingOpenApiModule } from '../setting/open-api/setting-open-api.module';
import { SettingModule } from '../setting/setting.module';
import { DataDbBaselineService } from './data-db-baseline.service';
import { DataDbBindingService } from './data-db-binding.service';
import { DataDbPreflightService } from './data-db-preflight.service';
import { SpaceDataDbCopyService } from './space-data-db-copy.service';
import { SpaceDataDbMigrationGuardModule } from './space-data-db-migration-guard.module';
import { SpaceDataDbMigrationWorkerService } from './space-data-db-migration-worker.service';
import { SpaceDataDbMigrationService } from './space-data-db-migration.service';
import { SpaceDataDbProcessRunnerService } from './space-data-db-process-runner.service';
import { SpaceController } from './space.controller';
import { SpaceService } from './space.service';
import { TemplateSpaceInitService } from './template-space-init/template-space.init.service';

@Module({
  controllers: [SpaceController],
  providers: [
    SpaceService,
    TemplateSpaceInitService,
    DataDbPreflightService,
    DataDbBaselineService,
    DataDbBindingService,
    SpaceDataDbCopyService,
    SpaceDataDbMigrationService,
    SpaceDataDbMigrationWorkerService,
    SpaceDataDbProcessRunnerService,
  ],
  exports: [
    SpaceService,
    TemplateSpaceInitService,
    DataDbPreflightService,
    DataDbBaselineService,
    DataDbBindingService,
    SpaceDataDbCopyService,
    SpaceDataDbMigrationService,
    SpaceDataDbMigrationWorkerService,
    SpaceDataDbMigrationGuardModule,
    SpaceDataDbProcessRunnerService,
  ],
  imports: [
    StorageModule,
    SettingModule,
    SettingOpenApiModule,
    CollaboratorModule,
    InvitationModule,
    BaseModule,
    PermissionModule,
    SpaceDataDbMigrationGuardModule,
    EventJobModule.registerQueue(BASE_IMPORT_CSV_QUEUE),
    EventJobModule.registerQueue(BASE_IMPORT_JUNCTION_CSV_QUEUE),
    EventJobModule.registerQueue(TABLE_IMPORT_CSV_CHUNK_QUEUE),
    EventJobModule.registerQueue(TABLE_IMPORT_CSV_QUEUE),
  ],
})
export class SpaceModule {}
