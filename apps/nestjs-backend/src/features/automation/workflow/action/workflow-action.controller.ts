import { Body, Controller, Param, Post, Put, Delete } from '@nestjs/common';
import { CreateWorkflowActionRo } from '../../model/create-workflow-action.ro';
import { UpdateWorkflowActionRo } from '../../model/update-workflow-action.ro';
import { WorkflowActionService } from './workflow-action.service';

@Controller('api/workflowAction/:actionId')
export class WorkflowActionController {
  constructor(private readonly workflowActionService: WorkflowActionService) {}

  @Post()
  async create(
    @Param('actionId') actionId: string,
    @Body() createWorkflowActionRo: CreateWorkflowActionRo
  ) {
    await this.workflowActionService.create(actionId, createWorkflowActionRo);
    return null;
  }

  @Delete('delete')
  async delete(@Param('actionId') actionId: string) {
    await this.workflowActionService.delete({ actionId });
    return null;
  }

  @Put('updateConfig')
  async updateConfig(
    @Param('actionId') actionId: string,
    @Body() updateRo: UpdateWorkflowActionRo
  ) {
    await this.workflowActionService.updateConfig(actionId, updateRo);
    return null;
  }
}
