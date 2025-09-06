import { Module } from '@nestjs/common';
import { PrismaModule } from '@teable/db-main-prisma';
import { DbProvider } from '../../db-provider/db.provider';
import { CalculationModule } from '../calculation/calculation.module';
import { RecordQueryBuilderModule } from '../record/query-builder';
import { RecordModule } from '../record/record.module';
import { ComputedDependencyCollectorService } from './services/computed-dependency-collector.service';
import { ComputedEvaluatorService } from './services/computed-evaluator.service';
import { ComputedOrchestratorService } from './services/computed-orchestrator.service';

@Module({
  imports: [PrismaModule, RecordQueryBuilderModule, RecordModule, CalculationModule],
  providers: [
    DbProvider,
    // Core services for the computed pipeline
    ComputedDependencyCollectorService,
    ComputedEvaluatorService,
    ComputedOrchestratorService,
  ],
  exports: [ComputedOrchestratorService],
})
export class ComputedModule {}
