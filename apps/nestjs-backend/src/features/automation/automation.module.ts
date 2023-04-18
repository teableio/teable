import { Module } from '@nestjs/common';
import { AutomationService } from 'src/features/automation/automation.service';
import { RecordCreatedListener } from 'src/features/automation/listeners/record-created.listener';
import { WorkflowActionModule } from './workflow-action.module';
import { WorkflowTriggerModule } from './workflow-trigger.module';
import { WorkflowModule } from './workflow.module';

@Module({
  imports: [WorkflowModule, WorkflowActionModule, WorkflowTriggerModule],
  providers: [AutomationService, RecordCreatedListener],
  exports: [AutomationService],
})
export class AutomationModule {}
