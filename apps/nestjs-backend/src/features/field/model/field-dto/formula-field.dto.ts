import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import {
  assertNever,
  CellValueType,
  DbFieldType,
  FormulaFieldCore,
  Relationship,
} from '@teable-group/core';
import type { IFormulaFieldOptions, ILookupOptionsVo, IFieldRo } from '@teable-group/core';
import { plainToInstance } from 'class-transformer';
import type { IFieldBase } from '../field-base';
import { DatetimeFormattingDto, NumberFormattingDto } from '../formatting.dto';

@ApiExtraModels(DatetimeFormattingDto)
@ApiExtraModels(NumberFormattingDto)
export class FormulaOptionsDto implements IFormulaFieldOptions {
  @ApiProperty({
    description: 'formula expression string',
  })
  expression!: string;

  @ApiPropertyOptional({
    description: 'formatting options for the result of the formula',
    oneOf: [
      { $ref: getSchemaPath(NumberFormattingDto) },
      { $ref: getSchemaPath(DatetimeFormattingDto) },
    ],
  })
  formatting?: NumberFormattingDto;
}

export class FormulaFieldDto extends FormulaFieldCore implements IFieldBase {
  /**
   * @param fieldRo has been modified by prepareFormulaField in field-supplement.service.ts
   * append cellValueType, isMultipleCellValue by parse expression.
   */
  static factory(fieldRo: IFieldRo) {
    const isMultipleCellValue =
      (fieldRo as FormulaFieldDto).isMultipleCellValue ||
      (fieldRo.lookupOptions &&
        (fieldRo.lookupOptions as ILookupOptionsVo).relationship !== Relationship.ManyOne);
    const cellValueType = (fieldRo as FormulaFieldDto).cellValueType || CellValueType.String;

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
      name: fieldRo.name ?? 'Calculation',
      isComputed: true,
      dbFieldType: isMultipleCellValue ? DbFieldType.Json : getDbFieldType(cellValueType),
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
    if (value instanceof Date) {
      return value.toISOString();
    }
    return value;
  }
}
