import { Module } from '@nestjs/common';
import { ActionModule } from './actions';
import { JsonRulesEngine } from './engine/json-rules-engine';
import { RecordCreatedListener } from './listeners';
import { WorkflowActionModule } from './workflow/action/workflow-action.module';
import { WorkflowTriggerModule } from './workflow/trigger/workflow-trigger.module';
import { WorkflowModule } from './workflow/workflow.module';

@Module({
  imports: [WorkflowModule, WorkflowTriggerModule, WorkflowActionModule, ActionModule],
  providers: [JsonRulesEngine, RecordCreatedListener],
})
export class AutomationModule {}
