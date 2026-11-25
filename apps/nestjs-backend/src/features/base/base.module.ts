import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { AttachmentsStorageModule } from '../attachments/attachments-storage.module';
import { StorageModule } from '../attachments/plugins/storage.module';
import { CanaryModule } from '../canary';
import { CollaboratorModule } from '../collaborator/collaborator.module';
import { FieldDuplicateModule } from '../field/field-duplicate/field-duplicate.module';
import { FieldModule } from '../field/field.module';
import { FieldOpenApiModule } from '../field/open-api/field-open-api.module';
import { FieldOpenApiV2Module } from '../field/open-api/field-open-api-v2.module';
import { GraphModule } from '../graph/graph.module';
import { InvitationModule } from '../invitation/invitation.module';
import { NotificationModule } from '../notification/notification.module';
import { ComputedModule } from '../record/computed/computed.module';
import { RecordModule } from '../record/record.module';
import { RecordMutationPolicyModule } from '../record-mutation-policy/record-mutation-policy.module';
import { ActorStorageRoutingService } from '../space/actor-storage-routing.service';
import { SpaceDataDbCopyModule } from '../space/space-data-db-copy.module';
import { SpaceDataDbMigrationGuardModule } from '../space/space-data-db-migration-guard.module';
import { TableOpenApiModule } from '../table/open-api/table-open-api.module';
import { TableModule } from '../table/table.module';
import { TableLifecycleModule } from '../table-lifecycle/table-lifecycle.module';
import { V2Module } from '../v2/v2.module';
import { ViewOpenApiModule } from '../view/open-api/view-open-api.module';
import { BaseDataDbMoveService } from './base-data-db-move.service';
import { BaseDuplicatePreviewRegistrar } from './base-duplicate-preview.service';
import { BaseDuplicateV2Service } from './base-duplicate-v2.service';
import { BaseDuplicateService } from './base-duplicate.service';
import { BaseExportCoordinatorModule } from './base-export-coordinator.module';
import { BaseExportV2Service } from './base-export-v2.service';
import { BaseExportStructureService } from './base-export-structure.service';
import { BaseExportService } from './base-export.service';
import { BaseImportAttachmentsCsvModule } from './base-import-processor/base-import-attachments-csv.module';
import { BaseImportAttachmentsModule } from './base-import-processor/base-import-attachments.module';
import { BaseImportCsvModule } from './base-import-processor/base-import-csv.module';
import { BaseImportComputedModule } from './base-import-computed.module';
import { BaseImportV2Service } from './base-import-v2.service';
import { BaseImportService } from './base-import.service';
import { BASE_META_MOVE_SERVICE } from './base-meta-move.service';
import { BasePersonalOrderService } from './base-personal-order.service';
import { BaseQueryModule } from './base-query/base-query.module';
import { BaseController } from './base.controller';
import { BaseService } from './base.service';

@Module({
  controllers: [BaseController],
  imports: [
    CanaryModule,
    CollaboratorModule,
    FieldModule,
    FieldOpenApiModule,
    FieldOpenApiV2Module,
    FieldDuplicateModule,
    TableModule,
    ViewOpenApiModule,
    InvitationModule,
    TableOpenApiModule,
    RecordModule,
    ComputedModule,
    StorageModule,
    AttachmentsStorageModule,
    NotificationModule,
    BaseImportAttachmentsModule,
    BaseImportComputedModule,
    BaseQueryModule,
    BaseImportCsvModule,
    BaseImportAttachmentsCsvModule,
    TableLifecycleModule,
    GraphModule,
    V2Module,
    BaseExportCoordinatorModule,
    SpaceDataDbCopyModule,
    SpaceDataDbMigrationGuardModule,
    RecordMutationPolicyModule,
  ],
  providers: [
    ActorStorageRoutingService,
    DbProvider,
    BaseService,
    BasePersonalOrderService,
    { provide: BASE_META_MOVE_SERVICE, useExisting: BaseService },
    BaseDataDbMoveService,
    BaseExportService,
    BaseExportV2Service,
    BaseExportStructureService,
    BaseImportV2Service,
    BaseImportService,
    BaseDuplicatePreviewRegistrar,
    BaseDuplicateService,
    BaseDuplicateV2Service,
  ],
  exports: [
    BaseService,
    BasePersonalOrderService,
    BaseDataDbMoveService,
    BaseDuplicatePreviewRegistrar,
    BaseDuplicateService,
    BaseDuplicateV2Service,
    BaseExportService,
    BaseExportV2Service,
    BaseExportStructureService,
    BaseImportComputedModule,
    BaseImportV2Service,
    BaseImportService,
    BaseQueryModule,
  ],
})
export class BaseModule {}
