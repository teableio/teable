import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { StorageModule } from '../attachments/plugins/storage.module';
import { PermissionModule } from '../auth/permission.module';
import { BaseModule } from '../base/base.module';
import { FieldOpenApiModule } from '../field/open-api/field-open-api.module';
import { RecordOpenApiModule } from '../record/open-api/record-open-api.module';
import { TableOpenApiModule } from '../table/open-api/table-open-api.module';
import { ViewOpenApiModule } from '../view/open-api/view-open-api.module';
import { AirtableImportController } from './airtable-import.controller';
import { AirtableImportService } from './airtable-import.service';

@Module({
  imports: [
    BaseModule,
    TableOpenApiModule,
    RecordOpenApiModule,
    FieldOpenApiModule,
    ViewOpenApiModule,
    AttachmentsModule,
    StorageModule,
    AiModule,
    PermissionModule,
  ],
  controllers: [AirtableImportController],
  providers: [AirtableImportService],
  exports: [AirtableImportService],
})
export class AirtableImportModule {}
