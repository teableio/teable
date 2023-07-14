import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { ISetRecordOpContext } from '@teable-group/core';
import { OpBuilder } from '@teable-group/core';
import { map, intersection, isEmpty } from 'lodash';
import { EventEnums, RecordEvent } from '../../../../../share-db/events';
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
export class TriggerRecordUpdated extends TriggerCore<RecordEvent> {
  @OnEvent(EventEnums.RecordUpdated, { async: true })
  async listenerTrigger(event: RecordEvent) {
    const { tableId, recordId, context } = event;
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

        const setRecordOps = context.op?.op?.reduce((pre, cur) => {
          pre.push(OpBuilder.editor.setRecord.detect(cur));
          return pre;
        }, [] as ISetRecordOpContext[]);
        const changeFields = map(setRecordOps, 'fieldId');

        const sameField = intersection(triggerInput.watchFields as string[], changeFields);
        if (isEmpty(sameField)) {
          continue;
        }

        const { actions, decisionGroups } = await this.splitAction(workflow.actions);

        const trigger = {
          [`trigger.${workflow.trigger.id}`]: context.snapshot?.data,
        };

        this.callActionEngine(trigger, actions, decisionGroups);
      }
    }
  }
}
