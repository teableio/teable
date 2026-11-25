import { Module, forwardRef } from '@nestjs/common';
import { AggregationModule } from '../../aggregation/aggregation.module';
import { AttachmentsStorageModule } from '../../attachments/attachments-storage.module';
import { AttachmentsModule } from '../../attachments/attachments.module';
import { CalculationModule } from '../../calculation/calculation.module';
import { CanaryModule } from '../../canary/canary.module';
import { CollaboratorModule } from '../../collaborator/collaborator.module';
import { FieldCalculateModule } from '../../field/field-calculate/field-calculate.module';
import { FieldModule } from '../../field/field.module';
import { FieldReferenceAdmissionModule } from '../../field-reference-admission/field-reference-admission.module';
import { RecordHistoryColdCoreModule } from '../../record-history-cold/record-history-cold.module';
import { SelectionModule } from '../../selection/selection.module';
import { SpaceDataDbMigrationGuardModule } from '../../space/space-data-db-migration-guard.module';
import { TableModule } from '../../table/table.module';
import { TableDomainQueryModule } from '../../table-domain';
import { V2Module } from '../../v2/v2.module';
import { ViewOpenApiModule } from '../../view/open-api/view-open-api.module';
import { ViewModule } from '../../view/view.module';
import { RecordModifyModule } from '../record-modify/record-modify.module';
import { RecordModule } from '../record.module';
import { ShareViewScopeService } from '../share-view-scope.service';
import { RecordHistoryReadModule } from './record-history-read.module';
import { RecordOpenApiV2Module } from './record-open-api-v2.module';
import { RecordOpenApiController } from './record-open-api.controller';
import { RecordOpenApiService } from './record-open-api.service';
import { RecordsPastePreviewRegistrar } from './record-paste-preview-registrar.service';
import {
  RecordRestoreV1CompatibilityService,
  RECORD_RESTORE_V1_CREATE_RECORDS,
} from './record-restore-v1-compatibility.service';
import { RecordRestoreModule } from './record-restore.module';
import { RecordRestoreService } from './record-restore.service';

@Module({
  imports: [
    RecordModule,
    RecordOpenApiV2Module,
    RecordHistoryReadModule,
    RecordRestoreModule,
    RecordModifyModule,
    FieldCalculateModule,
    FieldReferenceAdmissionModule,
    FieldModule,
    CalculationModule,
    AggregationModule,
    AttachmentsStorageModule,
    AttachmentsModule,
    CollaboratorModule,
    ViewModule,
    ViewOpenApiModule,
    TableModule,
    TableDomainQueryModule,
    RecordHistoryColdCoreModule,
    V2Module,
    CanaryModule,
    SpaceDataDbMigrationGuardModule,
    forwardRef(() => SelectionModule),
  ],
  controllers: [RecordOpenApiController],
  providers: [
    RecordOpenApiService,
    ShareViewScopeService,
    RecordsPastePreviewRegistrar,
    RecordRestoreService,
    RecordRestoreV1CompatibilityService,
    { provide: RECORD_RESTORE_V1_CREATE_RECORDS, useExisting: RecordOpenApiService },
  ],
  exports: [RecordOpenApiService, RecordOpenApiV2Module, RecordRestoreService, ShareViewScopeService],
})
export class RecordOpenApiModule {}
