import { Module } from '@nestjs/common';
import { WorkflowActionService } from 'src/features/automation/workflow-action/workflow-action.service';
import { WorkflowTriggerService } from 'src/features/automation/workflow-trigger/workflow-trigger.service';
import { PrismaService } from '../../../prisma.service';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';

@Module({
  controllers: [WorkflowController],
  providers: [WorkflowService, WorkflowTriggerService, WorkflowActionService, PrismaService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
