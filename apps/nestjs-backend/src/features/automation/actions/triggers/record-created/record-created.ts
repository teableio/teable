/* eslint-disable @typescript-eslint/no-explicit-any */

import { Injectable } from '@nestjs/common';
// import type { RecordCreatedEvent } from '../../../../../event-emitter/model';
import { TriggerTypeEnums } from '../../../enums/trigger-type.enum';
import type { IConstSchema } from '../../action-core';
import { TriggerCore } from '../trigger-core';

export interface ITriggerRecordCreatedSchema extends Record<string, unknown> {
  tableId: IConstSchema;
}

export interface ITriggerRecordCreatedOptions {
  tableId: string;
}

@Injectable()
export class TriggerRecordCreated extends TriggerCore<any> {
  // @OnEvent(EventEnums.RecordCreated, { async: true })
  async listenerTrigger(event: any) {
    const { tableId, recordId } = event;
    const workflows = await this.getWorkflowsByTrigger(tableId, [TriggerTypeEnums.RecordCreated]);

    this.logger.log({
      message: `Listening to form record created event, Estimated number of workflows built: ${workflows?.length}`,
      tableId,
      recordId,
    });

    if (workflows) {
      for (const workflow of workflows) {
        if (!workflow.trigger || !workflow.actions) {
          continue;
        }

        const { actions, decisionGroups } = await this.splitAction(workflow.actions);

        const trigger = {
          [`trigger.${workflow.trigger.id}`]: {},
        };

        this.callActionEngine(trigger, actions, decisionGroups);
      }
    }
  }
}
