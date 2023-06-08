import { Module } from '@nestjs/common';
import { ActionModule } from './actions';
import { TriggerModule } from './actions/triggers/trigger.module';
import { WorkflowActionModule } from './workflow/action/workflow-action.module';
import { WorkflowTriggerModule } from './workflow/trigger/workflow-trigger.module';
import { WorkflowModule } from './workflow/workflow.module';

@Module({
  imports: [
    WorkflowModule,
    WorkflowTriggerModule,
    WorkflowActionModule,
    TriggerModule,
    ActionModule,
  ],
})
export class AutomationModule {}
