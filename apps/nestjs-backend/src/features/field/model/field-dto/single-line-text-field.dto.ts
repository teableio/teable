import { ApiPropertyOptional } from '@nestjs/swagger';
import type { ISingleLineTextFieldOptions } from '@teable-group/core';
import { SingleLineTextFieldCore } from '@teable-group/core';
import type { IFieldBase } from '../field-base';
import { SingleLineTextShowAsDto } from '../show-as.dto';

export class SingleLineTextOptionsDto implements ISingleLineTextFieldOptions {
  @ApiPropertyOptional({
    type: SingleLineTextShowAsDto,
    description: 'show as options for the result of the text',
  })
  showAs?: SingleLineTextShowAsDto;
}

export class SingleLineTextFieldDto extends SingleLineTextFieldCore implements IFieldBase {
  convertCellValue2DBValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      return JSON.stringify(value);
    }
    return value;
  }

  convertDBValue2CellValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      return value && JSON.parse(value as string);
    }
    return value;
  }
}
