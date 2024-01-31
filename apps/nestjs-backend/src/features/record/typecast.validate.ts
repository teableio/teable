import { BadRequestException } from '@nestjs/common';
import type { ILinkCellValue } from '@teable/core';
import { ColorUtils, FieldType, generateChoiceId } from '@teable/core';
import type { PrismaService } from '@teable/db-main-prisma';
import { isUndefined, keyBy, map } from 'lodash';
import { fromZodError } from 'zod-validation-error';
import type { FieldConvertingService } from '../field/field-calculate/field-converting.service';
import type { IFieldInstance } from '../field/model/factory';
import type { LinkFieldDto } from '../field/model/field-dto/link-field.dto';
import type { MultipleSelectFieldDto } from '../field/model/field-dto/multiple-select-field.dto';
import type { SingleSelectFieldDto } from '../field/model/field-dto/single-select-field.dto';
import type { RecordService } from './record.service';

interface IServices {
  prismaService: PrismaService;
  fieldConvertingService: FieldConvertingService;
  recordService: RecordService;
}

/**
 * Cell type conversion:
 * Because there are some merge operations, we choose column-by-column conversion here.
 */
export class TypeCastAndValidate {
  private readonly services: IServices;
  private readonly field: IFieldInstance;
  private readonly tableId: string;
  private readonly typecast?: boolean;

  constructor({
    services,
    field,
    typecast,
    tableId,
  }: {
    services: IServices;
    field: IFieldInstance;
    typecast?: boolean;
    tableId: string;
  }) {
    this.services = services;
    this.field = field;
    this.typecast = typecast;
    this.tableId = tableId;
  }

  /**
   * Attempts to cast a cell value to the appropriate type based on the field configuration.
   * Calls the appropriate typecasting method depending on the field type.
   */
  async typecastCellValuesWithField(cellValues: unknown[]) {
    const { type, isComputed } = this.field;
    if (isComputed) {
      return cellValues;
    }
    switch (type) {
      case FieldType.SingleSelect:
        return await this.castToSingleSelect(cellValues);
      case FieldType.MultipleSelect:
        return await this.castToMultipleSelect(cellValues);
      case FieldType.Link: {
        return await this.castToLink(cellValues);
      }
      default:
        return this.defaultCastTo(cellValues);
    }
  }

  private defaultCastTo(cellValues: unknown[]) {
    return this.mapFieldsCellValuesWithValidate(cellValues, (cellValue: unknown) => {
      return this.field.repair(cellValue);
    });
  }

  /**
   * Traverse fieldRecords, and do validation here.
   */
  private mapFieldsCellValuesWithValidate(
    cellValues: unknown[],
    callBack: (cellValue: unknown) => unknown
  ) {
    return cellValues.map((cellValue) => {
      const validate = this.field.validateCellValue(cellValue);
      if (cellValue === undefined) {
        return;
      }
      if (!validate.success) {
        if (this.typecast) {
          return callBack(cellValue);
        } else {
          throw new BadRequestException(fromZodError(validate.error).message);
        }
      }
      return cellValue;
    });
  }

  /**
   * Converts the provided value to a string array.
   * Handles multiple types of input such as arrays, strings, and other types.
   */
  private valueToStringArray(value: unknown): string[] | null {
    if (value == null) {
      return null;
    }
    if (Array.isArray(value)) {
      return value.filter((v) => v != null && v !== '').map(String);
    }
    if (typeof value === 'string') {
      return [value];
    }
    const strValue = String(value);
    if (strValue != null) {
      return [String(value)];
    }
    return null;
  }

