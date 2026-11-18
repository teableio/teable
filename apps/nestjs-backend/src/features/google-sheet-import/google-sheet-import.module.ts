import { Module } from '@nestjs/common';
import { PermissionModule } from '../auth/permission.module';
import { BaseModule } from '../base/base.module';
import { RecordOpenApiModule } from '../record/open-api/record-open-api.module';
import { SourceImportTaskModule } from '../source-import-task/source-import-task.module';
import { TableOpenApiModule } from '../table/open-api/table-open-api.module';
import { GoogleSheetImportController } from './google-sheet-import.controller';
import { GoogleSheetImportService } from './google-sheet-import.service';

@Module({
  imports: [
    BaseModule,
    TableOpenApiModule,
    RecordOpenApiModule,
    PermissionModule,
    SourceImportTaskModule,
  ],
  controllers: [GoogleSheetImportController],
  providers: [GoogleSheetImportService],
  exports: [GoogleSheetImportService],
})
export class GoogleSheetImportModule {}
