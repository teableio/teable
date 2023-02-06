import { ApiPropertyOptional } from '@nestjs/swagger';

export class GetFieldsRo {
  @ApiPropertyOptional({
    type: String,
    example: 'viwXXXXXXX',
    description:
      'Set the view you want to fetch, default is first view. result will influent by view options.',
  })
  viewId?: string;
}
