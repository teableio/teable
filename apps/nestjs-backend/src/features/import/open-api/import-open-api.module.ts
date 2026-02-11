import { Module } from '@nestjs/common';
import { ShareDbModule } from '../../../share-db/share-db.module';
import { CanaryModule } from '../../canary/canary.module';
import { FieldOpenApiModule } from '../../field/open-api/field-open-api.module';
import { NotificationModule } from '../../notification/notification.module';
import { RecordOpenApiModule } from '../../record/open-api/record-open-api.module';
import { TableOpenApiModule } from '../../table/open-api/table-open-api.module';
import { V2Module } from '../../v2/v2.module';
import { ImportMetricsModule } from '../metrics/import-metrics.module';
import { ImportCsvChunkModule } from './import-csv-chunk.module';
import { ImportOpenApiV2Service } from './import-open-api-v2.service';
import { ImportController } from './import-open-api.controller';
import { ImportOpenApiService } from './import-open-api.service';

@Module({
  imports: [
    TableOpenApiModule,
    RecordOpenApiModule,
    NotificationModule,
    ShareDbModule,
    ImportCsvChunkModule,
    FieldOpenApiModule,
    V2Module,
    CanaryModule,
    ImportMetricsModule,
  ],
  controllers: [ImportController],
  providers: [ImportOpenApiService, ImportOpenApiV2Service],
  exports: [ImportOpenApiService, ImportOpenApiV2Service],
})
export class ImportOpenApiModule {}
