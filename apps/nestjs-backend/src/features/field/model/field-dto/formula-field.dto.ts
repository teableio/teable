import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  assertNever,
  CellValueType,
  DbFieldType,
  FormulaFieldCore,
  NumberFieldOptions,
  Relationship,
} from '@teable-group/core';
import type { FormulaFieldOptions } from '@teable-group/core';
import { plainToInstance } from 'class-transformer';
import type { CreateFieldRo } from '../create-field.ro';
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
  /**
   * @param fieldRo has been modified by prepareFormulaField in field-supplement.service.ts
   * append cellValueType, isMultipleCellValue by parse expression.
   */
  static factory(fieldRo: CreateFieldRo) {
    const isMultipleCellValue =
      (fieldRo as FormulaFieldDto).isMultipleCellValue ||
      (fieldRo.lookupOptions && fieldRo.lookupOptions.relationShip !== Relationship.ManyOne);
    const cellValueType = (fieldRo as FormulaFieldDto).cellValueType;

    function getDbFieldType(cellValueType: CellValueType) {
      switch (cellValueType) {
        case CellValueType.Number:
          return DbFieldType.Real;
        case CellValueType.DateTime:
          return DbFieldType.DateTime;
        case CellValueType.Boolean:
          return DbFieldType.Integer;
        case CellValueType.String:
          return DbFieldType.Text;
        default:
          assertNever(cellValueType);
      }
    }

    return plainToInstance(FormulaFieldDto, {
      ...fieldRo,
      isComputed: true,
      dbFieldType: isMultipleCellValue ? DbFieldType.Text : getDbFieldType(cellValueType),
      isMultipleCellValue,
    } as FormulaFieldDto);
  }

  convertCellValue2DBValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      return value == null ? value : JSON.stringify(value);
    }
    return value;
  }

  convertDBValue2CellValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      return value == null ? value : JSON.parse(value as string);
    }
    return value;
  }
}
