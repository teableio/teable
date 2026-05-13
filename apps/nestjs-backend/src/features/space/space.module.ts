import { Module } from '@nestjs/common';
import { PermissionModule } from '../auth/permission.module';
import { BaseModule } from '../base/base.module';
import { CollaboratorModule } from '../collaborator/collaborator.module';
import { InvitationModule } from '../invitation/invitation.module';
import { SettingOpenApiModule } from '../setting/open-api/setting-open-api.module';
import { SettingModule } from '../setting/setting.module';
import { DataDbBaselineService } from './data-db-baseline.service';
import { DataDbBindingService } from './data-db-binding.service';
import { DataDbPreflightService } from './data-db-preflight.service';
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
  ],
  exports: [
    SpaceService,
    TemplateSpaceInitService,
    DataDbPreflightService,
    DataDbBaselineService,
    DataDbBindingService,
  ],
  imports: [
    SettingModule,
    SettingOpenApiModule,
    CollaboratorModule,
    InvitationModule,
    BaseModule,
    PermissionModule,
  ],
})
export class SpaceModule {}
