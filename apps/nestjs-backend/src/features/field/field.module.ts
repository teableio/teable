import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { CalculationModule } from '../calculation/calculation.module';
import { TableDomainQueryModule } from '../table-domain';
import { FormulaFieldService } from './field-calculate/formula-field.service';
import { LinkFieldQueryService } from './field-calculate/link-field-query.service';
import { FieldService } from './field.service';

@Module({
  imports: [CalculationModule, TableDomainQueryModule],
  providers: [FieldService, DbProvider, FormulaFieldService, LinkFieldQueryService],
  exports: [FieldService],
})
export class FieldModule {}
