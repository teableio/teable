import { BadRequestException } from '@nestjs/common';
import type {
  IAttachmentItem,
  ILinkCellValue,
  ISelectFieldChoice,
  ISelectFieldOptions,
  UserFieldCore,
} from '@teable/core';
import {
  ColorUtils,
  FieldType,
  generateAttachmentId,
  generateChoiceId,
  IdPrefix,
  nullsToUndefined,
} from '@teable/core';
import type { PrismaService } from '@teable/db-main-prisma';
import { isObject, keyBy, map } from 'lodash';
import { fromZodError } from 'zod-validation-error';
import type { AttachmentsStorageService } from '../attachments/attachments-storage.service';
import type { CollaboratorService } from '../collaborator/collaborator.service';
import type { FieldConvertingService } from '../field/field-calculate/field-converting.service';
import type { IFieldInstance } from '../field/model/factory';
import type { LinkFieldDto } from '../field/model/field-dto/link-field.dto';
import type { MultipleSelectFieldDto } from '../field/model/field-dto/multiple-select-field.dto';
import type { SingleSelectFieldDto } from '../field/model/field-dto/single-select-field.dto';
import { UserFieldDto } from '../field/model/field-dto/user-field.dto';
import type { RecordService } from './record.service';

interface IServices {
  prismaService: PrismaService;
  fieldConvertingService: FieldConvertingService;
  recordService: RecordService;
  attachmentsStorageService: AttachmentsStorageService;
  collaboratorService: CollaboratorService;
}

interface IObjectType {
  id?: string;
  title?: string;
  name?: string;
  email?: string;
}

const convertUser = (input: unknown): string | undefined => {
  if (typeof input === 'string') return input;

  if (Array.isArray(input)) {
    if (input.every((item) => typeof item === 'string')) {
      return input.join();
    }
    if (input.every((item) => typeof item === 'object' && item !== null)) {
      return (
        input
          .map((item) => convertUser(item as IObjectType))
          .filter(Boolean)
          .join() || undefined
      );
    }
    return undefined;
  }

  if (typeof input === 'object' && input !== null) {
    const obj = input as IObjectType;
    return obj.id ?? obj.email ?? obj.title ?? obj.name ?? undefined;
  }

  return undefined;
};

/**
 * Cell type conversion:
 * Because there are some merge operations, we choose column-by-column conversion here.
 */
