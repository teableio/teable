import { Module } from '@nestjs/common';
import { FieldReferenceAdmissionModule } from '../../field-reference-admission/field-reference-admission.module';
import { SpaceDataDbMigrationGuardModule } from '../../space/space-data-db-migration-guard.module';
import { V2Module } from '../../v2/v2.module';
import { ViewOpenApiV2Service } from './view-open-api-v2.service';

@Module({
  imports: [SpaceDataDbMigrationGuardModule, V2Module, FieldReferenceAdmissionModule],
  providers: [ViewOpenApiV2Service],
  exports: [ViewOpenApiV2Service],
})
export class ViewOpenApiV2Module {}
