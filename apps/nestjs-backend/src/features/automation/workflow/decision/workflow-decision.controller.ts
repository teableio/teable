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
import { CreateWorkflowActionRo } from '../../model/create-workflow-action.ro';
import { WorkflowActionService } from '../action/workflow-action.service';

@ApiBearerAuth()
@ApiTags('workflowDecision')
@Controller('api/workflowDecision/:decisionId')
export class WorkflowDecisionController {
  constructor(private readonly workflowActionService: WorkflowActionService) {}

  @Post()
  @ApiOperation({ summary: 'Create workflow decision' })
  @ApiBody({
    type: CreateWorkflowActionRo,
  })
  @ApiOkResponse({
    type: ApiResponse<null>,
    isArray: false,
  })
  async createWorkflowDecision(
    @Param('decisionId') actionId: string,
    @Body() createWorkflowDecisionRo: CreateWorkflowActionRo
  ) {
    await this.workflowActionService.createWorkflowAction(actionId, createWorkflowDecisionRo);
    return responseWrap(null);
  }

  @Put()
  @ApiOperation({ summary: 'Update workflow decision by id' })
  @ApiParam({
    name: 'decisionId',
    description: 'Id of the workflow decisionId',
    example: 'wdeRKLYPWS1Hrp0MD',
  })
  async updateWorkflowDecision(
    @Param('decisionId') actionId: string,
    @Body() updateWorkflowDecisionRo: CreateWorkflowActionRo
  ) {
    await this.workflowActionService.updateWorkflowAction(actionId, updateWorkflowDecisionRo);
    return responseWrap(null);
  }
}
