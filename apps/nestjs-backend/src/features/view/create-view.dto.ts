import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { IViewBase } from '@teable-group/core';
import { ViewType, IFilter, ISort } from '@teable-group/core';

type IViewDto = Omit<IViewBase, 'id' | 'columns' | 'rows' | 'order'>;

export class CreateViewDto implements IViewDto {
  @ApiProperty({
    description: 'The name of the View.',
    example: 'View1',
  })
  name!: string;

  @ApiProperty({
    description: 'The types supported by teable.',
    example: ViewType.Grid,
  })
  type!: ViewType;

  @ApiPropertyOptional({
    description: 'The description of the View.',
    example: 'this is a summary',
  })
  description?: string;

  @ApiPropertyOptional({
    description: 'The filter options of the View.',
  })
  filter?: IFilter;

  @ApiPropertyOptional({
    description: 'The sort options of the View.',
  })
  sort?: ISort;

  @ApiPropertyOptional({
    example: null,
    description:
      "The configuration options of the View. The structure of the View's options depend on the View's type.",
  })
  options?: IViewDto['options'];
}
