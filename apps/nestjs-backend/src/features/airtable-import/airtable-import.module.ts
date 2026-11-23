import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { StorageModule } from '../attachments/plugins/storage.module';
import { PermissionModule } from '../auth/permission.module';
import { BaseModule } from '../base/base.module';
import { BaseNodeModule } from '../base-node/base-node.module';
import { FieldOpenApiV2Module } from '../field/open-api/field-open-api-v2.module';
import { RecordOpenApiV2Module } from '../record/open-api/record-open-api-v2.module';
import { SourceImportTaskModule } from '../source-import-task/source-import-task.module';
import { TableOpenApiV2Module } from '../table/open-api/table-open-api-v2.module';
import { ViewOpenApiV2Module } from '../view/open-api/view-open-api-v2.module';
import { AirtableImportController } from './airtable-import.controller';
import { AirtableImportService } from './airtable-import.service';

@Module({
  imports: [
    BaseModule,
    TableOpenApiV2Module,
    RecordOpenApiV2Module,
    FieldOpenApiV2Module,
    ViewOpenApiV2Module,
    AttachmentsModule,
    StorageModule,
    AiModule,
    PermissionModule,
    BaseNodeModule,
    SourceImportTaskModule,
  ],
  controllers: [AirtableImportController],
  providers: [AirtableImportService],
  exports: [AirtableImportService],
})
export class AirtableImportModule {}
