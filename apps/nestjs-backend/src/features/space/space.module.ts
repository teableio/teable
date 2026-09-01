import { Module } from '@nestjs/common';
import { StorageModule } from '../attachments/plugins/storage.module';
import { PermissionModule } from '../auth/permission.module';
import { BaseModule } from '../base/base.module';
import { CollaboratorModule } from '../collaborator/collaborator.module';
import { InvitationModule } from '../invitation/invitation.module';
import { SettingOpenApiModule } from '../setting/open-api/setting-open-api.module';
import { SettingModule } from '../setting/setting.module';
import { LastVisitModule } from '../user/last-visit/last-visit.module';
import { DataDbBindingService } from './data-db-binding.service';
import { SpaceDataDbMigrationGuardModule } from './space-data-db-migration-guard.module';
import { SpaceDataDbMigrationModule } from './space-data-db-migration.module';
import { SpaceController } from './space.controller';
import { SpaceService } from './space.service';
import { TemplateSpaceInitService } from './template-space-init/template-space.init.service';

@Module({
  controllers: [SpaceController],
  providers: [SpaceService, TemplateSpaceInitService, DataDbBindingService],
  exports: [
    SpaceService,
    TemplateSpaceInitService,
    DataDbBindingService,
    SpaceDataDbMigrationModule,
    SpaceDataDbMigrationGuardModule,
  ],
  imports: [
    LastVisitModule,
    StorageModule,
    SettingModule,
    SettingOpenApiModule,
    CollaboratorModule,
    InvitationModule,
    BaseModule,
    PermissionModule,
    SpaceDataDbMigrationGuardModule,
    SpaceDataDbMigrationModule,
  ],
})
export class SpaceModule {}