  /**
   * Creates select options if they do not already exist in the field.
   * Also updates the field with the newly created options.
   */
  private async createOptionsIfNotExists(choicesNames: string[]) {
    if (!choicesNames.length) {
      return;
    }
    const { id, type, options } = this.field as SingleSelectFieldDto | MultipleSelectFieldDto;
    const existsChoicesNameMap = keyBy(options.choices, 'name');
    const notExists = choicesNames.filter((name) => !existsChoicesNameMap[name]);
    const colors = ColorUtils.randomColor(map(options.choices, 'color'), notExists.length);
    const newChoices = notExists.map((name, index) => ({
      id: generateChoiceId(),
      name,
      color: colors[index],
    }));

    const { newField, modifiedOps } = await this.services.fieldConvertingService.stageAnalysis(
      this.tableId,
      id,
      {
        type,
        options: {
          ...options,
          choices: options.choices.concat(newChoices),
        },
      }
    );

    await this.services.fieldConvertingService.stageAlter(
      this.tableId,
      newField,
      this.field,
      modifiedOps
    );
  }

  /**
   * Casts the value to a single select option.
   * Creates the option if it does not already exist.
   */
  private async castToSingleSelect(cellValues: unknown[]): Promise<unknown[]> {
    const allValuesSet = new Set<string>();
    const newCellValues = this.mapFieldsCellValuesWithValidate(cellValues, (cellValue: unknown) => {
      const valueArr = this.valueToStringArray(cellValue);
      const newCellValue: string | null = valueArr?.length ? valueArr[0] : null;
      newCellValue && allValuesSet.add(newCellValue);
      return newCellValue;
    });
    await this.createOptionsIfNotExists([...allValuesSet]);
    return newCellValues;
  }

  /**
   * Casts the value to multiple select options.
   * Creates the option if it does not already exist.
   */
  private async castToMultipleSelect(cellValues: unknown[]): Promise<unknown[]> {
    const allValuesSet = new Set<string>();
    const newCellValues = this.mapFieldsCellValuesWithValidate(cellValues, (cellValue: unknown) => {
      const valueArr = this.valueToStringArray(cellValue);
      const newCellValue: string[] | null = valueArr?.length ? valueArr : null;
      // collect all options
      newCellValue?.forEach((v) => v && allValuesSet.add(v));
      return newCellValue;
    });
    await this.createOptionsIfNotExists([...allValuesSet]);
    return newCellValues;
  }

  /**
   * Casts the value to a link type, associating it with another table.
   * Try to find the rows with matching titles from the associated table and write them to the cell.
   */
  private async castToLink(cellValues: unknown[]): Promise<unknown[]> {
    const linkRecordMap = this.typecast ? await this.getLinkTableRecordMap(cellValues) : {};
    return this.mapFieldsCellValuesWithValidate(cellValues, (cellValue: unknown) => {
      const newCellValue: ILinkCellValue[] | ILinkCellValue | null = this.castToLinkOne(
        cellValue,
        linkRecordMap
      );
      return newCellValue;
    });
  }

  /**
   * Get the recordMap of the associated table, the format is: {[title]: [id]}.
   */
  private async getLinkTableRecordMap(cellValues: unknown[]) {
    const titles = cellValues.flat().filter(Boolean) as string[];

    const linkRecords = await this.services.recordService.getRecordsWithPrimary(
      (this.field as LinkFieldDto).options.foreignTableId,
      titles
    );

    return linkRecords.reduce(
      (result, { id, title }) => {
        if (!result[title]) {
          result[title] = id;
        }
        return result;
      },
      {} as Record<string, string>
    );
  }

  /**
   * The conversion of cellValue here is mainly about the difference between filtering null values,
   * returning data based on isMultipleCellValue.
   */
  private castToLinkOne(
    value: unknown,
    linkTableRecordMap: Record<string, string>
  ): ILinkCellValue[] | ILinkCellValue | null {
    const { isMultipleCellValue } = this.field;
    let valueArr = this.valueToStringArray(value);
    if (!valueArr?.length) {
      return null;
    }
    valueArr = isMultipleCellValue ? valueArr : valueArr.slice(0, 1);
    const valueArrNotEmpty = valueArr.map(String).filter((v) => v !== undefined || v !== '');
    const result = valueArrNotEmpty
      .map((v) => ({ title: v, id: linkTableRecordMap[v] }))
      .filter((v) => !isUndefined(v.id)) as ILinkCellValue[];
    return isMultipleCellValue ? result : result[0] ?? null;
  }
}