export class TypeCastAndValidate {
  private readonly services: IServices;
  private readonly field: IFieldInstance;
  private readonly tableId: string;
  private readonly typecast?: boolean;
  private cache: Record<string, unknown> = {};

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
    if (
      !this.field.isComputed &&
      (this.field.type === FieldType.SingleSelect || this.field.type === FieldType.MultipleSelect)
    ) {
      this.cache.choicesMap = keyBy((this.field.options as ISelectFieldOptions).choices, 'name');
    }
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
      case FieldType.User:
        return await this.castToUser(cellValues);
      case FieldType.Attachment:
        return await this.castToAttachment(cellValues);
      case FieldType.Date:
        return await this.castToDate(cellValues);
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
      if (cellValue === undefined) {
        return;
      }
      const validate = this.field.validateCellValue(cellValue);
      if (!validate.success) {
        if (this.typecast) {
          return callBack(cellValue);
        } else {
          throw new BadRequestException(fromZodError(validate.error).message);
        }
      }
      if (this.field.type === FieldType.SingleLineText || this.field.type === FieldType.LongText) {
        return this.field.convertStringToCellValue(validate.data as string);
      }
      return validate.data == null ? null : validate.data;
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
      return value.filter((v) => v != null && v !== '').map((v) => String(v).trim());
    }
    if (typeof value === 'string') {
      return [value.trim()];
    }
    const strValue = String(value);
    if (strValue != null) {
      return [String(value).trim()];
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
    const existsChoicesNameMap = this.cache.choicesMap as Record<string, ISelectFieldChoice>;
    const notExists = choicesNames.filter((name) => !existsChoicesNameMap[name]);
    const colors = ColorUtils.randomColor(map(options.choices, 'color'), notExists.length);
    const newChoices = notExists.map((name, index) => ({
      id: generateChoiceId(),
      name,
      color: colors[index],
    }));

    // TODO: seems not necessary
    const { newField } = await this.services.fieldConvertingService.stageAnalysis(
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

    await this.services.fieldConvertingService.stageAlter(this.tableId, newField, this.field);
  }

  /**
   * Casts the value to a single select option.
   * Creates the option if it does not already exist.
   */
  private async castToSingleSelect(cellValues: unknown[]): Promise<unknown[]> {
    const allValuesSet = new Set<string>();
    const { preventAutoNewOptions } = this.field.options as ISelectFieldOptions;
    const existsChoicesNameMap = this.cache.choicesMap as Record<string, ISelectFieldChoice>;
    const newCellValues = this.mapFieldsCellValuesWithValidate(cellValues, (cellValue: unknown) => {
      const valueArr = this.valueToStringArray(cellValue);
      const newCellValue: string | null = valueArr?.length ? valueArr[0] : null;
      newCellValue && allValuesSet.add(newCellValue);
      return newCellValue;
    }) as string[];

    if (preventAutoNewOptions) {
      return newCellValues
        ? newCellValues.map((v) => (existsChoicesNameMap[v] ? v : null))
        : newCellValues;
    }

    await this.createOptionsIfNotExists([...allValuesSet]);
    return newCellValues;
  }

  private async castToDate(cellValues: unknown[]): Promise<unknown[]> {
    return cellValues.map((cellValue) => {
      if (cellValue === undefined) {
        return;
      }
      const validate = this.field.validateCellValue(cellValue);
      if (!validate.success) {
        return this.field.repair(cellValue);
      }
      return validate.data == null ? null : validate.data;
    });
  }

  /**
   * Casts the value to multiple select options.
   * Creates the option if it does not already exist.
   */
  private async castToMultipleSelect(cellValues: unknown[]): Promise<unknown[]> {
    const allValuesSet = new Set<string>();
    const { preventAutoNewOptions } = this.field.options as ISelectFieldOptions;
    const newCellValues = this.mapFieldsCellValuesWithValidate(cellValues, (cellValue: unknown) => {
      const valueArr =
        typeof cellValue === 'string'
          ? cellValue.split(',').map((s) => s.trim())
          : Array.isArray(cellValue)
            ? cellValue.filter((v) => typeof v === 'string').map((v) => v.trim())
            : null;
      const newCellValue: string[] | null = valueArr?.length ? valueArr : null;
      // collect all options
      newCellValue?.forEach((v) => v && allValuesSet.add(v));
      return newCellValue;
    });

    if (preventAutoNewOptions) {
      const existsChoicesNameMap = this.cache.choicesMap as Record<string, ISelectFieldChoice>;
      return newCellValues
        ? newCellValues.map((v) => {
            if (v && Array.isArray(v)) {
              return (v as string[]).filter((v) => existsChoicesNameMap[v]);
            }
            return v;
          })
        : newCellValues;
    }

    await this.createOptionsIfNotExists([...allValuesSet]);
    return newCellValues;
  }

  /**
   * Casts the value to a link type, link it with another table.
   * Try to find the rows with matching titles from the link table and write them to the cell.
   */
  private async castToLink(cellValues: unknown[]): Promise<unknown[]> {
    const linkRecordMap = this.typecast ? await this.getLinkTableRecordMap(cellValues) : {};
    return this.mapFieldsCellValuesWithValidate(cellValues, (cellValue: unknown) => {
      return this.castToLinkOne(cellValue, linkRecordMap);
    });
  }

  private async castToUser(cellValues: unknown[]): Promise<unknown[]> {
    const ctx = this.typecast
      ? await this.services.collaboratorService.getBaseCollabsWithPrimary(this.tableId)
      : [];

    return this.mapFieldsCellValuesWithValidate(cellValues, (cellValue: unknown) => {
      const strValue = convertUser(cellValue);
      if (strValue) {
        const cv = (this.field as UserFieldCore).convertStringToCellValue(strValue, {
          userSets: ctx,
        });
        if (Array.isArray(cv)) {
          return cv.map(UserFieldDto.fullAvatarUrl);
        }
        return cv ? UserFieldDto.fullAvatarUrl(cv) : cv;
      }
      return null;
    });
  }

  private async castToAttachment(cellValues: unknown[]): Promise<unknown[]> {
    const attachmentItemsMap = this.typecast ? await this.getAttachmentItemMap(cellValues) : {};
    const unsignedValues = this.mapFieldsCellValuesWithValidate(
      cellValues,
      (cellValue: unknown) => {
        const splitValues = typeof cellValue === 'string' ? cellValue.split(',') : cellValue;
        if (Array.isArray(splitValues)) {
          const result = splitValues.map((v) => attachmentItemsMap[v]).filter(Boolean);
          if (result.length) {
            return result;
          }
        }
      }
    );

    const allAttachmentsPromises = unsignedValues.map((cellValues) => {
      const attachmentCellValue = cellValues as (IAttachmentItem & {
        thumbnailPath?: { sm?: string; lg?: string };
      })[];
      if (!attachmentCellValue) {
        return attachmentCellValue;
      }

      return Promise.all(attachmentCellValue);
    });
    return await Promise.all(allAttachmentsPromises);
  }

  /**
   * Get the recordMap of the link table, the format is: {[title]: [id]}.
   * compatible with title, title[], id, id[]
   */
  private async getLinkTableRecordMap(cellValues: unknown[]) {
    const titles = cellValues
      .flat()
      .filter((v) => v != null && typeof v !== 'object')
      .map((v) =>
        typeof v === 'string' && this.field.isMultipleCellValue
          ? v.split(',').map((t) => t.trim())
          : (v as string)
      )
      .flat();

    if (titles.length === 0) {
      return {};
    }

    // id[]
    if (typeof titles[0] === 'string' && titles[0].startsWith('rec')) {
      const linkRecords = await this.services.recordService.getRecordsHeadWithIds(
        (this.field as LinkFieldDto).options.foreignTableId,
        titles
      );
      return keyBy(linkRecords, 'id');
    }

    // title[]
    const linkRecords = await this.services.recordService.getRecordsHeadWithTitles(
      (this.field as LinkFieldDto).options.foreignTableId,
      titles
    );

    return keyBy(linkRecords, 'title');
  }

  private async getAttachmentItemMap(
    cellValues: unknown[]
  ): Promise<Record<string, IAttachmentItem>> {
    // Extract and flatten attachment IDs from cell values
    const attachmentIds = cellValues
      .flat()
      .flatMap((v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()) : []))
      .filter((v) => v.startsWith(IdPrefix.Attachment));

    // Fetch attachment metadata from attachmentsTable
    const attachmentMetadata = await this.services.prismaService.attachmentsTable.findMany({
      where: { attachmentId: { in: attachmentIds } },
      select: { attachmentId: true, token: true, name: true },
    });

    const tokens = attachmentMetadata.map((item) => item.token);
    const metadataMap = keyBy(attachmentMetadata, 'token');

    // Fetch attachment details from attachments table
    const attachmentDetails = await this.services.prismaService.attachments.findMany({
      where: { token: { in: tokens } },
      select: {
        token: true,
        size: true,
        mimetype: true,
        path: true,
        width: true,
        height: true,
      },
    });

    // Combine metadata and details into a single map
    return attachmentDetails.reduce<
      Record<string, IAttachmentItem & { thumbnailPath?: { sm?: string; lg?: string } }>
    >((acc, detail) => {
      const metadata = metadataMap[detail.token];
      acc[metadata.attachmentId] = {
        ...nullsToUndefined(detail),
        name: metadata.name,
        id: generateAttachmentId(),
      };
      return acc;
    }, {});
  }

  /**
   * The conversion of cellValue here is mainly about the difference between filtering null values,
   * returning data based on isMultipleCellValue.
   */
  private castToLinkOne(
    cellValue: unknown,
    linkTableRecordMap: Record<string, { id: string; title?: string }>
  ): ILinkCellValue[] | ILinkCellValue | null {
    const { isMultipleCellValue } = this.field;
    if (isMultipleCellValue) {
      if (typeof cellValue === 'string') {
        return cellValue
          .split(',')
          .map((v) => v.trim())
          .map((v) => linkTableRecordMap[v])
          .filter(Boolean);
      }
      if (Array.isArray(cellValue)) {
        return cellValue
          .map((v) => {
            if (typeof v === 'string') {
              return linkTableRecordMap[v];
            }
            if (isObject(v) && 'id' in v && typeof v.id === 'string') {
              return linkTableRecordMap[v.id];
            }
            return null;
          })
          .filter(Boolean) as ILinkCellValue[];
      }
    }
    return linkTableRecordMap[cellValue as string] || null;
  }
}
