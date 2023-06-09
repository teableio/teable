import { Injectable, Logger } from '@nestjs/common';
import type { IEitherOr } from '@teable-group/core';
import type {
  Prisma,
  AutomationWorkflowTrigger as AutomationWorkflowTriggerModel,
} from '@teable-group/db-main-prisma';
import { PrismaService } from '../../../../prisma.service';
import type { TriggerTypeEnums } from '../../enums/trigger-type.enum';
import type { CreateWorkflowTriggerRo } from '../../model/create-workflow-trigger.ro';
import type { UpdateWorkflowTriggerRo } from '../../model/update-workflow-trigger.ro';
import { WorkflowTriggerVo } from '../../model/workflow-trigger.vo';

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

  async create(
    triggerId: string,
    createWorkflowTriggerRo: CreateWorkflowTriggerRo
  ): Promise<AutomationWorkflowTriggerModel> {
    const data: Prisma.AutomationWorkflowTriggerCreateInput = {
      workflowId: createWorkflowTriggerRo.workflowId,
      triggerId: triggerId,
      triggerType: createWorkflowTriggerRo.triggerType,
      createdBy: 'admin',
      lastModifiedBy: 'admin',
    };

    return this.prisma.automationWorkflowTrigger.create({ data });
  }

  async delete(
    id: IEitherOr<{ triggerId: string; workflowId: string }, 'triggerId', 'workflowId'>,
    prisma?: PrismaService
  ): Promise<boolean> {
    const { triggerId, workflowId } = id;

    const result = await (prisma || this.prisma).$transaction(async (tx) => {
      return tx.automationWorkflowTrigger.deleteMany({
        where: { triggerId, OR: { workflowId } },
      });
    });

    return result.count > 0;
  }

  async updateConfig(
    triggerId: string,
    updateRo: UpdateWorkflowTriggerRo
  ): Promise<AutomationWorkflowTriggerModel> {
    const where: Prisma.AutomationWorkflowTriggerWhereUniqueInput = {
      triggerId: triggerId,
    };

    const data: Prisma.AutomationWorkflowTriggerUpdateInput = {
      inputExpressions: JSON.stringify(updateRo.inputExpressions),
    };

    return this.prisma.automationWorkflowTrigger.update({ where, data });
  }

  async updateTriggerType() {
    return;
  }
}
