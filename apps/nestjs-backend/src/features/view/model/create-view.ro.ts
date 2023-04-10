import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import type { IViewRo } from '@teable-group/core';
import { ViewType, IFilter, ISort, IGroup } from '@teable-group/core';
import { GridViewOptionsDto } from './grid-view.dto';
import { KanbanViewOptionsDto } from './kanban-view.dto';

@ApiExtraModels(GridViewOptionsDto)
@ApiExtraModels(KanbanViewOptionsDto)
export class CreateViewRo implements IViewRo {
  @ApiProperty({
    description: 'The name of the view.',
    example: 'Grid view',
  })
  name!: string;

  @ApiProperty({
    description: 'The description of the view.',
    example: 'this view show all records',
  })
  description?: string;

  @ApiProperty({
    description: 'The view type supported by teable.',
    example: ViewType.Grid,
  })
  type!: ViewType;

  @ApiPropertyOptional({
    description: 'The filter config of the view.',
  })
  filter?: IFilter;

  @ApiPropertyOptional({
    description: 'The sort config of the view.',
  })
  sort?: ISort;

  @ApiPropertyOptional({
    description: 'The group config of the view.',
  })
  group?: IGroup;

  @ApiPropertyOptional({
    description:
      "The configuration options of the View. The structure of the View's options depend on the View's type.",
    oneOf: [
      { $ref: getSchemaPath(GridViewOptionsDto) },
      { $ref: getSchemaPath(KanbanViewOptionsDto) },
    ],
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options?: any;
}
