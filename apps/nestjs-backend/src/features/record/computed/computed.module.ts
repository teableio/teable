import { Module } from '@nestjs/common';
import { PrismaModule } from '@teable/db-main-prisma';
import { DbProvider } from '../../../db-provider/db.provider';
import { CalculationModule } from '../../calculation/calculation.module';
import { TableDomainQueryModule } from '../../table-domain/table-domain-query.module';
import { RecordQueryBuilderModule } from '../query-builder';
import { RecordModule } from '../record.module';
import { ComputedDependencyCollectorService } from './services/computed-dependency-collector.service';
import { ComputedEvaluatorService } from './services/computed-evaluator.service';
import { ComputedOrchestratorService } from './services/computed-orchestrator.service';
import { LinkCascadeResolver } from './services/link-cascade-resolver';
import { RecordComputedUpdateService } from './services/record-computed-update.service';

@Module({
  imports: [
    PrismaModule,
    RecordQueryBuilderModule,
    RecordModule,
    CalculationModule,
    TableDomainQueryModule,
  ],
  providers: [
    DbProvider,
    // Core services for the computed pipeline
    ComputedDependencyCollectorService,
    ComputedEvaluatorService,
    ComputedOrchestratorService,
    RecordComputedUpdateService,
    LinkCascadeResolver,
  ],
  exports: [ComputedOrchestratorService],
})
export class ComputedModule {}
