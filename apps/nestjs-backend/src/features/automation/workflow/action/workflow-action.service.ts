import { Injectable, Logger } from '@nestjs/common';
import type { IEitherOr } from '@teable-group/core';
import { identify, IdPrefix } from '@teable-group/core';
import type {
  AutomationWorkflowAction as AutomationWorkflowActionModel,
  Prisma,
} from '@teable-group/db-main-prisma';
import _ from 'lodash';
import { PrismaService } from '../../../../prisma.service';
import { DEFAULT_DECISION_SCHEMA } from '../../actions';
import { MetaKit } from '../../engine/json-schema/meta-kit';
import { ActionTypeEnums } from '../../enums/action-type.enum';
import type { CreateWorkflowActionRo } from '../../model/create-workflow-action.ro';
import type { UpdateWorkflowActionRo } from '../../model/update-workflow-action.ro';
import { WorkflowActionVo } from '../../model/workflow-action.vo';

@Injectable()
export class WorkflowActionService {
  private logger = new Logger(WorkflowActionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getWorkflowActions(workflowId: string): Promise<WorkflowActionVo[] | null> {
    const actionsData = await this.prisma.automationWorkflowAction.findMany({
      where: { workflowId },
    });

    if (_.isEmpty(actionsData)) {
      return null;
    }

    // Perform a pre-sort on the data to ensure the order of execution
    const sortedActions: AutomationWorkflowActionModel[] = [];
    const cacheById = _.keyBy(actionsData, (action) => action.actionId);

    let currentObj = actionsData.find((obj) => _.isEmpty(obj.parentNodeId));

    while (currentObj) {
      sortedActions.push(currentObj);
      currentObj = cacheById[currentObj.nextNodeId!] || null;
    }

    const results: WorkflowActionVo[] = [];
    sortedActions.forEach((data) => {
      const action = new WorkflowActionVo();
      action.id = data.actionId;
      action.actionType = data.actionType as ActionTypeEnums;
      action.description = data.description;
      action.inputExpressions = data.inputExpressions ? JSON.parse(data.inputExpressions) : null;
      action.nextActionId = data.nextNodeId;
      results.push(action);
    });

    return results;
  }

  async create(
    actionId: string,
    createRo: CreateWorkflowActionRo
  ): Promise<AutomationWorkflowActionModel> {
    const data: Prisma.AutomationWorkflowActionCreateInput = {
      actionId,
      workflowId: createRo.workflowId,
      actionType: createRo.actionType,
      parentNodeId: createRo.parentNodeId,
      nextNodeId: createRo.nextNodeId,
      inputExpressions: JSON.stringify(
        createRo.actionType === ActionTypeEnums.Decision ? DEFAULT_DECISION_SCHEMA : {}
      ),
      createdBy: 'admin',
      lastModifiedBy: 'admin',
    };

    return await this.prisma.$transaction(async (tx) => {
      const currentNode = await tx.automationWorkflowAction.create({ data });
      /*
       * 1. If `data` has only the `parentNodeId` attribute, it means the current node is inserted at the end of the element
       * 2. If `data` has only `nextNodeId` attribute, it means the current node is inserted at the front of the element
       * 3. If `data` has only two attributes, it means that the current node is inserted in the middle of the element
       * 4. If a new action is added to the logic, there is still a need to modify the entry node of the logic group according to the subscript
       */
      const { parentNodeId, nextNodeId } = data;
      if (parentNodeId || nextNodeId) {
        // Check for the existence of dependent nodes
        const actionIds = [parentNodeId, nextNodeId].filter((id) => id) as string[];
        await this.countActionOrThrow(actionIds, tx);
      }

      const parentDecisionArrayIndex = createRo.parentDecisionArrayIndex;

      if (parentNodeId) {
        await this.updateParentNode(
          parentNodeId,
          currentNode.actionId,
          parentDecisionArrayIndex,
          tx
        );
      }

      if (nextNodeId) {
        await this.updateNextNode(
          nextNodeId,
          currentNode.actionId,
          parentNodeId,
          parentDecisionArrayIndex,
          tx
        );
      }
      return currentNode;
    });
  }

  private async updateParentNode(
    actionId: string,
    newNextNodeId: string,
    parentDecisionArrayIndex?: number | null,
    tx?: Prisma.TransactionClient
  ) {
    await this.updateAction(actionId, { nextNodeId: newNextNodeId }, tx);

    if (identify(actionId) === IdPrefix.WorkflowDecision && !_.isNil(parentDecisionArrayIndex)) {
      const replacePropOptions = {
        shortPath: `groups.elements[${parentDecisionArrayIndex}]`,
        propKey: 'entryNodeId',
        propReplaceData: { type: 'const', value: newNextNodeId },
      };

      await this.updateActionInputExpressionsPropValue(actionId, replacePropOptions, tx);
    }
  }

  private async updateNextNode(
    actionId: string,
    newParentNodeId: string,
    oldParentNodeId?: string | null,
    parentDecisionArrayIndex?: number | null,
    tx?: Prisma.TransactionClient
  ) {
    await this.updateAction(actionId, { parentNodeId: newParentNodeId }, tx);

    if (
      oldParentNodeId &&
      !_.isNil(parentDecisionArrayIndex) &&
      identify(oldParentNodeId) === IdPrefix.WorkflowDecision
    ) {
      const replacePropOptions = {
        shortPath: `groups.elements[${parentDecisionArrayIndex}]`,
        propKey: 'entryNodeId',
        propReplaceData: { type: 'null' },
      };
      await this.updateActionInputExpressionsPropValue(oldParentNodeId, replacePropOptions, tx);
    }
  }

  async delete(
    id: IEitherOr<{ actionId: string; workflowId: string }, 'actionId', 'workflowId'>,
    prisma?: PrismaService
  ): Promise<boolean> {
    const { actionId, workflowId } = id;

    const result = await (prisma || this.prisma).$transaction(async (tx) => {
      if (workflowId) {
        return tx.automationWorkflowAction.deleteMany({
          where: {
            workflowId,
          },
        });
      }

      const { nextNodeId, parentNodeId } = await tx.automationWorkflowAction.findUniqueOrThrow({
        select: { nextNodeId: true, parentNodeId: true },
        where: { actionId },
      });

      const updateActions = [];

      if (parentNodeId) {
        updateActions.push(this.updateAction(parentNodeId, { nextNodeId }, tx));
      }

      if (nextNodeId) {
        updateActions.push(this.updateAction(nextNodeId, { parentNodeId }, tx));
      }

      await Promise.all(updateActions);
      return tx.automationWorkflowAction.deleteMany({ where: { actionId } });
    });

    return result.count > 0;
  }

  async move(
    newNextNodeId: string,
    newParentNodeId: string,
    parentDecisionArrayIndex?: number
  ): Promise<void> {
    return;
  }

  async updateConfig(actionId: string, updateRo: UpdateWorkflowActionRo) {
    const where: Prisma.AutomationWorkflowActionWhereUniqueInput = {
      actionId,
    };

    const data: Prisma.AutomationWorkflowActionUpdateInput = {
      description: updateRo.description,
      inputExpressions: JSON.stringify(updateRo.inputExpressions),
    };

    return this.prisma.automationWorkflowAction.update({ where, data });
  }

  async updateActionType() {
    return;
  }

  private async countActionOrThrow(
    actionIds: string[],
    tx?: Prisma.TransactionClient,
    checkLength = true
  ): Promise<number> {
    const actionCount = await (tx || this.prisma).automationWorkflowAction.count({
      where: {
        actionId: {
          in: actionIds,
        },
      },
    });
    if (checkLength && actionCount != actionIds.length) {
      throw new Error('action node does not exist');
    }
    return actionCount;
  }

  private async updateAction(
    actionId: string,
    updateData: Prisma.AutomationWorkflowActionUpdateInput,
    tx?: Prisma.TransactionClient
  ): Promise<AutomationWorkflowActionModel> {
    return (tx || this.prisma).automationWorkflowAction.update({
      where: { actionId },
      data: updateData,
    });
  }

  private async updateActionInputExpressionsPropValue(
    actionId: string,
    replacePropOptions: {
      shortPath: string | string[];
      propKey: string;
      propReplaceData: object;
    },
    tx?: Prisma.TransactionClient
  ) {
    const { shortPath, propKey, propReplaceData } = replacePropOptions;

    const decision = await (tx || this.prisma).automationWorkflowAction.findUniqueOrThrow({
      where: { actionId },
    });
    const inputExpressions = JSON.parse(decision.inputExpressions!);

    const propPath = MetaKit.queryPathOfProp(inputExpressions, shortPath, propKey);
    if (!propPath) {
      throw new Error('action `inputExpressions` attribute missing');
    }

    MetaKit.replaceOfPropValue(inputExpressions, propPath, propReplaceData);

    const updateData = { inputExpressions: JSON.stringify(inputExpressions) };
    await this.updateAction(decision.actionId, updateData, tx);
  }
}
