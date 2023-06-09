import { ApiPropertyOptional } from '@nestjs/swagger';
import { ActionTypeEnums } from '../enums/action-type.enum';
import { MoveWorkflowActionRo } from './move-workflow-action.ro';

export class CreateWorkflowActionRo extends MoveWorkflowActionRo {
  @ApiPropertyOptional({
    description: 'Id of the workflow to be associated',
    example: 'wflRKLYPWS1Hrp0MD',
  })
  workflowId!: string;

  @ApiPropertyOptional({
    description: 'type of action',
    enum: ActionTypeEnums,
    example: ActionTypeEnums.Webhook,
  })
  actionType?: ActionTypeEnums;
}
