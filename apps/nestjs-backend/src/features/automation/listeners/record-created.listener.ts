import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import _ from 'lodash';
import { RecordCreatedEvent } from 'src/share-db/events';
import { Webhook, MailSender } from '../actions';
import type { IWebhookRequest, IMailSenderRequest } from '../actions';
import engine from '../engine/json-rules-engine';
import { TriggerTypeEnums } from '../enums/trigger-type.enum';
import { WorkflowService } from '../workflow/workflow.service';

@Injectable()
export class RecordCreatedListener {
  private logger = new Logger(RecordCreatedListener.name);
  constructor(private readonly workflowService: WorkflowService) {}

  @OnEvent(RecordCreatedEvent.EVENT_NAME)
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

    if (!_.isEmpty(workflows)) {
      workflows?.forEach((workflow) => {
        const jsonNg = engine();

        // workflow.actions
        const length = Object.entries(workflow.actions!).length;
        Object.entries(workflow.actions!).forEach(([key, value], index) => {
          let action = undefined;
          if (value.actionType === `webhook`) {
            action = new Webhook(key, value.inputExpressions as IWebhookRequest, length - index);
          } else if (value.actionType === `mail_sender`) {
            action = new MailSender(
              key,
              value.inputExpressions as IMailSenderRequest,
              length - index
            );
          }

          jsonNg.addRule(action!);
        });

        jsonNg.run();
      });
    }
  }
}
