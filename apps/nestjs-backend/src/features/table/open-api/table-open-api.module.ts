import { Module } from '@nestjs/common';
import { DbProvider } from '../../../db-provider/db.provider';
import { ShareDbModule } from '../../../share-db/share-db.module';
import { CalculationModule } from '../../calculation/calculation.module';
import { CanaryModule } from '../../canary/canary.module';
import { FieldCalculateModule } from '../../field/field-calculate/field-calculate.module';
import { FieldDuplicateModule } from '../../field/field-duplicate/field-duplicate.module';
import { FieldOpenApiModule } from '../../field/open-api/field-open-api.module';
import { GraphLegacyModule } from '../../graph/graph-legacy.module';
import { RecordOpenApiModule } from '../../record/open-api/record-open-api.module';
import { RecordModule } from '../../record/record.module';
import { RecordHistoryColdCoreModule } from '../../record-history-cold/record-history-cold.module';
import { V2Module } from '../../v2/v2.module';
import { ViewOpenApiModule } from '../../view/open-api/view-open-api.module';
import { ViewModule } from '../../view/view.module';
import { TableDuplicateService } from '../table-duplicate.service';
import { TableIndexModule } from '../../table-index/table-index.module';
import { TableLifecycleModule } from '../../table-lifecycle/table-lifecycle.module';
import { TableMoveModule } from '../table-move.module';
import { TableModule } from '../table.module';
import { TableDuplicatePreviewRegistrar } from './table-duplicate-preview-registrar.service';
import { TableMutationCacheModule } from './table-mutation-cache.module';
import { TableOpenApiV2Module } from './table-open-api-v2.module';
import { TableController } from './table-open-api.controller';
import { TableOpenApiService } from './table-open-api.service';

@Module({
  imports: [
    FieldCalculateModule,
    RecordModule,
    RecordOpenApiModule,
    ViewOpenApiModule,
    FieldOpenApiModule,
    FieldDuplicateModule,
    TableModule,
    TableIndexModule,
    TableLifecycleModule,
    TableMoveModule,
    TableMutationCacheModule,
    TableOpenApiV2Module,
    RecordHistoryColdCoreModule,
    ShareDbModule,
    CalculationModule,
    GraphLegacyModule,
    V2Module,
    CanaryModule,
    ViewModule,
  ],
  controllers: [TableController],
  providers: [
    DbProvider,
    TableOpenApiService,
    TableDuplicatePreviewRegistrar,
    TableDuplicateService,
  ],
  exports: [TableOpenApiService, TableOpenApiV2Module, TableDuplicateService, TableMoveModule],
})
export class TableOpenApiModule {}
