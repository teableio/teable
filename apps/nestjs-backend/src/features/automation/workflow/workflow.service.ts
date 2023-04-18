import { Injectable, Logger } from '@nestjs/common';
import type {
  Prisma,
  AutomationWorkflow as AutomationWorkflowModel,
  AutomationWorkflowTrigger as AutomationWorkflowTriggerModel,
} from '@teable-group/db-main-prisma';
import _ from 'lodash';
import type { TriggerTypeEnums } from 'src/features/automation/enums/trigger-type.enum';
import { PrismaService } from '../../../prisma.service';
import type { CreateWorkflowRo } from '../model/create-workflow.ro';
import { WorkflowVo } from '../model/workflow.vo';
import { WorkflowActionService } from '../workflow-action/workflow-action.service';
import { WorkflowTriggerService } from '../workflow-trigger/workflow-trigger.service';

@Injectable()
export class WorkflowService {
  private logger = new Logger(WorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly triggerService: WorkflowTriggerService,
    private readonly actionService: WorkflowActionService
  ) {}

  public async getWorkflow(workflowId: string): Promise<WorkflowVo | null> {
    const workflow = await this.prisma.automationWorkflow.findFirst({
      where: { workflowId: workflowId },
    });

    if (!workflow) {
      return null;
    }

    const result = new WorkflowVo();
    result.id = workflow.workflowId;
    result.name = workflow.name;
    result.description = workflow.description;
    result.deploymentStatus = workflow.deploymentStatus;

    const trigger = await this.triggerService.getWorkflowTrigger(workflowId);
    if (trigger) {
      result.trigger = trigger;
      const actions = await this.actionService.getWorkflowActions(workflowId, trigger.id);
      result.actions = _.keyBy(actions, (item) => item.id);
    }
    return result;
  }

  public async getWorkflowsByTrigger(
    nodeId: string,
    trigger: TriggerTypeEnums
  ): Promise<WorkflowVo[] | null> {
    const queryResult: AutomationWorkflowTriggerModel[] = await this.prisma
      .$queryRaw`SELECT workflow_id as workflowId
                 FROM automation_workflow_trigger
                 WHERE trigger_type = ${trigger}
                   AND json_extract(input_expressions, '$.tableId') = ${nodeId}`;

    if (_.isEmpty(queryResult)) {
      return null;
    }

    // FIXME: This is a bad taste
    const result: WorkflowVo[] | null = [];
    for (const { workflowId } of queryResult!) {
      const data = await this.getWorkflow(workflowId);
      if (data) {
        result.push(data);
      }
    }

    return result;
  }

  public async createWorkflow(
    workflowId: string,
    createWorkflowRo: CreateWorkflowRo
  ): Promise<AutomationWorkflowModel> {
    const data: Prisma.AutomationWorkflowCreateInput = {
      workflowId: workflowId,
      name: createWorkflowRo.name,
      description: createWorkflowRo.description,
      createdBy: 'admin',
      lastModifiedBy: 'admin',
    };

    return this.prisma.automationWorkflow.create({ data });
  }

  public async updateWorkflow(
    workflowId: string,
    updateWorkflowRo: CreateWorkflowRo
  ): Promise<AutomationWorkflowModel> {
    const where: Prisma.AutomationWorkflowWhereUniqueInput = {
      workflowId: workflowId,
    };

    const data: Prisma.AutomationWorkflowUpdateInput = {
      name: updateWorkflowRo.name,
      description: updateWorkflowRo.description,
    };

    return this.prisma.automationWorkflow.update({ where, data });
  }
}
