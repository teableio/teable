import { Injectable, Logger } from '@nestjs/common';
import { identify, IdPrefix } from '@teable-group/core';
import type { TopLevelCondition } from 'json-rules-engine';
import { findLast, omit, keyBy, head, join, tail } from 'lodash';
import { JsonRulesEngine } from '../../engine/json-rules-engine';
import { JsonSchemaParser } from '../../engine/json-schema/parser';
import type { TriggerTypeEnums } from '../../enums/trigger-type.enum';
import type { WorkflowActionVo } from '../../model/workflow-action.vo';
import { WorkflowService } from '../../workflow/workflow.service';
import { ActionResponseStatus } from '../action-core';
import type { IActionInputSchema } from '../action-core';
import type { IDecision, IDecisionGroups, IDecisionSchema } from '../decision';

@Injectable()
export abstract class TriggerCore<TEvent> {
  protected logger = new Logger(TriggerCore.name);

  constructor(
    protected readonly jsonRulesEngine: JsonRulesEngine,
    protected readonly workflowService: WorkflowService
  ) {}

  abstract listenerTrigger(event: TEvent): Promise<void>;

  protected async getWorkflowsByTrigger(tableId: string, triggerType?: TriggerTypeEnums[]) {
    return await this.workflowService.getWorkflowsByTrigger(tableId, triggerType);
  }

  protected async splitAction(workflowActions: { [actionId: string]: WorkflowActionVo }): Promise<{
    actions: { [actionId: string]: WorkflowActionVo };
    decisionGroups?: { [actionId: string]: IDecision };
  }> {
    const decisionNode = findLast(workflowActions, (_, key) => {
      return identify(key) === IdPrefix.WorkflowDecision;
    });

    let actions = workflowActions;
    let decisionGroups: { [actionId: string]: IDecision } | undefined;
    if (decisionNode) {
      actions = omit(workflowActions, decisionNode.id);
      const decisionInput = await new JsonSchemaParser<IDecisionSchema, IDecisionGroups>(
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        decisionNode.inputExpressions! as IDecisionSchema
      ).parse();

      decisionGroups = keyBy<IDecision>(decisionInput.groups, 'entryNodeId');
    }

    return {
      actions,
      decisionGroups,
    };
  }

  protected async callActionEngine(
    triggerData: Record<string, unknown>,
    actions: { [actionId: string]: WorkflowActionVo },
    decisionGroups?: { [actionId: string]: IDecision }
  ) {
    let parentNodeId: string;
    const actionEntries = Object.entries(actions);
    const actionTotal = actionEntries.length;
    actionEntries.forEach(([actionId, action], index) => {
      const options = {
        inputSchema: action.inputExpressions as IActionInputSchema,
        conditions: this.buildConditions(actionId, parentNodeId, decisionGroups),
        priority: actionTotal - index,
      };
      this.jsonRulesEngine.addRule(actionId, action.actionType.toString(), options);

      parentNodeId = actionId;
    });

    this.jsonRulesEngine.fire(triggerData);
  }

  protected buildConditions(
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
    }

    const decision = decisionGroups && decisionGroups[currentActionId];
    if (decision) {
      const conditions = decision.condition.conditions.reduce(
        (pre, cur) => {
          pre.push({
            fact: head(cur.left as string[]),
            operator: cur.operator,
            value: cur.right,
            path: `$.${join(tail(cur.left as string[]), '.')}`,
          });
          return pre;
        },
        [] as { [key: string]: unknown }[]
      );

      const dynamicLogic = {
        [`${decision.condition.logical === 'and' ? 'all' : 'any'}`]: conditions,
      } as TopLevelCondition;

      resultCondition.push(dynamicLogic);
    }

    return resultCondition.length ? { all: resultCondition } : undefined;
  }
}
