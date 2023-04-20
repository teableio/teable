import { ApiProperty } from '@nestjs/swagger';
import type { IViewVo } from '@teable-group/core';
import { CreateViewRo } from './create-view.ro';

export class ViewVo extends CreateViewRo implements IViewVo {
  @ApiProperty({
    description: 'The id of the view.',
    example: 'viwXXXXXXXX',
  })
  id!: string;

  @ApiProperty({
    description: 'The order config of the view.',
  })
  order!: number;
}
