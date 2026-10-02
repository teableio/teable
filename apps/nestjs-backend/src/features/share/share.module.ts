import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { AggregationModule } from '../aggregation/aggregation.module';
import { AuthModule } from '../auth/auth.module';
import { CanaryModule } from '../canary/canary.module';
import { CollaboratorModule } from '../collaborator/collaborator.module';
import { FieldModule } from '../field/field.module';
import { FieldOpenApiModule } from '../field/open-api/field-open-api.module';
import { RecordOpenApiModule } from '../record/open-api/record-open-api.module';
import { RecordModule } from '../record/record.module';
import { SelectionModule } from '../selection/selection.module';
import { SpaceDataDbMigrationGuardModule } from '../space/space-data-db-migration-guard.module';
import { TableQuerySearchVectorRuntimeService } from '../v2/table-query-search-vector-runtime.service';
import { V2Module } from '../v2/v2.module';
import { ViewOpenApiModule } from '../view/open-api/view-open-api.module';
import { ViewModule } from '../view/view.module';
import { ShareAuthModule } from './share-auth.module';
import { ShareSocketService } from './share-socket.service';
import { ShareController } from './share.controller';
import { ShareService } from './share.service';
import { SharedViewRecordQueryV2Service } from './shared-view-record-query-v2.service';

@Module({
  imports: [
    AuthModule,
    FieldModule,
    FieldOpenApiModule,
    RecordModule,
    RecordOpenApiModule,
    SelectionModule,
    AggregationModule,
    ShareAuthModule,
    CollaboratorModule,
    ViewModule,
    ViewOpenApiModule,
    CanaryModule,
    SpaceDataDbMigrationGuardModule,
    V2Module,
  ],
  providers: [
    ShareService,
    DbProvider,
    ShareSocketService,
    SharedViewRecordQueryV2Service,
    TableQuerySearchVectorRuntimeService,
  ],
  controllers: [ShareController],
  exports: [ShareService, ShareSocketService],
})
export class ShareModule {}
