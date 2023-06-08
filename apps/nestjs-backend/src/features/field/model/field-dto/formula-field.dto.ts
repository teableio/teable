import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CellValueType, FormulaFieldCore, NumberFieldOptions } from '@teable-group/core';
import type { FormulaFieldOptions } from '@teable-group/core';
import type { IFieldBase } from '../field-base';
import { NumberOptionsDto } from './number-field.dto';

export class FormulaOptionsDto implements FormulaFieldOptions {
  @ApiProperty({
    description: 'formula expression string',
  })
  expression!: string;

  @ApiPropertyOptional({
    description: 'formatting options for the result of the formula',
    type: NumberOptionsDto,
  })
  formatting?: NumberFieldOptions;
}

export class FormulaFieldDto extends FormulaFieldCore implements IFieldBase {
  convertCellValue2DBValue(value: unknown): unknown {
    if (this.cellValueType === CellValueType.Array) {
      return value == null ? value : JSON.stringify(value);
    }
    return value;
  }

  convertDBValue2CellValue(value: unknown): unknown {
    if (this.cellValueType === CellValueType.Array) {
      return value == null ? value : JSON.parse(value as string);
    }
    return value;
  }
}
