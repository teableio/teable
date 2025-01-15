import { Module } from '@nestjs/common';
import { DbProvider } from '../../../db-provider/db.provider';
import { CalculationModule } from '../../calculation/calculation.module';
import { CollaboratorModule } from '../../collaborator/collaborator.module';
import { RecordCalculateModule } from '../../record/record-calculate/record-calculate.module';
import { TableIndexService } from '../../table/table-index.service';
import { ViewModule } from '../../view/view.module';
import { FieldModule } from '../field.module';
import { FieldConvertingLinkService } from './field-converting-link.service';
import { FieldConvertingService } from './field-converting.service';
import { FieldCreatingService } from './field-creating.service';
import { FieldDeletingService } from './field-deleting.service';
import { FieldSupplementService } from './field-supplement.service';
import { FieldViewSyncService } from './field-view-sync.service';

@Module({
  imports: [FieldModule, CalculationModule, RecordCalculateModule, ViewModule, CollaboratorModule],
  providers: [
    DbProvider,
    FieldDeletingService,
    FieldCreatingService,
    FieldConvertingService,
    FieldSupplementService,
    FieldConvertingLinkService,
    TableIndexService,
    FieldViewSyncService,
  ],
  exports: [
    FieldDeletingService,
    FieldCreatingService,
    FieldConvertingService,
    FieldSupplementService,
    FieldViewSyncService,
    FieldConvertingLinkService,
  ],
})
export class FieldCalculateModule {}
