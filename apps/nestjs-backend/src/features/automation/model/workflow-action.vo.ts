import { ApiPropertyOptional } from '@nestjs/swagger';
import { ActionTypeEnums } from '../enums/action-type.enum';

export class WorkflowActionVo {
  @ApiPropertyOptional({
    description: 'workflow action unique identifier',
    example: 'wacGEeKDnQgU8E7V3',
  })
  id!: string;

  @ApiPropertyOptional({
    description: 'type of action',
    enum: ActionTypeEnums,
    example: ActionTypeEnums.Webhook,
  })
  actionType?: ActionTypeEnums | null;

  @ApiPropertyOptional({
    description: 'description of the action',
    enum: ActionTypeEnums,
    example: 'action description',
  })
  description?: string | null;

  @ApiPropertyOptional({
    description: 'unique identifier for the next action',
    example: 'wacGEeKDnQgU8E7V4',
  })
  nextActionId?: string | null;

  @ApiPropertyOptional({
    description: 'action test result',
    example: '...',
  })
  testResult?: unknown;

  @ApiPropertyOptional({
    description: 'action input configuration',
  })
  inputExpressions?: { [key: string]: unknown } | null;
}
