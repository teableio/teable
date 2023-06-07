import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { ISetRecordOpContext } from '@teable-group/core';
import { identify, IdPrefix } from '@teable-group/core';
import { SetRecordBuilder } from '@teable-group/core/dist/op-builder/record/set-record';
import type { TopLevelCondition } from 'json-rules-engine';
import _ from 'lodash';
import { EventEnums, RecordEvent } from '../../../share-db/events';
import type { IDecision, IDecisionGroups, IDecisionSchema } from '../actions';
import type { IActionInputSchema } from '../actions/action-core';
import { ActionResponseStatus } from '../actions/action-core';
import type {
  ITriggerRecordUpdated,
  ITriggerRecordUpdatedSchema,
} from '../actions/triggers/record-updated';
import { JsonRulesEngine } from '../engine/json-rules-engine';
import { JsonSchemaParser } from '../engine/json-schema/parser';
import { TriggerTypeEnums } from '../enums/trigger-type.enum';
import type { WorkflowActionVo } from '../model/workflow-action.vo';
import { WorkflowService } from '../workflow/workflow.service';

@Injectable()
export class RecordEventListener {
  private logger = new Logger(RecordEventListener.name);

  constructor(
    private readonly jsonRulesEngine: JsonRulesEngine,
    private readonly workflowService: WorkflowService
  ) {}

  @OnEvent(EventEnums.RecordCreated, { async: true })
  async handleRecordCreatedEvent(event: RecordEvent) {
    const { tableId, recordId, context } = event;
    const workflows = await this.workflowService.getWorkflowsByTrigger(tableId, [
      TriggerTypeEnums.RecordCreated,
    ]);

    this.logger.log({
      message: `Listening to form record creation event, Estimated number of workflows built: ${workflows?.length}`,
      tableId,
      recordId,
    });

    if (workflows) {
      for (const workflow of workflows) {
        if (!workflow.trigger || !workflow.actions) {
          continue;
        }

        const { actions, decisionGroups } = await this.splitActions(workflow.actions);

        let parentNodeId: string;
        const actionTotal = _.size(workflow.actions);
        Object.entries(actions).forEach(([id, value], index) => {
          const options = {
            inputSchema: value.inputExpressions as IActionInputSchema,
            conditions: this.buildConditions(id, parentNodeId, decisionGroups),
            priority: actionTotal - index,
          };
          this.jsonRulesEngine.addRule(id, value.actionType!.toString(), options);

          parentNodeId = id;
        });

        const trigger = {
          [`trigger.${workflow.trigger.id}`]: {
            status: ActionResponseStatus.OK,
            data: context.snapshot?.data,
          },
        };

        this.jsonRulesEngine.fire(trigger);
      }
    }
  }

  @OnEvent(EventEnums.RecordUpdated, { async: true })
  async handleRecordUpdateEvent(event: RecordEvent) {
    const { tableId, recordId, context } = event;
    const workflows = await this.workflowService.getWorkflowsByTrigger(tableId, [
      TriggerTypeEnums.RecordUpdated,
      TriggerTypeEnums.RecordMatchesConditions,
    ]);

    this.logger.log({
      message: `Listening to form record creation event, Estimated number of workflows built: ${workflows?.length}`,
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

        const reduce = context.op?.op?.reduce((pre, cur) => {
          pre.push(new SetRecordBuilder().detect(cur));
          return pre;
        }, [] as ISetRecordOpContext[]);
        const dictionary = _.map(reduce, 'fieldId');

        const difference = _.intersection(triggerInput.watchFields as string[], dictionary);
        if (_.isEmpty(difference)) {
          return;
        }

        const { actions, decisionGroups } = await this.splitActions(workflow.actions);

        let parentNodeId: string;
        const actionTotal = _.size(workflow.actions);
        Object.entries(actions).forEach(([id, value], index) => {
          const options = {
            inputSchema: value.inputExpressions as IActionInputSchema,
            conditions: this.buildConditions(id, parentNodeId, decisionGroups),
            priority: actionTotal - index,
          };
          this.jsonRulesEngine.addRule(id, value.actionType!.toString(), options);

          parentNodeId = id;
        });

        const trigger = {
          [`trigger.${workflow.trigger.id}`]: context.snapshot?.data,
        };

        this.jsonRulesEngine.fire(trigger);
      }
    }
  }

  private async splitActions(workflowActions: { [actionId: string]: WorkflowActionVo }): Promise<{
    actions: { [actionId: string]: WorkflowActionVo };
    decisionGroups?: { [actionId: string]: IDecision };
  }> {
    const decisionNode = _.findLast(workflowActions, (_, key) => {
      return identify(key) === IdPrefix.WorkflowDecision;
    });

    let actions = workflowActions;
    let decisionGroups: { [actionId: string]: IDecision } | undefined;
    if (decisionNode) {
      actions = _.omit(workflowActions, decisionNode.id);
      const decisionInput = await new JsonSchemaParser<IDecisionSchema, IDecisionGroups>(
        decisionNode.inputExpressions! as IDecisionSchema
      ).parse();

      decisionGroups = _.keyBy<IDecision>(decisionInput.groups!, 'entryNodeId');
    }

    return {
      actions,
      decisionGroups,
    };
  }

  private buildConditions(
    currentActionId: string,
    parentActionId?: string | null,
    decisionGroups?: { [actionId: string]: IDecision }
  ): TopLevelCondition | undefined {
    const resultCondition = [];

    if (parentActionId) {
      resultCondition.push({
        fact: `action.${parentActionId}`,
        operator: 'equal',
        value: ActionResponseStatus.OK,
        path: '$.status',
      });
    } else {
      return undefined;
    }

    if (decisionGroups) {
      const decision = decisionGroups[currentActionId];
      const conditions = decision.condition.conditions.reduce((pre, cur) => {
        pre.push({
          fact: _.head(cur.left as string[]),
          operator: cur.operator,
          value: cur.right,
          path: `$.${_.join(_.tail(cur.left as string[]), '.')}`,
        });
        return pre;
      }, [] as { [key: string]: unknown }[]);

      const dynamicLogic = {
        [`${decision.condition.logical === 'and' ? 'all' : 'any'}`]: conditions,
      } as TopLevelCondition;

      resultCondition.push(dynamicLogic);
    }

    this.logger.log({ all: resultCondition });

    return { all: resultCondition };
  }
}
