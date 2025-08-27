import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { StorageModule } from '../attachments/plugins/storage.module';
import { CollaboratorModule } from '../collaborator/collaborator.module';
import { FieldDuplicateModule } from '../field/field-duplicate/field-duplicate.module';
import { FieldModule } from '../field/field.module';
import { FieldOpenApiModule } from '../field/open-api/field-open-api.module';
import { GraphModule } from '../graph/graph.module';
import { InvitationModule } from '../invitation/invitation.module';
import { NotificationModule } from '../notification/notification.module';
import { RecordModule } from '../record/record.module';
import { TableOpenApiModule } from '../table/open-api/table-open-api.module';
import { TableDuplicateService } from '../table/table-duplicate.service';
import { TableModule } from '../table/table.module';
import { ViewOpenApiModule } from '../view/open-api/view-open-api.module';
import { BaseDuplicateService } from './base-duplicate.service';
import { BaseExportService } from './base-export.service';
import { BaseImportAttachmentsCsvModule } from './base-import-processor/base-import-attachments-csv.module';
import { BaseImportAttachmentsModule } from './base-import-processor/base-import-attachments.module';
import { BaseImportCsvModule } from './base-import-processor/base-import-csv.module';
import { BaseImportService } from './base-import.service';
import { BaseQueryService } from './base-query/base-query.service';
import { BaseController } from './base.controller';
import { BaseService } from './base.service';
import { DbConnectionService } from './db-connection.service';

@Module({
  controllers: [BaseController],
  imports: [
    CollaboratorModule,
    FieldModule,
    FieldOpenApiModule,
    FieldDuplicateModule,
    TableModule,
    ViewOpenApiModule,
    InvitationModule,
    TableOpenApiModule,
    RecordModule,
    StorageModule,
    NotificationModule,
    BaseImportAttachmentsModule,
    BaseImportCsvModule,
    BaseImportAttachmentsCsvModule,
    GraphModule,
  ],
  providers: [
    DbProvider,
    BaseService,
    BaseExportService,
    BaseImportService,
    DbConnectionService,
    BaseDuplicateService,
    BaseQueryService,
    TableDuplicateService,
  ],
  exports: [
    BaseService,
    DbConnectionService,
    BaseDuplicateService,
    BaseExportService,
    BaseImportService,
    BaseQueryService,
  ],
})
export class BaseModule {}
