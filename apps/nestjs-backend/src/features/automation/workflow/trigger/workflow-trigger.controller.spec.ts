import { ConsoleLogger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { generateWorkflowId, generateWorkflowTriggerId } from '@teable/core';
import type { AutomationWorkflowTrigger as AutomationWorkflowTriggerModel } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { TriggerTypeEnums } from '../../enums/trigger-type.enum';
import type { CreateWorkflowTriggerRo } from '../../model/create-workflow-trigger.ro';
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
      };
      vi.spyOn(workflowTriggerService, 'create').mockImplementation(
        (_triggerId, _createWorkflowTriggerRo) =>
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

      expect(await workflowTriggerController.create(pathParamTriggerId, bodyParam)).toEqual(result);
    });

    it('/Service should return void', async () => {
      const pathParamWorkflowId = generateWorkflowId();
      const bodyParam: CreateWorkflowTriggerRo = {
        workflowId: generateWorkflowId(),
        triggerType: TriggerTypeEnums.RecordCreated,
      };

      expect(await workflowTriggerService.create(pathParamWorkflowId, bodyParam)).toMatchObject({
        workflowId: bodyParam.workflowId,
        triggerType: bodyParam.triggerType,
      });
    });
  });
});
