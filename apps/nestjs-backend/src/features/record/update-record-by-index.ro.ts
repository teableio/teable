import { ApiProperty } from '@nestjs/swagger';
import type { IUpdateRecordByIndexRo } from '@teable-group/core';
import { UpdateRecordRo } from './update-record.ro';

export class UpdateRecordRoByIndexRo extends UpdateRecordRo implements IUpdateRecordByIndexRo {
  @ApiProperty({
    description: 'The view where the row is located.',
  })
  viewId!: string;

  @ApiProperty({
    description: 'The row index in the view.',
  })
  index!: number;
}
