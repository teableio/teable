import { ApiProperty } from '@nestjs/swagger';
import { FormViewCore } from '@teable-group/core';
import type { FormViewOptions } from '@teable-group/core';

export class FormViewOptionsDto implements FormViewOptions {
  @ApiProperty({
    description: 'The cover url of the form',
  })
  coverUrl?: string;
}

export class FormViewDto extends FormViewCore {}
