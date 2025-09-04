import { Module } from '@nestjs/common';
import { DbProvider } from '../../../db-provider/db.provider';
import { CalculationModule } from '../../calculation/calculation.module';
import { CollaboratorModule } from '../../collaborator/collaborator.module';
import { TableIndexService } from '../../table/table-index.service';
import { TableDomainQueryModule } from '../../table-domain';
import { ViewModule } from '../../view/view.module';
import { FieldModule } from '../field.module';
import { FieldConvertingLinkService } from './field-converting-link.service';
import { FieldConvertingService } from './field-converting.service';
import { FieldCreatingService } from './field-creating.service';
import { FieldDeletingService } from './field-deleting.service';
import { FieldSupplementService } from './field-supplement.service';
import { FieldViewSyncService } from './field-view-sync.service';
import { FormulaFieldService } from './formula-field.service';
import { LinkFieldQueryService } from './link-field-query.service';

@Module({
  imports: [FieldModule, CalculationModule, ViewModule, CollaboratorModule, TableDomainQueryModule],
  providers: [
    DbProvider,
    FieldDeletingService,
    FieldCreatingService,
    FieldConvertingService,
    FieldSupplementService,
    FieldConvertingLinkService,
    TableIndexService,
    FieldViewSyncService,
    FormulaFieldService,
    LinkFieldQueryService,
  ],
  exports: [
    FieldDeletingService,
    FieldCreatingService,
    FieldConvertingService,
    FieldSupplementService,
    FieldViewSyncService,
    FieldConvertingLinkService,
    FormulaFieldService,
    LinkFieldQueryService,
  ],
})
export class FieldCalculateModule {}
