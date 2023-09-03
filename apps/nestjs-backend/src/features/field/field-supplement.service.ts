/* eslint-disable sonarjs/no-duplicate-string */
import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  IFieldRo,
  IFieldVo,
  IFormulaFieldOptions,
  ILinkFieldOptions,
  ILookupOptionsVo,
  INumberFieldOptions,
  IRollupFieldOptions,
} from '@teable-group/core';
import {
  CellValueType,
  getDefaultFormatting,
  FieldType,
  generateFieldId,
  Relationship,
  RelationshipRevert,
  DbFieldType,
  assertNever,
  SingleLineTextFieldCore,
  NumberFieldCore,
  SelectFieldCore,
  AttachmentFieldCore,
  DateFieldCore,
  CheckboxFieldCore,
} from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '@teable-group/db-main-prisma';
import knex from 'knex';
import { keyBy } from 'lodash';
import type { ISupplementService } from '../../share-db/interface';
import { FieldService } from './field.service';
import type { IFieldInstance } from './model/factory';
import { createFieldInstanceByVo, createFieldInstanceByRaw } from './model/factory';
import { FormulaFieldDto } from './model/field-dto/formula-field.dto';
import type { LinkFieldDto } from './model/field-dto/link-field.dto';
import { RollupFieldDto } from './model/field-dto/rollup-field.dto';

@Injectable()
export class FieldSupplementService implements ISupplementService {
  private readonly knex = knex({ client: 'sqlite3' });
  constructor(
    private readonly prismaService: PrismaService,
    private readonly fieldService: FieldService
  ) {}

