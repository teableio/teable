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
import { CreateWorkflowTriggerRo } from '../../model/create-workflow-trigger.ro';
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
  async createWorkflowTrigger(
    @Param('triggerId') triggerId: string,
    @Body() createWorkflowTriggerRo: CreateWorkflowTriggerRo
  ) {
    await this.workflowTriggerService.createWorkflowTrigger(triggerId, createWorkflowTriggerRo);
    return responseWrap(null);
  }

  @Put()
  @ApiOperation({ summary: 'Update workflow trigger by id' })
  @ApiParam({
    name: 'triggerId',
    description: 'Id of the workflow trigger',
    example: 'wtrRKLYPWS1Hrp0MD',
  })
  async updateWorkflowTriggerById(
    @Param('triggerId') triggerId: string,
    @Body() updateWorkflowTriggerRo: CreateWorkflowTriggerRo
  ) {
    await this.workflowTriggerService.updateWorkflowTrigger(triggerId, updateWorkflowTriggerRo);
    return responseWrap(null);
  }
}
