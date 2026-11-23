import { Module } from '@nestjs/common';
import { ShareDbModule } from '../../../share-db/share-db.module';
import { FieldOpenApiV2Module } from '../../field/open-api/field-open-api-v2.module';
import { RawOpStagingModule } from '../../../share-db/raw-op-staging.module';
import { SpaceDataDbMigrationGuardModule } from '../../space/space-data-db-migration-guard.module';
import { TableLifecycleModule } from '../../table-lifecycle/table-lifecycle.module';
import { V2Module } from '../../v2/v2.module';
import { TableDuplicatePolicyService } from '../table-duplicate-policy.service';
import { TableSnapshotReadModule } from '../table-snapshot-read.module';
import { TableMetadataOrderService } from './table-metadata-order.service';
import { TableOpenApiV2Service } from './table-open-api-v2.service';

@Module({
  imports: [
    FieldOpenApiV2Module,
    ShareDbModule,
    RawOpStagingModule,
    SpaceDataDbMigrationGuardModule,
    TableLifecycleModule,
    TableSnapshotReadModule,
    V2Module,
  ],
  providers: [TableOpenApiV2Service, TableDuplicatePolicyService, TableMetadataOrderService],
  exports: [
    TableOpenApiV2Service,
    TableDuplicatePolicyService,
    TableMetadataOrderService,
    FieldOpenApiV2Module,
  ],
})
export class TableOpenApiV2Module {}
