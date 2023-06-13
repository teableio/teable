import { Body, Controller, Param, Post, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiResponse, responseWrap } from '../../../../utils';
import { CreateWorkflowTriggerRo } from '../../model/create-workflow-trigger.ro';
import { UpdateWorkflowTriggerRo } from '../../model/update-workflow-trigger.ro';
import { WorkflowTriggerService } from './workflow-trigger.service';

@ApiBearerAuth()
@ApiTags('workflowTrigger')
@Controller('api/workflowTrigger/:triggerId')
export class WorkflowTriggerController {
  constructor(private readonly workflowTriggerService: WorkflowTriggerService) {}

  @Post()
  @ApiOperation({ summary: 'Create workflow trigger' })
  @ApiBody({
    type: CreateWorkflowTriggerRo,
  })
  @ApiOkResponse({
    type: ApiResponse<null>,
    isArray: false,
  })
  async create(
    @Param('triggerId') triggerId: string,
    @Body() createWorkflowTriggerRo: CreateWorkflowTriggerRo
  ) {
    await this.workflowTriggerService.create(triggerId, createWorkflowTriggerRo);
    return responseWrap(null);
  }

  @Put('updateConfig')
  @ApiOperation({ summary: 'Update workflow trigger by id' })
  @ApiParam({
    name: 'triggerId',
    description: 'Id of the workflow trigger',
    example: 'wtrRKLYPWS1Hrp0MD',
  })
  async updateConfig(
    @Param('triggerId') triggerId: string,
    @Body() updateRo: UpdateWorkflowTriggerRo
  ) {
    await this.workflowTriggerService.updateConfig(triggerId, updateRo);
    return responseWrap(null);
  }
}
