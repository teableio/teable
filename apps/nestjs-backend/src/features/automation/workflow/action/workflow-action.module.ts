import { Module } from '@nestjs/common';
import { WorkflowDecisionController } from '../decision/workflow-decision.controller';
import { WorkflowActionController } from './workflow-action.controller';
import { WorkflowActionService } from './workflow-action.service';

@Module({
  controllers: [WorkflowActionController, WorkflowDecisionController],
  providers: [WorkflowActionService],
  exports: [WorkflowActionService],
})
export class WorkflowActionModule {}
