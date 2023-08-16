import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import {
  assertNever,
  CellValueType,
  DbFieldType,
  RollupFieldCore,
  Relationship,
} from '@teable-group/core';
import type { IRollupFieldOptions, ILookupOptionsVo, IFieldRo } from '@teable-group/core';
import { plainToInstance } from 'class-transformer';
import type { IFieldBase } from '../field-base';
import { DatetimeFormattingDto, NumberFormattingDto } from '../formatting.dto';
import { MultiNumberShowAsDto, SingleNumberShowAsDto } from '../show-as.dto';

@ApiExtraModels(DatetimeFormattingDto)
@ApiExtraModels(NumberFormattingDto)
export class RollupOptionsDto implements IRollupFieldOptions {
  @ApiProperty({
    description: 'formula expression string',
  })
  expression!: IRollupFieldOptions['expression'];

  @ApiPropertyOptional({
    description: 'formatting options for the result of the rollup',
    oneOf: [
      { $ref: getSchemaPath(NumberFormattingDto) },
      { $ref: getSchemaPath(DatetimeFormattingDto) },
    ],
  })
  formatting?: NumberFormattingDto;

  @ApiPropertyOptional({
    description: 'show as options for the result of the rollup',
    oneOf: [
      { $ref: getSchemaPath(SingleNumberShowAsDto) },
      { $ref: getSchemaPath(MultiNumberShowAsDto) },
    ],
  })
  showAs?: SingleNumberShowAsDto;
}

export class RollupFieldDto extends RollupFieldCore implements IFieldBase {
  /**
   * @param fieldRo has been modified by prepareRollupField in field-supplement.service.ts
   * append cellValueType, isMultipleCellValue by parse expression.
   *
   * when lookup field has been lookup, the lookupOptions is for pure lookup logic, without rollup calculation
   */
  static factory(fieldRo: IFieldRo) {
    const isMultipleCellValue =
      (fieldRo as RollupFieldDto).isMultipleCellValue ||
      (fieldRo.isLookup &&
        (fieldRo.lookupOptions as ILookupOptionsVo)?.relationship !== Relationship.ManyOne);
    const cellValueType = (fieldRo as RollupFieldDto).cellValueType || CellValueType.String;

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

    return plainToInstance(RollupFieldDto, {
      ...fieldRo,
      isComputed: true,
      dbFieldType: isMultipleCellValue ? DbFieldType.Json : getDbFieldType(cellValueType),
      isMultipleCellValue,
    } as RollupFieldDto);
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
