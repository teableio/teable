import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../../attachments/attachments.module';
import { FieldReferenceAdmissionModule } from '../../field-reference-admission/field-reference-admission.module';
import { SpaceDataDbMigrationGuardModule } from '../../space/space-data-db-migration-guard.module';
import { V2Module } from '../../v2/v2.module';
import { RecordOpenApiV2Service } from './record-open-api-v2.service';

@Module({
  imports: [
    AttachmentsModule,
    FieldReferenceAdmissionModule,
    SpaceDataDbMigrationGuardModule,
    V2Module,
  ],
  providers: [RecordOpenApiV2Service],
  exports: [RecordOpenApiV2Service],
})
export class RecordOpenApiV2Module {}
