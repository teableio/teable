import { ApiProperty } from '@nestjs/swagger';
import { GridViewCore, RowHeightLevel } from '@teable-group/core';
import type { GridViewOptions } from '@teable-group/core';

export class GridViewOptionsDto implements GridViewOptions {
  @ApiProperty({
    example: RowHeightLevel.Short,
    default: RowHeightLevel.Short,
    description: 'The row height level of row in view',
  })
  rowHeight?: RowHeightLevel;

  @ApiProperty({
    example: 1,
    description: 'The frozen column count in view',
  })
  frozenColumnCount?: number;
}

export class GridViewDto extends GridViewCore {}
