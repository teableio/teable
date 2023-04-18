import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { WorkflowActionController } from './workflow-action.controller';
import { WorkflowActionService } from './workflow-action.service';

@Module({
  controllers: [WorkflowActionController],
  providers: [WorkflowActionService, PrismaService],
  exports: [WorkflowActionService],
})
export class WorkflowActionModule {}
