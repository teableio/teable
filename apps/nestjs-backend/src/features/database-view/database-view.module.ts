import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { CalculationModule } from '../calculation/calculation.module';
import { RecordQueryBuilderModule } from '../record/query-builder';
import { TableDomainQueryModule } from '../table-domain';
import { DatabaseViewService } from './database-view.service';

@Module({
  imports: [RecordQueryBuilderModule, TableDomainQueryModule, CalculationModule],
  providers: [DbProvider, DatabaseViewService],
})
export class DatabaseViewModule {}
