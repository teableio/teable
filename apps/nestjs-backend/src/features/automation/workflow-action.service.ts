import type { AutomationWorkflowAction as AutomationWorkflowActionModel } from '.prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@teable-group/db-main-prisma';
import _ from 'lodash';
import { PrismaService } from '../../prisma.service';
import type { ActionTypeEnums } from './enums/action-type.enum';
import type { CreateWorkflowActionRo } from './model/create-workflow-action.ro';
import { WorkflowActionVo } from './model/workflow-action.vo';

@Injectable()
export class WorkflowActionService {
  private logger = new Logger(WorkflowActionService.name);

  constructor(private readonly prisma: PrismaService) {
  }

  async getWorkflowActions(
    workflowId: string,
    triggerId: string
  ): Promise<WorkflowActionVo[] | null> {
    const actionsData = await this.prisma.automationWorkflowAction.findMany({
      where: {
        workflowId,
        triggerId,
      },
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

  public async createWorkflowAction(
    actionId: string,
    createWorkflowActionRo: CreateWorkflowActionRo
  ): Promise<AutomationWorkflowActionModel> {
    const data: Prisma.AutomationWorkflowActionCreateInput = {
      actionId,
      workflowId: createWorkflowActionRo.workflowId,
      triggerId: createWorkflowActionRo.triggerId,
      description: createWorkflowActionRo.description,
      actionType: createWorkflowActionRo.actionType,
      inputExpressions: JSON.stringify(createWorkflowActionRo.inputExpressions),
      parentNodeId: createWorkflowActionRo.parentNodeId,
      nextNodeId: createWorkflowActionRo.nextNodeId,
      createdBy: 'admin',
      lastModifiedBy: 'admin',
    };

    return this.prisma.automationWorkflowAction.create({ data });
  }

  public async updateWorkflowAction(
    actionId: string,
    createWorkflowActionRo: CreateWorkflowActionRo
  ) {
    const where: Prisma.AutomationWorkflowActionWhereUniqueInput = {
      actionId,
    };

    const data: Prisma.AutomationWorkflowActionUpdateInput = {
      description: createWorkflowActionRo.description,
      actionType: createWorkflowActionRo.actionType,
      inputExpressions: JSON.stringify(createWorkflowActionRo.inputExpressions),
      parentNodeId: createWorkflowActionRo.parentNodeId,
      nextNodeId: createWorkflowActionRo.nextNodeId,
    };

    return this.prisma.automationWorkflowAction.update({ where, data });
  }
}
