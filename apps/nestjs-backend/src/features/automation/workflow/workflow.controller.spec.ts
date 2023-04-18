import { ConsoleLogger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { generateWorkflowId } from '@teable-group/core';
import type { AutomationWorkflow as AutomationWorkflowModel } from '@teable-group/db-main-prisma';
import { PrismaService } from '../../../prisma.service';
import type { CreateWorkflowRo } from '../model/create-workflow.ro';
import { WorkflowActionService } from '../workflow-action/workflow-action.service';
import { WorkflowTriggerService } from '../workflow-trigger/workflow-trigger.service';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';

describe('WorkflowController', () => {
  let workflowController: WorkflowController;
  let workflowService: WorkflowService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WorkflowController],
      providers: [WorkflowService, PrismaService, WorkflowTriggerService, WorkflowActionService],
    }).compile();

    moduleRef.useLogger(new ConsoleLogger());

    workflowService = moduleRef.get<WorkflowService>(WorkflowService);
    workflowController = moduleRef.get<WorkflowController>(WorkflowController);
  });

  describe('createWorkflow', () => {
    it('/Controller should return success', async () => {
      const result = { success: true };
      const pathParamWorkflowId = generateWorkflowId();
      const bodyParam: CreateWorkflowRo = {
        name: 'Automation 1',
      };
      jest
        .spyOn(workflowService, 'createWorkflow')
        .mockImplementation((workflowId, createWorkflowRo) =>
          Promise.resolve({
            id: 'id',
            workflowId: 'workflowId',
            name: 'name',
            description: 'description',
            createdBy: 'admin',
            lastModifiedBy: 'admin',
          } as AutomationWorkflowModel)
        );

      expect(await workflowController.createWorkflow(pathParamWorkflowId, bodyParam)).toEqual(
        result
      );
    });

    it('/Service should return void', async () => {
      const pathParamWorkflowId = generateWorkflowId();
      const bodyParam: CreateWorkflowRo = {
        name: 'Automation 1',
      };

      expect(await workflowService.createWorkflow(pathParamWorkflowId, bodyParam)).toMatchObject({
        workflowId: pathParamWorkflowId,
        name: bodyParam.name,
      });
    });
  });
});
