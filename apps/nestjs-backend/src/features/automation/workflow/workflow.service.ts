import { Injectable, Logger } from '@nestjs/common';
import type {
  AutomationWorkflowTrigger as AutomationWorkflowTriggerModel,
  AutomationWorkflow as AutomationWorkflowModel,
  Prisma,
} from '@teable-group/db-main-prisma';
import { PrismaManager } from '@teable-group/db-main-prisma';
import knex from 'knex';
import { keyBy, isEmpty } from 'lodash';
import { PrismaService } from '../../../prisma.service';
import type { TriggerTypeEnums } from '../enums/trigger-type.enum';
import type { CreateWorkflowRo } from '../model/create-workflow.ro';
import { WorkflowVo } from '../model/workflow.vo';
import { WorkflowActionService } from './action/workflow-action.service';
import { WorkflowTriggerService } from './trigger/workflow-trigger.service';

@Injectable()
export class WorkflowService {
  private logger = new Logger(WorkflowService.name);

  private queryBuilder: ReturnType<typeof knex>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly triggerService: WorkflowTriggerService,
    private readonly actionService: WorkflowActionService
  ) {
    this.queryBuilder = knex({ client: 'sqlite3' });
  }

  async getWorkflow(workflowId: string): Promise<WorkflowVo | null> {
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

      const actions = await this.actionService.getWorkflowActions(workflowId);
      result.actions = keyBy(actions, (item) => item.id);
    }
    return result;
  }

  async getWorkflowsByTrigger(
    nodeId: string,
    triggerType?: TriggerTypeEnums[]
  ): Promise<WorkflowVo[] | null> {
    const queryBuilder = this.queryBuilder
      .select('workflow_id as workflowId')
      .from('automation_workflow_trigger')
      .whereRaw("JSON_EXTRACT(input_expressions, '$.tableId.value') = ?", nodeId);

    if (triggerType) {
      queryBuilder.whereIn('trigger_type', triggerType);
    }

    const sqlNative = queryBuilder.toSQL().toNative();
    const queryResult = await this.prisma.$queryRawUnsafe<AutomationWorkflowTriggerModel[]>(
      sqlNative.sql,
      ...sqlNative.bindings
    );

    if (isEmpty(queryResult)) {
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

  async create(
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

  async delete(workflowId: string): Promise<boolean> {
    return await this.prisma.$transaction(async (tx) => {
      const composedTransaction = PrismaManager.extendTransaction(tx) as PrismaService;

      const [triggerDeleted, actionDeleted, workflowDeleted] = await Promise.all([
        this.triggerService.delete({ workflowId }, composedTransaction),
        this.actionService.delete({ workflowId }, composedTransaction),
        (async () => {
          const payload = await tx.automationWorkflow.deleteMany({ where: { workflowId } });
          return payload.count > 0;
        })(),
      ]);

      const check = triggerDeleted && actionDeleted && workflowDeleted;
      if (!check) {
        throw new Error('failed to delete workflow');
      }
      return check;
    });
  }

  async updateConfig(
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
