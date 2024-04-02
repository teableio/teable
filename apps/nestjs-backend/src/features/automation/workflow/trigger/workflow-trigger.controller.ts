import { Body, Controller, Param, Post, Put } from '@nestjs/common';
import { CreateWorkflowTriggerRo } from '../../model/create-workflow-trigger.ro';
import { UpdateWorkflowTriggerRo } from '../../model/update-workflow-trigger.ro';
import { WorkflowTriggerService } from './workflow-trigger.service';

@Controller('api/workflow-trigger/:triggerId')
export class WorkflowTriggerController {
  constructor(private readonly workflowTriggerService: WorkflowTriggerService) {}

  @Post()
  async create(
    @Param('triggerId') triggerId: string,
    @Body() createWorkflowTriggerRo: CreateWorkflowTriggerRo
  ) {
    await this.workflowTriggerService.create(triggerId, createWorkflowTriggerRo);
    return null;
  }

  @Put('update-config')
  async updateConfig(
    @Param('triggerId') triggerId: string,
    @Body() updateRo: UpdateWorkflowTriggerRo
  ) {
    await this.workflowTriggerService.updateConfig(triggerId, updateRo);
    return null;
  }
}
