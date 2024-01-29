/* eslint-disable @typescript-eslint/no-explicit-any */

import { Injectable } from '@nestjs/common';
import { map, intersection, isEmpty } from 'lodash';
// import type { RecordUpdatedEvent } from '../../../../../event-emitter/events';
import { JsonSchemaParser } from '../../../engine/json-schema/parser';
import { TriggerTypeEnums } from '../../../enums/trigger-type.enum';
import type { IConstSchema, IObjectArraySchema } from '../../action-core';
import { TriggerCore } from '../trigger-core';

export interface ITriggerRecordUpdatedSchema extends Record<string, unknown> {
  tableId: IConstSchema;
  viewId?: IConstSchema;
  watchFields: IObjectArraySchema;
}

export interface ITriggerRecordUpdated {
  tableId: string;
  viewId?: string | null;
  watchFields: string[];
}

@Injectable()
export class TriggerRecordUpdated extends TriggerCore<any> {
  // @OnEvent(EventEnums.RecordUpdated, { async: true })
  async listenerTrigger(event: any) {
    const { tableId, recordId, ops } = event;
    const workflows = await this.getWorkflowsByTrigger(tableId, [TriggerTypeEnums.RecordUpdated]);

    this.logger.log({
      message: `Listening to form record updated event, Estimated number of workflows built: ${workflows?.length}`,
      tableId,
      recordId,
    });

    if (workflows) {
      for (const workflow of workflows) {
        if (!workflow.trigger || !workflow.actions) {
          continue;
        }

        const triggerInput = await new JsonSchemaParser<
          ITriggerRecordUpdatedSchema,
          ITriggerRecordUpdated
        >(workflow.trigger.inputExpressions as ITriggerRecordUpdatedSchema).parse();

        // const setRecordOps = context.op?.op?.reduce((pre, cur) => {
        //   pre.push(RecordOpBuilder.editor.setRecord.detect(cur));
        //   return pre;
        // }, [] as ISetRecordOpContext[]);
        const changeFields = map(ops, 'fieldId');

        const sameField = intersection(triggerInput.watchFields as string[], changeFields);
        if (isEmpty(sameField)) {
          continue;
        }

        const { actions, decisionGroups } = await this.splitAction(workflow.actions);

        const trigger = {
          // [`trigger.${workflow.trigger.id}`]: context.snapshot?.data,
          // [`trigger.${workflow.trigger.id}`]: snapshot,
          [`trigger.${workflow.trigger.id}`]: {},
        };

        this.callActionEngine(trigger, actions, decisionGroups);
      }
    }
  }
}
