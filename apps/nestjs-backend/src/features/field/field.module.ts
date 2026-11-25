import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { RawOpStagingModule } from '../../share-db/raw-op-staging.module';
import { CalculationModule } from '../calculation/calculation.module';
import { FieldPeriodicRefreshModule } from '../field-periodic-refresh/field-periodic-refresh.module';
import { TableDomainQueryModule } from '../table-domain';
import { FormulaFieldService } from './field-calculate/formula-field.service';
import { LinkFieldQueryService } from './field-calculate/link-field-query.service';
import { FieldService } from './field.service';

@Module({
  imports: [
    CalculationModule,
    RawOpStagingModule,
    TableDomainQueryModule,
    FieldPeriodicRefreshModule,
  ],
  providers: [FieldService, DbProvider, FormulaFieldService, LinkFieldQueryService],
  exports: [FieldService, LinkFieldQueryService],
})
export class FieldModule {}
