import { Module } from '@nestjs/common';
import { AttachmentsStorageModule } from '../../attachments/attachments-storage.module';
import { CalculationModule } from '../../calculation/calculation.module';
import { CollaboratorModule } from '../../collaborator/collaborator.module';
import { DataLoaderModule } from '../../data-loader/data-loader.module';
import { FieldCalculateModule } from '../../field/field-calculate/field-calculate.module';
import { FieldReferenceAdmissionModule } from '../../field-reference-admission/field-reference-admission.module';
import { RecordMutationPolicyModule } from '../../record-mutation-policy/record-mutation-policy.module';
import { SpaceDataDbMigrationGuardModule } from '../../space/space-data-db-migration-guard.module';
import { TableDomainQueryModule } from '../../table-domain';
import { V2Module } from '../../v2/v2.module';
import { ViewOpenApiModule } from '../../view/open-api/view-open-api.module';
import { ViewModule } from '../../view/view.module';
import { ComputedModule } from '../computed/computed.module';
import { RecordModule } from '../record.module';
import { RecordCreateService } from './record-create.service';
import { RecordDeleteService } from './record-delete.service';
import { RecordDuplicateService } from './record-duplicate.service';
import { RecordModifyService } from './record-modify.service';
import { RecordModifySharedService } from './record-modify.shared.service';
import { RecordUpdateService } from './record-update.service';

@Module({
  imports: [
    RecordModule,
    V2Module,
    CalculationModule,
    FieldCalculateModule,
    FieldReferenceAdmissionModule,
    ViewOpenApiModule,
    ViewModule,
    AttachmentsStorageModule,
    CollaboratorModule,
    DataLoaderModule,
    ComputedModule,
    TableDomainQueryModule,
    SpaceDataDbMigrationGuardModule,
    RecordMutationPolicyModule,
  ],
  providers: [
    RecordModifyService,
    RecordModifySharedService,
    RecordCreateService,
    RecordUpdateService,
    RecordDeleteService,
    RecordDuplicateService,
  ],
  exports: [RecordModifyService, RecordModifySharedService],
})
export class RecordModifyModule {}
