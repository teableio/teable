import { ConsoleLogger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { generateWorkflowId, generateWorkflowTriggerId } from '@teable-group/core';
import type { AutomationWorkflowTrigger as AutomationWorkflowTriggerModel } from '@teable-group/db-main-prisma';
import { PrismaService } from '../../prisma.service';
import { TriggerTypeEnums } from './enums/trigger-type.enum';
import type { CreateWorkflowTriggerRo } from './model/create-workflow-trigger.ro';
import { WorkflowTriggerController } from './workflow-trigger.controller';
import { WorkflowTriggerService } from './workflow-trigger.service';

describe('WorkflowTriggerController', () => {
  let workflowTriggerController: WorkflowTriggerController;
  let workflowTriggerService: WorkflowTriggerService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WorkflowTriggerController],
      providers: [WorkflowTriggerService, PrismaService],
    }).compile();

    moduleRef.useLogger(new ConsoleLogger());

    workflowTriggerService = moduleRef.get<WorkflowTriggerService>(WorkflowTriggerService);
    workflowTriggerController = moduleRef.get<WorkflowTriggerController>(WorkflowTriggerController);
  });

  describe('createWorkflowTrigger', () => {
    it('/Controller should return success', async () => {
      const result = { success: true };
      const pathParamTriggerId = generateWorkflowTriggerId();
      const bodyParam: CreateWorkflowTriggerRo = {
        workflowId: generateWorkflowId(),
        triggerType: TriggerTypeEnums.RecordCreated,
        inputExpressions: { tableId: 'tblwEp45tdvwTxiUl' },
      };
      jest
        .spyOn(workflowTriggerService, 'createWorkflowTrigger')
        .mockImplementation((triggerId, createWorkflowTriggerRo) =>
          Promise.resolve({
            id: 'id',
            workflowId: 'workflowId',
            triggerId: 'triggerId',
            triggerType: 'triggerType',
            inputExpressions: {},
            createdBy: 'admin',
            lastModifiedBy: 'admin',
          } as AutomationWorkflowTriggerModel)
        );

      expect(
        await workflowTriggerController.createWorkflowTrigger(pathParamTriggerId, bodyParam)
      ).toEqual(result);
    });

    it('/Service should return void', async () => {
      const pathParamWorkflowId = generateWorkflowId();
      const bodyParam: CreateWorkflowTriggerRo = {
        workflowId: generateWorkflowId(),
        triggerType: TriggerTypeEnums.RecordCreated,
        inputExpressions: { tableId: 'tblwEp45tdvwTxiUl' },
      };

      expect(
        await workflowTriggerService.createWorkflowTrigger(pathParamWorkflowId, bodyParam)
      ).toMatchObject({
        workflowId: bodyParam.workflowId,
        triggerType: bodyParam.triggerType,
        inputExpressions: JSON.stringify(bodyParam.inputExpressions),
      });
    });
  });
});
