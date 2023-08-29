import { Module } from '@nestjs/common';
import { WorkflowTriggerController } from './workflow-trigger.controller';
import { WorkflowTriggerService } from './workflow-trigger.service';

@Module({
  controllers: [WorkflowTriggerController],
  providers: [WorkflowTriggerService],
  exports: [WorkflowTriggerService],
})
export class WorkflowTriggerModule {}