  private async getDbTableName(prisma: Prisma.TransactionClient, tableId: string) {
    const tableMeta = await prisma.tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });
    return tableMeta.dbTableName;
  }

  private getForeignKeyFieldName(fieldId: string) {
    return `__fk_${fieldId}`;
  }

  private async getDefaultLinkName(foreignTableId: string) {
    const tableRaw = await this.prismaService.tableMeta.findUnique({
      where: { id: foreignTableId },
      select: { name: true },
    });
    if (!tableRaw) {
      throw new BadRequestException(`foreignTableId ${foreignTableId} is invalid`);
    }
    return tableRaw.name;
  }

  private async prepareLinkField(field: IFieldRo) {
    const { relationship, foreignTableId } = field.options as LinkFieldDto['options'];
    const { id: lookupFieldId } = await this.prismaService.field.findFirstOrThrow({
      where: { tableId: foreignTableId, isPrimary: true },
      select: { id: true },
    });
    const fieldId = field.id ?? generateFieldId();
    const symmetricFieldId = generateFieldId();
    let dbForeignKeyName = '';
    if (relationship === Relationship.ManyOne) {
      dbForeignKeyName = this.getForeignKeyFieldName(fieldId);
    }
    if (relationship === Relationship.OneMany) {
      dbForeignKeyName = this.getForeignKeyFieldName(symmetricFieldId);
    }

    const isMultipleCellValue =
      relationship !== Relationship.ManyOne ||
      (field.lookupOptions &&
        (field.lookupOptions as ILookupOptionsVo).relationship !== Relationship.ManyOne);

    return {
      ...field,
      id: fieldId,
      name: field.name ?? (await this.getDefaultLinkName(foreignTableId)),
      options: {
        relationship,
        foreignTableId,
        lookupFieldId,
        dbForeignKeyName,
        symmetricFieldId,
      },
      isMultipleCellValue,
      isComputed: field.isLookup,
      dbFieldType: DbFieldType.Json,
      cellValueType: CellValueType.String,
    };
  }

  private async prepareLookupOptions(field: IFieldRo, batchFieldVos?: IFieldVo[]) {
    const { lookupOptions } = field;
    if (!lookupOptions) {
      throw new BadRequestException('lookupOptions is required');
    }

    const { linkFieldId, lookupFieldId, foreignTableId } = lookupOptions;
    const linkFieldRaw = await this.prismaService.field.findFirst({
      where: { id: linkFieldId, deletedTime: null, type: FieldType.Link },
      select: { name: true, options: true, isMultipleCellValue: true },
    });

    const optionsRaw = linkFieldRaw?.options || null;
    const linkFieldOptions: ILinkFieldOptions =
      (optionsRaw && JSON.parse(optionsRaw as string)) ||
      batchFieldVos?.find((field) => field.id === linkFieldId)?.options;

    if (!linkFieldOptions || !linkFieldRaw) {
      throw new BadRequestException(`linkFieldId ${linkFieldId} is invalid`);
    }

    if (foreignTableId !== linkFieldOptions.foreignTableId) {
      throw new BadRequestException(`foreignTableId ${foreignTableId} is invalid`);
    }

    const lookupFieldRaw = await this.prismaService.field.findFirst({
      where: { id: lookupFieldId, deletedTime: null },
    });

    if (!lookupFieldRaw) {
      throw new BadRequestException(`Lookup field ${lookupFieldId} is not exist`);
    }

    return {
      lookupOptions: {
        linkFieldId,
        lookupFieldId,
        foreignTableId,
        relationship: linkFieldOptions.relationship,
        dbForeignKeyName: linkFieldOptions.dbForeignKeyName,
      },
      lookupFieldRaw,
      linkFieldRaw,
    };
  }

  getDbFieldType(
    fieldType: FieldType,
    cellValueType: CellValueType,
    isMultipleCellValue?: boolean
  ) {
    if (isMultipleCellValue) {
      return DbFieldType.Json;
    }

    if (fieldType === FieldType.Link) {
      return DbFieldType.Json;
    }

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

  private async prepareLookupField(field: IFieldRo, batchFieldVos?: IFieldVo[]) {
    const { lookupOptions, lookupFieldRaw, linkFieldRaw } = await this.prepareLookupOptions(
      field,
      batchFieldVos
    );

    if (lookupFieldRaw.type !== field.type) {
      throw new BadRequestException(
        `Current field type ${field.type} is not equal to lookup field (${lookupFieldRaw.type})`
      );
    }

    const isMultipleCellValue =
      linkFieldRaw.isMultipleCellValue || lookupFieldRaw.isMultipleCellValue || false;

    const lookupCellValueType = lookupFieldRaw.cellValueType;
    const lookupFieldOptions = JSON.parse(lookupFieldRaw.options as string) as object | null;
    const formatting =
      (field.options as INumberFieldOptions)?.formatting ??
      getDefaultFormatting(lookupCellValueType as CellValueType);
    const showAs = (field.options as INumberFieldOptions)?.showAs;
    let options = lookupFieldOptions ? { ...lookupFieldOptions } : undefined;

    if (options) {
      if (formatting) {
        options = { ...lookupFieldOptions, formatting };
      }
      if (showAs || lookupCellValueType === CellValueType.Number) {
        options = { ...options, showAs };
      }
    }

    return {
      ...field,
      name: field.name ?? `${lookupFieldRaw.name} (from ${linkFieldRaw.name})`,
      options,
      lookupOptions,
      isMultipleCellValue,
      isComputed: field.isLookup,
      cellValueType: lookupCellValueType,
      dbFieldType: this.getDbFieldType(
        field.type,
        lookupCellValueType as CellValueType,
        isMultipleCellValue
      ),
    };
  }

  private async prepareFormulaField(field: IFieldRo, batchFieldVos?: IFieldVo[]) {
    let fieldIds;
    try {
      fieldIds = FormulaFieldDto.getReferenceFieldIds(
        (field.options as IFormulaFieldOptions).expression
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      throw new BadRequestException('expression parse error');
    }

    const fieldRaws = await this.prismaService.field.findMany({
      where: { id: { in: fieldIds }, deletedTime: null },
    });

    const fields = fieldRaws.map((fieldRaw) => createFieldInstanceByRaw(fieldRaw));
    const batchFields = batchFieldVos?.map((fieldVo) => createFieldInstanceByVo(fieldVo));
    const fieldMap = keyBy(fields.concat(batchFields || []), 'id');

    if (fieldIds.find((id) => !fieldMap[id])) {
      throw new BadRequestException(`formula field reference ${fieldIds.join()} not found`);
    }

    const { cellValueType, isMultipleCellValue } = FormulaFieldDto.getParsedValueType(
      (field.options as IFormulaFieldOptions).expression,
      fieldMap
    );

    const showAs = (field.options as IFormulaFieldOptions)?.showAs;
    const formatting =
      (field.options as IFormulaFieldOptions)?.formatting ?? getDefaultFormatting(cellValueType);
    let options = formatting ? { ...field.options, formatting } : field.options;
    options = showAs || cellValueType === CellValueType.Number ? { ...options, showAs } : options;

    return {
      ...field,
      name: field.name ?? 'Calculation',
      options,
      cellValueType,
      isMultipleCellValue,
      isComputed: true,
      dbFieldType: this.getDbFieldType(
        field.type,
        cellValueType as CellValueType,
        isMultipleCellValue
      ),
    };
  }

  private async prepareRollupField(field: IFieldRo, batchFieldVos?: IFieldVo[]) {
    const { lookupOptions, linkFieldRaw, lookupFieldRaw } = await this.prepareLookupOptions(
      field,
      batchFieldVos
    );
    const options = field.options as IRollupFieldOptions;
    const lookupField = createFieldInstanceByRaw(lookupFieldRaw);
    if (!options) {
      throw new BadRequestException('rollup field options is required');
    }

    let valueType;
    try {
      valueType = RollupFieldDto.getParsedValueType(
        options.expression,
        lookupField,
        lookupField.isMultipleCellValue || linkFieldRaw.isMultipleCellValue || false
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      throw new BadRequestException(`Parse rollUp Error: ${e.message}`);
    }

    const { cellValueType, isMultipleCellValue } = valueType;

    const showAs = options?.showAs;
    const formatting = options.formatting ?? getDefaultFormatting(cellValueType);
    let fulfilledOptions = formatting ? { ...field.options, formatting } : field.options;
    fulfilledOptions =
      showAs || cellValueType === CellValueType.Number
        ? { ...fulfilledOptions, showAs }
        : fulfilledOptions;

    return {
      ...field,
      name: field.name ?? `${lookupFieldRaw.name} Rollup (from ${linkFieldRaw.name})`,
      options: fulfilledOptions,
      lookupOptions,
      cellValueType,
      isComputed: true,
      isMultipleCellValue,
      dbFieldType: this.getDbFieldType(
        field.type,
        cellValueType as CellValueType,
        isMultipleCellValue
      ),
    };
  }

  private prepareSingleTextField(field: IFieldRo) {
    const { name, options } = field;

    return {
      ...field,
      name: name ?? 'Label',
      options: options ?? SingleLineTextFieldCore.defaultOptions(),
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Text,
    };
  }

  private prepareNumberField(field: IFieldRo) {
    const { name, options } = field;

    return {
      ...field,
      name: name ?? 'Number',
      options: options ?? NumberFieldCore.defaultOptions(),
      cellValueType: CellValueType.Number,
      dbFieldType: DbFieldType.Real,
    };
  }

  private prepareSingleSelectField(field: IFieldRo) {
    const { name, options } = field;

    return {
      ...field,
      name: name ?? 'Select',
      options: options ?? SelectFieldCore.defaultOptions(),
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Text,
    };
  }

  private prepareMultipleSelectField(field: IFieldRo) {
    const { name, options } = field;

    return {
      ...field,
      name: name ?? 'Tags',
      options: options ?? SelectFieldCore.defaultOptions(),
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Json,
      isMultipleCellValue: true,
    };
  }

  private prepareAttachmentField(field: IFieldRo) {
    const { name, options } = field;

    return {
      ...field,
      name: name ?? 'Attachments',
      options: options ?? AttachmentFieldCore.defaultOptions(),
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Json,
      isMultipleCellValue: true,
    };
  }

  private prepareDateField(field: IFieldRo) {
    const { name, options } = field;

    return {
      ...field,
      name: name ?? 'Date',
      options: options ?? DateFieldCore.defaultOptions(),
      cellValueType: CellValueType.DateTime,
      dbFieldType: DbFieldType.DateTime,
    };
  }

  private prepareCheckboxField(field: IFieldRo) {
    const { name, options } = field;

    return {
      ...field,
      name: name ?? 'Done',
      options: options ?? CheckboxFieldCore.defaultOptions(),
      cellValueType: CellValueType.Boolean,
      dbFieldType: DbFieldType.Integer,
    };
  }

  private async prepareField(fieldRo: IFieldRo, batchFieldVos?: IFieldVo[]) {
    if (fieldRo.isLookup) {
      return this.prepareLookupField(fieldRo, batchFieldVos);
    }

    switch (fieldRo.type) {
      case FieldType.Link: {
        return this.prepareLinkField(fieldRo);
      }
      case FieldType.Rollup:
        return this.prepareRollupField(fieldRo, batchFieldVos);
      case FieldType.Formula:
        return this.prepareFormulaField(fieldRo, batchFieldVos);
      case FieldType.SingleLineText:
        return this.prepareSingleTextField(fieldRo);
      case FieldType.Number:
        return this.prepareNumberField(fieldRo);
      case FieldType.SingleSelect:
        return this.prepareSingleSelectField(fieldRo);
      case FieldType.MultipleSelect:
        return this.prepareMultipleSelectField(fieldRo);
      case FieldType.Attachment:
        return this.prepareAttachmentField(fieldRo);
      case FieldType.Date:
        return this.prepareDateField(fieldRo);
      case FieldType.Checkbox:
        return this.prepareCheckboxField(fieldRo);
      default:
        throw new Error('invalid field type');
    }
  }

  /**
   * prepare properties for computed field to make sure it's valid
   * this method do not do any db update
   */
  async prepareCreateField(fieldRo: IFieldRo, batchFieldVos?: IFieldVo[]) {
    const field = await this.prepareField(fieldRo, batchFieldVos);

    const fieldId = field.id || generateFieldId();

    const dbFieldName = this.fieldService.generateDbFieldName([{ id: fieldId, name: field.name }]);

    return {
      ...field,
      id: fieldId,
      dbFieldName: dbFieldName[0],
    } as IFieldVo;
  }

  async prepareUpdateField(
    fieldRo: Omit<
      IFieldVo,
      | 'options'
      | 'cellValueType'
      | 'isMultipleCellValue'
      | 'dbFieldType'
      | 'lookupOptions'
      | 'columnMeta'
    >
  ) {
    return (await this.prepareField(fieldRo)) as IFieldVo;
  }

  async generateSymmetricField(
    prisma: Prisma.TransactionClient,
    tableId: string,
    field: LinkFieldDto
  ) {
    const { name: tableName } = await prisma.tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { name: true },
    });

    // lookup field id is the primary field of the table to which it is linked
    const { id: lookupFieldId } = await prisma.field.findFirstOrThrow({
      where: { tableId, isPrimary: true },
      select: { id: true },
    });

    const relationship = RelationshipRevert[field.options.relationship];
    const isMultipleCellValue = relationship !== Relationship.ManyOne;
    const [dbFieldName] = this.fieldService.generateDbFieldName([
      { id: field.options.symmetricFieldId, name: tableName },
    ]);
    return createFieldInstanceByVo({
      id: field.options.symmetricFieldId,
      name: tableName,
      dbFieldName,
      type: FieldType.Link,
      options: {
        relationship,
        foreignTableId: tableId,
        lookupFieldId,
        dbForeignKeyName: field.options.dbForeignKeyName,
        symmetricFieldId: field.id,
      },
      isMultipleCellValue,
      dbFieldType: DbFieldType.Json,
      cellValueType: CellValueType.String,
    } as IFieldVo) as LinkFieldDto;
  }

  private async columnExists(
    prisma: Prisma.TransactionClient,
    tableName: string,
    columnName: string
  ): Promise<boolean> {
    const result = await prisma.$queryRawUnsafe<{ name: string }[]>(
      `PRAGMA table_info(${tableName})`
    );
    return result.some((row) => row.name === columnName);
  }

  private async createForeignKeyField(
    prisma: Prisma.TransactionClient,
    tableId: string, // tableId for current field belongs to
    dbForeignKeyName: string
  ) {
    const dbTableName = await this.getDbTableName(prisma, tableId);
    if (await this.columnExists(prisma, dbTableName, dbForeignKeyName)) {
      return;
    }
    const alterTableQuery = this.knex.schema
      .alterTable(dbTableName, (table) => {
        table.string(dbForeignKeyName).unique().nullable();
      })
      .toQuery();
    await prisma.$executeRawUnsafe(alterTableQuery);
  }

  private async cleanForeignKeyField(
    prisma: Prisma.TransactionClient,
    tableId: string, // tableId for current field belongs to
    dbForeignKeyName: string
  ) {
    const dbTableName = await this.getDbTableName(prisma, tableId);
    // sqlite cannot drop column, so we just set it to null
    const nativeSql = this.knex(dbTableName)
      .update({ [dbForeignKeyName]: null })
      .toSQL()
      .toNative();

    await prisma.$executeRawUnsafe(nativeSql.sql, ...nativeSql.bindings);
  }

  async createForeignKey(prisma: Prisma.TransactionClient, tableId: string, field: LinkFieldDto) {
    if (field.type !== FieldType.Link) {
      throw new Error('only link field need to create supplement field');
    }

    const { foreignTableId, dbForeignKeyName, relationship } = field.options;

    if (relationship === Relationship.OneMany) {
      await this.createForeignKeyField(prisma, foreignTableId, dbForeignKeyName);
    }

    if (relationship === Relationship.ManyOne) {
      await this.createForeignKeyField(prisma, tableId, dbForeignKeyName);
    }
  }

  async cleanForeignKey(
    prisma: Prisma.TransactionClient,
    tableId: string,
    options: ILinkFieldOptions
  ) {
    const { foreignTableId, relationship, dbForeignKeyName } = options;

    if (relationship === Relationship.OneMany) {
      await this.cleanForeignKeyField(prisma, foreignTableId, dbForeignKeyName);
    }

    if (relationship === Relationship.ManyOne) {
      await this.cleanForeignKeyField(prisma, tableId, dbForeignKeyName);
    }
  }

  async createReference(prisma: Prisma.TransactionClient, field: IFieldInstance) {
    if (field.isLookup) {
      return await this.createLookupReference(prisma, field);
    }

    switch (field.type) {
      case FieldType.Formula:
        return await this.createFormulaReference(prisma, field);
      case FieldType.Rollup:
        // rollup use same reference logic as lookup
        return await this.createLookupReference(prisma, field);
      case FieldType.Link:
        return await this.createLinkReference(prisma, field);
      default:
        break;
    }
  }

  async deleteReference(prisma: Prisma.TransactionClient, fieldId: string): Promise<string[]> {
    const refRaw = await prisma.reference.findMany({
      where: {
        fromFieldId: fieldId,
      },
    });

    await prisma.reference.deleteMany({
      where: {
        OR: [{ toFieldId: fieldId }, { fromFieldId: fieldId }],
      },
    });

    return refRaw.map((ref) => ref.toFieldId);
  }

  /**
   * the lookup field that attach to the deleted, should delete to field reference
   */
  async deleteLookupFieldReference(
    prisma: Prisma.TransactionClient,
    linkFieldId: string
  ): Promise<string[]> {
    const fieldsRaw = await prisma.field.findMany({
      where: { lookupLinkedFieldId: linkFieldId, deletedTime: null },
      select: { id: true },
    });
    const lookupFieldIds = fieldsRaw.map((field) => field.id);

    // just need delete to field id, because lookup field still exist
    await prisma.reference.deleteMany({
      where: {
        OR: [{ toFieldId: { in: lookupFieldIds } }],
      },
    });
    return lookupFieldIds;
  }

  private async createLookupReference(prisma: Prisma.TransactionClient, field: IFieldInstance) {
    const toFieldId = field.id;
    if (!field.lookupOptions) {
      throw new Error('lookupOptions is required');
    }
    const { lookupFieldId } = field.lookupOptions;

    await prisma.reference.create({
      data: {
        fromFieldId: lookupFieldId,
        toFieldId,
      },
    });
  }

  private async createLinkReference(prisma: Prisma.TransactionClient, field: LinkFieldDto) {
    const toFieldId = field.id;
    const fromFieldId = field.options.lookupFieldId;

    await prisma.reference.create({
      data: {
        fromFieldId,
        toFieldId,
      },
    });
  }

  private async createFormulaReference(prisma: Prisma.TransactionClient, field: FormulaFieldDto) {
    const fieldIds = field.getReferenceFieldIds();
    const toFieldId = field.id;

    for (const fromFieldId of fieldIds) {
      await prisma.reference.create({
        data: {
          fromFieldId,
          toFieldId,
        },
      });
    }
  }
}
