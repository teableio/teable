import { Body, Controller, Get, Param, Post, Put, Delete } from '@nestjs/common';
import { CreateWorkflowRo } from '../model/create-workflow.ro';
import { WorkflowService } from './workflow.service';

@Controller('api/workflow/:workflowId')
export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

  @Get()
  async getWorkflow(@Param('workflowId') workflowId: string) {
    return await this.workflowService.getWorkflow(workflowId);
  }

  @Post()
  async create(
    @Param('workflowId') workflowId: string,
    @Body() createWorkflowRo: CreateWorkflowRo
  ) {
    return await this.workflowService.create(workflowId, createWorkflowRo);
  }

  @Delete('delete')
  async delete(@Param('workflowId') workflowId: string) {
    return await this.workflowService.delete(workflowId);
  }

  @Put('update-config')
  async updateConfig(
    @Param('workflowId') workflowId: string,
    @Body() updateWorkflowRo: CreateWorkflowRo
  ) {
    await this.workflowService.updateConfig(workflowId, updateWorkflowRo);
    return null;
  }
}
