import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiBody,
  ApiParam,
} from '@nestjs/swagger';
import { ApiResponse, responseWrap } from '../../../utils/api-response';
import { CreateWorkflowRo } from '../model/create-workflow.ro';
import { WorkflowVo } from '../model/workflow.vo';
import { WorkflowService } from './workflow.service';

@ApiBearerAuth()
@ApiTags('workflow')
@Controller('api/workflow/:workflowId')
export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

  @Get()
  @ApiOperation({ summary: 'Get the workflow with the specified id' })
  @ApiOkResponse({
    description: 'workflow',
    type: WorkflowVo,
  })
  async getWorkflow(@Param('workflowId') workflowId: string) {
    const data = await this.workflowService.getWorkflow(workflowId);
    return responseWrap(data);
  }

  @Post()
  @ApiOperation({ summary: 'Create workflow' })
  @ApiBody({
    type: CreateWorkflowRo,
  })
  @ApiOkResponse({
    type: ApiResponse<null>,
    isArray: false,
  })
  async createWorkflow(
    @Param('workflowId') workflowId: string,
    @Body() createWorkflowRo: CreateWorkflowRo
  ) {
    await this.workflowService.createWorkflow(workflowId, createWorkflowRo);
    return responseWrap(null);
  }

  @Put()
  @ApiOperation({ summary: 'Update workflow by id' })
  @ApiParam({
    name: 'workflowId',
    description: 'Id of the workflow',
    example: 'wflRKLYPWS1Hrp0MD',
  })
  async updateWorkflowById(
    @Param('workflowId') workflowId: string,
    @Body() updateWorkflowRo: CreateWorkflowRo
  ) {
    await this.workflowService.updateWorkflow(workflowId, updateWorkflowRo);
    return responseWrap(null);
  }
}
