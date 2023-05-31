import { Body, Controller, Param, Post, Put, Delete } from '@nestjs/common';
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
  async create(
    @Param('decisionId') actionId: string,
    @Body() createWorkflowDecisionRo: CreateWorkflowActionRo
  ) {
    await this.workflowActionService.create(actionId, createWorkflowDecisionRo);
    return responseWrap(null);
  }

  @Delete('delete')
  @ApiOperation({ summary: 'Delete workflow decision' })
  @ApiOkResponse({
    type: ApiResponse<null>,
    isArray: false,
  })
  async delete(@Param('decisionId') decisionId: string) {
    await this.workflowActionService.delete({ actionId: decisionId });
    return responseWrap(null);
  }

  @Put('updateConfig')
  @ApiOperation({ summary: 'Update workflow decision by id' })
  @ApiParam({
    name: 'decisionId',
    description: 'Id of the workflow decisionId',
    example: 'wdeRKLYPWS1Hrp0MD',
  })
  async updateConfig(
    @Param('decisionId') actionId: string,
    @Body() updateWorkflowDecisionRo: CreateWorkflowActionRo
  ) {
    await this.workflowActionService.updateConfig(actionId, updateWorkflowDecisionRo);
    return responseWrap(null);
  }
}
