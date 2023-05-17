import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import _ from 'lodash';
import { RecordCreatedEvent } from 'src/share-db/events';
import type { IActionRequest } from '../actions/action-core';
import { JsonRulesEngine } from '../engine/json-rules-engine.class';
import { TriggerTypeEnums } from '../enums/trigger-type.enum';
import { WorkflowService } from '../workflow/workflow.service';

@Injectable()
export class RecordCreatedListener {
  private logger = new Logger(RecordCreatedListener.name);

  constructor(
    private readonly jsonRulesEngine: JsonRulesEngine,
    private readonly workflowService: WorkflowService
  ) {}

  @OnEvent(RecordCreatedEvent.EVENT_NAME, { async: true })
  async handleOrderCreatedEvent(event: RecordCreatedEvent) {
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

        const actionTotal = _.size(workflow.actions);
        Object.entries(workflow.actions).forEach(([key, value], index) => {
          const options = {
            id: key,
            params: value.inputExpressions as IActionRequest,
            priority: actionTotal - index,
          };
          this.jsonRulesEngine.addRule(value.actionType!.toString(), options);
        });

        const trigger = {
          [workflow.trigger.id]: context.snapshot?.data,
        };

        this.jsonRulesEngine.fire({ trigger });
      });
    }
  }
}
