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
  async create(
    @Param('actionId') actionId: string,
    @Body() createWorkflowActionRo: CreateWorkflowActionRo
  ) {
    await this.workflowActionService.create(actionId, createWorkflowActionRo);
    return responseWrap(null);
  }

  @Delete('delete')
  @ApiOperation({ summary: 'Delete workflow action' })
  @ApiOkResponse({
    type: ApiResponse<null>,
  })
  async delete(@Param('actionId') actionId: string) {
    await this.workflowActionService.delete({ actionId });
    return responseWrap(null);
  }

  @Put('updateConfig')
  @ApiOperation({ summary: 'Update workflow action by id' })
  @ApiParam({
    name: 'actionId',
    description: 'Id of the workflow action',
    example: 'wacRKLYPWS1Hrp0MD',
  })
  async updateConfig(
    @Param('actionId') actionId: string,
    @Body() updateWorkflowActionRo: CreateWorkflowActionRo
  ) {
    await this.workflowActionService.updateConfig(actionId, updateWorkflowActionRo);
    return responseWrap(null);
  }
}
