import { Module } from '@nestjs/common';
import { RecordCreatedListener } from './listeners';
import { WorkflowActionModule } from './workflow-action/workflow-action.module';
import { WorkflowTriggerModule } from './workflow-trigger/workflow-trigger.module';
import { WorkflowModule } from './workflow/workflow.module';

@Module({
  imports: [WorkflowModule, WorkflowTriggerModule, WorkflowActionModule],
  providers: [RecordCreatedListener],
})
export class AutomationModule {}
