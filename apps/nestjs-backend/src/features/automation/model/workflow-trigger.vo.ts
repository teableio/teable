import { ApiPropertyOptional } from '@nestjs/swagger';
import { TriggerTypeEnums } from '../enums/trigger-type.enum';

export class WorkflowTriggerVo {
  @ApiPropertyOptional({
    description: 'a unique identifier for the workflow trigger',
    example: 'wtrRKLYPWS1Hrp0MD',
  })
  id!: string;

  @ApiPropertyOptional({
    description: 'trigger type',
    enum: TriggerTypeEnums,
    example: TriggerTypeEnums.RecordCreated,
  })
  triggerType!: TriggerTypeEnums;

  @ApiPropertyOptional({
    description: 'trigger input configuration',
    example: {
      tableId: 'tblwEp45tdvwTxiUl',
    },
  })
  inputExpressions!: { [key: string]: unknown };
}
