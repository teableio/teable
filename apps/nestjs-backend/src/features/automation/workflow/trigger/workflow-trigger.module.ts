import { Module } from '@nestjs/common';
import { PrismaService } from '../../../../prisma.service';
import { WorkflowTriggerController } from './workflow-trigger.controller';
import { WorkflowTriggerService } from './workflow-trigger.service';

@Module({
  controllers: [WorkflowTriggerController],
  providers: [WorkflowTriggerService, PrismaService],
  exports: [WorkflowTriggerService],
})
export class WorkflowTriggerModule {}
