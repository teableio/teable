import { Module } from '@nestjs/common';
import { WorkflowActionService } from './action/workflow-action.service';
import { WorkflowTriggerService } from './trigger/workflow-trigger.service';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';

@Module({
  controllers: [WorkflowController],
  providers: [WorkflowService, WorkflowTriggerService, WorkflowActionService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
