import { Body, Controller, Param, Post, Put, Delete } from '@nestjs/common';
import { CreateWorkflowActionRo } from '../../model/create-workflow-action.ro';
import { UpdateWorkflowActionRo } from '../../model/update-workflow-action.ro';
import { WorkflowActionService } from '../action/workflow-action.service';

@Controller('api/workflowDecision/:decisionId')
export class WorkflowDecisionController {
  constructor(private readonly workflowActionService: WorkflowActionService) {}

  @Post()
  async create(@Param('decisionId') actionId: string, @Body() createRo: CreateWorkflowActionRo) {
    await this.workflowActionService.create(actionId, createRo);
    return null;
  }

  @Delete('delete')
  async delete(@Param('decisionId') decisionId: string) {
    await this.workflowActionService.delete({ actionId: decisionId });
    return null;
  }

  @Put('updateConfig')
  async updateConfig(
    @Param('decisionId') actionId: string,
    @Body() updateRo: UpdateWorkflowActionRo
  ) {
    await this.workflowActionService.updateConfig(actionId, updateRo);
    return null;
  }
}
