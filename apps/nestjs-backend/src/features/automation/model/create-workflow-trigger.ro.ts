import { ApiPropertyOptional } from '@nestjs/swagger';
import { TriggerTypeEnums } from '../enums/trigger-type.enum';

export class CreateWorkflowTriggerRo {
  @ApiPropertyOptional({
    description: 'Id of the workflow to be associated',
    example: 'wflRKLYPWS1Hrp0MD',
  })
  workflowId!: string;

  @ApiPropertyOptional({
    description: 'trigger type',
    enum: TriggerTypeEnums,
    example: TriggerTypeEnums.RecordCreated,
  })
  triggerType!: TriggerTypeEnums;
}
