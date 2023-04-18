import type { AutomationWorkflowTrigger as AutomationWorkflowTriggerModel } from '.prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@teable-group/db-main-prisma';
import type { TriggerTypeEnums } from 'src/features/automation/enums/trigger-type.enum';
import { PrismaService } from '../../../prisma.service';
import type { CreateWorkflowTriggerRo } from '../model/create-workflow-trigger.ro';
import { WorkflowTriggerVo } from '../model/workflow-trigger.vo';

@Injectable()
export class WorkflowTriggerService {
  private logger = new Logger(WorkflowTriggerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getWorkflowTrigger(workflowId: string): Promise<WorkflowTriggerVo | null> {
    const triggerData = await this.prisma.automationWorkflowTrigger.findFirst({
      where: { workflowId },
    });
    if (!triggerData) {
      return null;
    }

    const result = new WorkflowTriggerVo();
    result.id = triggerData.triggerId;
    result.triggerType = triggerData.triggerType as TriggerTypeEnums;
    result.inputExpressions = triggerData.inputExpressions
      ? JSON.parse(triggerData.inputExpressions)
      : null;

    return result;
  }

  public async createWorkflowTrigger(
    triggerId: string,
    createWorkflowTriggerRo: CreateWorkflowTriggerRo
  ): Promise<AutomationWorkflowTriggerModel> {
    const data: Prisma.AutomationWorkflowTriggerCreateInput = {
      workflowId: createWorkflowTriggerRo.workflowId,
      triggerId: triggerId,
      triggerType: createWorkflowTriggerRo.triggerType,
      inputExpressions: JSON.stringify(createWorkflowTriggerRo.inputExpressions),
      createdBy: 'admin',
      lastModifiedBy: 'admin',
    };

    return this.prisma.automationWorkflowTrigger.create({ data });
  }

  public async updateWorkflowTrigger(
    triggerId: string,
    updateWorkflowTriggerRo: CreateWorkflowTriggerRo
  ): Promise<AutomationWorkflowTriggerModel> {
    const where: Prisma.AutomationWorkflowTriggerWhereUniqueInput = {
      triggerId: triggerId,
    };

    const data: Prisma.AutomationWorkflowTriggerUpdateInput = {
      triggerType: updateWorkflowTriggerRo.triggerType,
      inputExpressions: JSON.stringify(updateWorkflowTriggerRo.inputExpressions),
    };

    return this.prisma.automationWorkflowTrigger.update({ where, data });
  }
}
