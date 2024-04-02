import { ApiPropertyOptional } from '@nestjs/swagger';
import { FieldKeyType } from '@teable/core';

export class CreateWorkflowRo {
  @ApiPropertyOptional({
    description: 'Define the field key type when create and return records',
    example: 'name',
    default: 'name',
    enum: FieldKeyType,
  })
  name!: string;

  @ApiPropertyOptional({
    description: 'description of the workflow',
    example: 'No description',
  })
  description?: string;
}
