import { ApiPropertyOptional } from '@nestjs/swagger';
import { KanbanViewCore } from '@teable-group/core';
import type { KanbanViewOptions } from '@teable-group/core';

export class KanbanViewOptionsDto implements KanbanViewOptions {
  @ApiPropertyOptional({
    example: 'fldXXXXXXX',
    description: 'The field id of the board group.',
  })
  groupingFieldId!: string;
}

export class KanbanViewDto extends KanbanViewCore {}
