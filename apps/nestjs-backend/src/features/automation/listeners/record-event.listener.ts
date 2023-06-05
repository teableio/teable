import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import _ from 'lodash';
import { EventEnums, RecordEvent } from '../../../share-db/events';
import type { IActionInputSchema } from '../actions/action-core';
import { JsonRulesEngine } from '../engine/json-rules-engine';
import { ActionTypeEnums } from '../enums/action-type.enum';
import { TriggerTypeEnums } from '../enums/trigger-type.enum';
import { WorkflowService } from '../workflow/workflow.service';

@Injectable()
export class RecordEventListener {
  private logger = new Logger(RecordEventListener.name);

  constructor(
    private readonly jsonRulesEngine: JsonRulesEngine,
    private readonly workflowService: WorkflowService
  ) {}

  @OnEvent(EventEnums.RecordCreated, { async: true })
  async handleOrderCreatedEvent(event: RecordEvent) {
    const { tableId, recordId, context } = event;
    const workflows = await this.workflowService.getWorkflowsByTrigger(
      tableId,
      TriggerTypeEnums.RecordCreated
    );

    this.logger.log({
      message: `Listening to form record creation event, Estimated number of workflows built: ${workflows?.length}`,
      tableId,
      recordId,
    });

    if (workflows) {
      workflows.forEach((workflow) => {
        if (!workflow.trigger || !workflow.actions) {
          return;
        }

        let parentNodeId: string;
        const actionTotal = _.size(workflow.actions);
        Object.entries(workflow.actions).forEach(([id, value], index) => {
          if (value.actionType !== ActionTypeEnums.Decision) {
            const options = {
              id,
              parentNodeId,
              inputSchema: value.inputExpressions as IActionInputSchema,
              priority: actionTotal - index,
            };
            this.jsonRulesEngine.addRule(value.actionType!.toString(), options);

            parentNodeId = id;
          }
        });

        const trigger = {
          [`trigger.${workflow.trigger.id}`]: context.snapshot?.data,
        };

        this.jsonRulesEngine.fire(trigger);
      });
    }
  }
}
