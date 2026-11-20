import { Module } from '@nestjs/common';
import { RawOpStagingModule } from '../../share-db/raw-op-staging.module';
import { FieldReferenceAdmissionModule } from '../field-reference-admission/field-reference-admission.module';
import { FieldCacheModule } from '../field-cache/field-cache.module';
import { RecordHistoryColdCoreModule } from '../record-history-cold/record-history-cold.module';
import { SettingModule } from '../setting/setting.module';
import { TableIndexModule } from '../table-index/table-index.module';
import { TableMutationCacheModule } from '../table/open-api/table-mutation-cache.module';
import { V2Module } from '../v2/v2.module';
import { CrossSpaceLinkCleanupService } from './cross-space-link-cleanup.service';
import { PairConversionRecoveryModule } from './pair-conversion-recovery.module';
import { TableLifecycleCleanupService } from './table-lifecycle-cleanup.service';
import { TrustedRetentionContextService } from './trusted-retention-context.service';

@Module({
  imports: [
    RawOpStagingModule,
    FieldReferenceAdmissionModule,
    FieldCacheModule,
    PairConversionRecoveryModule,
    TableIndexModule,
    RecordHistoryColdCoreModule,
    SettingModule,
    TableMutationCacheModule,
    V2Module,
  ],
  providers: [
    TableLifecycleCleanupService,
    CrossSpaceLinkCleanupService,
    TrustedRetentionContextService,
  ],
  exports: [
    TableLifecycleCleanupService,
    CrossSpaceLinkCleanupService,
    TrustedRetentionContextService,
  ],
})
export class TableLifecycleModule {}
