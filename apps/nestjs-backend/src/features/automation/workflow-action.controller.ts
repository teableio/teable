import { Body, Controller, Param, Post, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiResponse, responseWrap } from 'src/utils';
import { CreateWorkflowActionRo } from './model/create-workflow-action.ro';
import { WorkflowActionService } from './workflow-action.service';

@ApiBearerAuth()
@ApiTags('workflowAction')
@Controller('api/workflowAction/:actionId')
export class WorkflowActionController {
  constructor(private readonly workflowActionService: WorkflowActionService) {}

  @Post()
  @ApiOperation({ summary: 'Create workflow action' })
  @ApiBody({
    type: CreateWorkflowActionRo,
  })
  @ApiOkResponse({
    type: ApiResponse<null>,
    isArray: false,
  })
  async createWorkflowAction(
    @Param('actionId') actionId: string,
    @Body() createWorkflowActionRo: CreateWorkflowActionRo
  ) {
    await this.workflowActionService.createWorkflowAction(actionId, createWorkflowActionRo);
    return responseWrap(null);
  }

  @Put()
  @ApiOperation({ summary: 'Update workflow action by id' })
  @ApiParam({
    name: 'actionId',
    description: 'Id of the workflow action',
    example: 'wacRKLYPWS1Hrp0MD',
  })
  async updateWorkflowAction(
    @Param('actionId') actionId: string,
    @Body() updateWorkflowActionRo: CreateWorkflowActionRo
  ) {
    await this.workflowActionService.updateWorkflowAction(actionId, updateWorkflowActionRo);
    return responseWrap(null);
  }
}
