import { Module } from '@nestjs/common';
import { DbProvider } from '../../../db-provider/db.provider';
import { ShareDbModule } from '../../../share-db/share-db.module';
import { CalculationModule } from '../../calculation/calculation.module';
import { CanaryModule } from '../../canary/canary.module';
import { FieldCalculateModule } from '../../field/field-calculate/field-calculate.module';
import { FieldDuplicateModule } from '../../field/field-duplicate/field-duplicate.module';
import { FieldOpenApiModule } from '../../field/open-api/field-open-api.module';
import { GraphModule } from '../../graph/graph.module';
import { RecordOpenApiModule } from '../../record/open-api/record-open-api.module';
import { RecordModule } from '../../record/record.module';
import { V2Module } from '../../v2/v2.module';
import { ViewOpenApiModule } from '../../view/open-api/view-open-api.module';
import { ViewModule } from '../../view/view.module';
import { TableDuplicateService } from '../table-duplicate.service';
import { TableIndexService } from '../table-index.service';
import { TableModule } from '../table.module';
import { TableMutationCacheInvalidator } from './table-mutation-cache-invalidator';
import { TableOpenApiV2Service } from './table-open-api-v2.service';
import { TableController } from './table-open-api.controller';
import { TableOpenApiService } from './table-open-api.service';
import { V2TableMutationCacheInvalidatorService } from './v2-table-mutation-cache-invalidator.service';

@Module({
  imports: [
    FieldCalculateModule,
    RecordModule,
    RecordOpenApiModule,
    ViewOpenApiModule,
    FieldOpenApiModule,
    FieldDuplicateModule,
    TableModule,
    ShareDbModule,
    CalculationModule,
    GraphModule,
    V2Module,
    CanaryModule,
    ViewModule,
  ],
  controllers: [TableController],
  providers: [
    DbProvider,
    TableOpenApiService,
    TableOpenApiV2Service,
    TableIndexService,
    TableDuplicateService,
    V2TableMutationCacheInvalidatorService,
    {
      provide: TableMutationCacheInvalidator,
      useExisting: V2TableMutationCacheInvalidatorService,
    },
  ],
  exports: [TableOpenApiService, TableOpenApiV2Service, TableDuplicateService],
})
export class TableOpenApiModule {}
