import { ConsoleLogger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { generateWorkflowActionId, generateWorkflowId } from '@teable-group/core';
import type { AutomationWorkflowAction as AutomationWorkflowActionModel } from '@teable-group/db-main-prisma';
import { PrismaService } from '@teable-group/db-main-prisma';
import { ActionTypeEnums } from '../../enums/action-type.enum';
import type { CreateWorkflowActionRo } from '../../model/create-workflow-action.ro';
import { WorkflowActionController } from './workflow-action.controller';
import { WorkflowActionService } from './workflow-action.service';

describe('WorkflowActionController', () => {
  let workflowActionController: WorkflowActionController;
  let workflowActionService: WorkflowActionService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WorkflowActionController],
      providers: [WorkflowActionService, PrismaService],
    }).compile();

    moduleRef.useLogger(new ConsoleLogger());

    workflowActionService = moduleRef.get<WorkflowActionService>(WorkflowActionService);
    workflowActionController = moduleRef.get<WorkflowActionController>(WorkflowActionController);
  });

  describe('createWorkflowAction', () => {
    const bodyParam: CreateWorkflowActionRo = {
      workflowId: generateWorkflowId(),
      actionType: ActionTypeEnums.Webhook,
    };

    it('/Controller should return success', async () => {
      const result = { success: true };
      const pathParamWorkflowActionId = generateWorkflowActionId();
      vi.spyOn(workflowActionService, 'create').mockImplementation(
        (_actionId, _createWorkflowActionRo) =>
          Promise.resolve({
            workflowId: 'workflowId',
            description: 'description',
            actionType: ActionTypeEnums.Webhook,
            inputExpressions: {},
            parentNodeId: '',
            nextNodeId: '',
          } as AutomationWorkflowActionModel)
      );

      expect(await workflowActionController.create(pathParamWorkflowActionId, bodyParam)).toEqual(
        result
      );
    });

    it('/Service should return void', async () => {
      const pathParamActionId = generateWorkflowActionId();

      expect(await workflowActionService.create(pathParamActionId, bodyParam)).toMatchObject({
        inputExpressions: {},
      });
    });
  });
});
