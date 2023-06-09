import { ApiPropertyOptional } from '@nestjs/swagger';
import { DeploymentStatusEnums } from '../enums/deployment-status.enum';
import type { WorkflowActionVo } from './workflow-action.vo';
import type { WorkflowTriggerVo } from './workflow-trigger.vo';

export class WorkflowVo {
  @ApiPropertyOptional({
    description: 'a unique identifier for the workflow',
    example: 'wflRKLYPWS1Hrp0MD',
  })
  id!: string;

  @ApiPropertyOptional({
    description: 'the name of the workflow',
    example: 'Automation 1',
  })
  name!: string | null;

  @ApiPropertyOptional({
    description: 'description of the workflow',
    example: 'No description',
  })
  description?: string | null;

  @ApiPropertyOptional({
    description: 'state of the workflow',
    enum: DeploymentStatusEnums,
    example: DeploymentStatusEnums.UnDeployed,
  })
  deploymentStatus!: string;

  @ApiPropertyOptional({
    description: 'workflow trigger configuration',
  })
  trigger?: WorkflowTriggerVo | null;

  actions?: { [actionId: string]: WorkflowActionVo } | null;
}
