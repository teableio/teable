import { ConsoleLogger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  generateWorkflowActionId,
  generateWorkflowId,
  generateWorkflowTriggerId,
} from '@teable-group/core';
import type { AutomationWorkflowAction as AutomationWorkflowActionModel } from '@teable-group/db-main-prisma';
import { PrismaService } from '../../prisma.service';
import { ActionTypeEnums } from './enums/action-type.enum';
import type { CreateWorkflowActionRo } from './model/create-workflow-action.ro';
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
    it('/Controller should return success', async () => {
      const result = { success: true };
      const pathParamWorkflowActionId = generateWorkflowActionId();
      const bodyParam: CreateWorkflowActionRo = {
        workflowId: generateWorkflowId(),
        triggerId: generateWorkflowTriggerId(),
        actionType: ActionTypeEnums.Webhook,
        description: 'description',
        inputExpressions: {
          url: ['https://127.0.0.1:3000/api/table/tabASK1p8CHBPKYdu/record'],
          body: [
            '{\n',
            '  "records": [\n',
            '  {\n',
            '    "fields": {\n',
            '      "name": "tom"\n',
            '    }\n',
            '  }\n',
            ']\n',
            '}',
          ],
          method: 'POST',
          headers: [
            {
              key: 'Content-Type',
              value: ['application/json'],
            },
          ],
          responseParams: [],
        },
        nextNodeId: null,
        parentNodeId: null,
      };
      jest
        .spyOn(workflowActionService, 'createWorkflowAction')
        .mockImplementation((actionId, createWorkflowActionRo) =>
          Promise.resolve({
            workflowId: 'workflowId',
            triggerId: 'triggerId',
            description: 'description',
            actionType: ActionTypeEnums.Webhook,
            inputExpressions: {},
            parentNodeId: '',
            nextNodeId: '',
          } as AutomationWorkflowActionModel)
        );

      expect(
        await workflowActionController.createWorkflowAction(pathParamWorkflowActionId, bodyParam)
      ).toEqual(result);
    });

    it('/Service should return void', async () => {
      const pathParamActionId = generateWorkflowActionId();
      const bodyParam: CreateWorkflowActionRo = {
        workflowId: generateWorkflowId(),
        triggerId: generateWorkflowTriggerId(),
        actionType: ActionTypeEnums.Webhook,
        description: 'description',
        inputExpressions: {
          url: ['https://127.0.0.1:3000/api/table/tabASK1p8CHBPKYdu/record'],
          body: [
            '{\n',
            '  "records": [\n',
            '  {\n',
            '    "fields": {\n',
            '      "name": "tom"\n',
            '    }\n',
            '  }\n',
            ']\n',
            '}',
          ],
          method: 'POST',
          headers: [
            {
              key: 'Content-Type',
              value: ['application/json'],
            },
          ],
          responseParams: [],
        },
        nextNodeId: null,
        parentNodeId: null,
      };

      expect(
        await workflowActionService.createWorkflowAction(pathParamActionId, bodyParam)
      ).toMatchObject({
        inputExpressions: JSON.stringify(bodyParam.inputExpressions),
      });
    });
  });
});
