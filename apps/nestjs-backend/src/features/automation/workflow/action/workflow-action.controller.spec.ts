import { ConsoleLogger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  generateWorkflowActionId,
  generateWorkflowId,
  generateWorkflowTriggerId,
} from '@teable-group/core';
import type { AutomationWorkflowAction as AutomationWorkflowActionModel } from '@teable-group/db-main-prisma';
import { PrismaService } from '../../../../prisma.service';
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
      description: 'description',
      inputExpressions: {
        url: {
          type: 'template',
          elements: [
            {
              type: 'text',
              value: 'http://127.0.0.1:3000/api/table/tabASK1p8CHBPKYdu/record',
            },
          ],
        },
        method: {
          type: 'text',
          value: 'POST',
        },
        body: {
          type: 'template',
          elements: [
            {
              type: 'text',
              value: '{\n',
            },
            {
              type: 'text',
              value: '"records": [{\n',
            },
            {
              type: 'text',
              value: '"fields": {\n',
            },
            {
              type: 'text',
              value: '"name": "tom"\n',
            },
            {
              type: 'text',
              value: '}\n',
            },
            {
              type: 'text',
              value: '}]\n',
            },
            {
              type: 'text',
              value: '}',
            },
          ],
        },
        headers: {
          type: 'object',
          properties: [
            {
              key: {
                type: 'text',
                value: 'Content-Type',
              },
              value: {
                type: 'template',
                elements: [
                  {
                    type: 'text',
                    value: 'application/json',
                  },
                ],
              },
            },
          ],
        },
        responseParams: null,
      },
      nextNodeId: null,
      parentNodeId: null,
    };

    it('/Controller should return success', async () => {
      const result = { success: true };
      const pathParamWorkflowActionId = generateWorkflowActionId();
      jest
        .spyOn(workflowActionService, 'createWorkflowAction')
        .mockImplementation((actionId, createWorkflowActionRo) =>
          Promise.resolve({
            workflowId: 'workflowId',
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

      expect(
        await workflowActionService.createWorkflowAction(pathParamActionId, bodyParam)
      ).toMatchObject({
        inputExpressions: JSON.stringify(bodyParam.inputExpressions),
      });
    });
  });
});
