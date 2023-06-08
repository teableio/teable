import { Module } from '@nestjs/common';
import { JsonRulesEngine } from '../../engine/json-rules-engine';
import { WorkflowModule } from '../../workflow/workflow.module';
import { ActionModule } from '../action.module';
import { TriggerRecordCreated } from './record-created';
import { TriggerRecordUpdated } from './record-updated';

@Module({
  imports: [WorkflowModule, ActionModule],
  providers: [JsonRulesEngine, TriggerRecordCreated, TriggerRecordUpdated],
  exports: [TriggerRecordCreated, TriggerRecordUpdated],
})
export class TriggerModule {}
