import { HttpException, Injectable } from '@nestjs/common';
import type { ILinkFieldOptions, ILookupOptionsVo } from '@teable-group/core';
import { FieldType, generateFieldId, Relationship, RelationshipRevert } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import { HttpStatusCode } from 'axios';
import knex from 'knex';
import { keyBy } from 'lodash';
import { PrismaService } from '../../prisma.service';
import type { ISupplementService } from '../../share-db/interface';
import type { CreateFieldRo } from './model/create-field.ro';
import type { IFieldInstance } from './model/factory';
import { createFieldInstanceByRaw, createFieldInstanceByRo } from './model/factory';
import { FormulaFieldDto } from './model/field-dto/formula-field.dto';
import type { LinkFieldDto } from './model/field-dto/link-field.dto';

@Injectable()
export class FieldSupplementService implements ISupplementService {
  private readonly knex = knex({ client: 'sqlite3' });
  constructor(private readonly prismaService: PrismaService) {}

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

  private async prepareLinkField(field: CreateFieldRo): Promise<CreateFieldRo> {
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
    return {
      ...field,
      id: fieldId,
      options: {
        relationship,
        foreignTableId,
        lookupFieldId,
        dbForeignKeyName,
        symmetricFieldId,
      },
    };
  }

  private async prepareLookupField(
    field: CreateFieldRo,
    batchFieldRos?: CreateFieldRo[]
  ): Promise<CreateFieldRo> {
    const { lookupOptions } = field;
    if (!lookupOptions) {
      throw new HttpException('lookupOptions is required', HttpStatusCode.BadRequest);
    }

    const linkFieldId = lookupOptions.linkFieldId;
    const fieldRaw = await this.prismaService.field.findFirst({
      where: { id: linkFieldId, deletedTime: null, type: FieldType.Link },
      select: { options: true },
    });
    const optionsRaw = fieldRaw?.options || null;
    const linkFieldOptions: ILinkFieldOptions =
      (optionsRaw && JSON.parse(optionsRaw as string)) ||
      batchFieldRos?.find((field) => field.id === linkFieldId);

    if (!linkFieldOptions) {
      throw new HttpException('linkFieldId is invalid', HttpStatusCode.BadRequest);
    }

    return {
      ...field,
      lookupOptions: {
        ...lookupOptions,
        relationship: linkFieldOptions.relationship,
        dbForeignKeyName: linkFieldOptions.dbForeignKeyName,
        symmetricFieldId: linkFieldOptions.symmetricFieldId,
      } as ILookupOptionsVo,
    };
  }

  private async prepareFormulaField(field: CreateFieldRo, batchFieldRos?: CreateFieldRo[]) {
    const fieldIds = FormulaFieldDto.getReferenceFieldIds(field.options.expression);
    const fieldRaws = await this.prismaService.field.findMany({
      where: { id: { in: fieldIds } },
    });

    const fields = fieldRaws.map((fieldRaw) => createFieldInstanceByRaw(fieldRaw));
    const batchFields = batchFieldRos?.map((fieldRo) => createFieldInstanceByRo(fieldRo));
    const fieldMap = keyBy(fields.concat(batchFields || []), 'id');

    if (Object.keys(fieldMap).length !== fieldIds.length) {
      throw new HttpException('formula field reference field not found', HttpStatusCode.BadRequest);
    }

    const { cellValueType, isMultipleCellValue } = FormulaFieldDto.getParsedValueType(
      field.options.expression,
      fieldMap
    );

    return {
      ...field,
      cellValueType,
      isMultipleCellValue,
    };
  }

  async prepareField(
    fieldRo: CreateFieldRo,
    batchFieldRos?: CreateFieldRo[]
  ): Promise<CreateFieldRo> {
    if (fieldRo.isLookup) {
      fieldRo = await this.prepareLookupField(fieldRo, batchFieldRos);
    }

    if (fieldRo.type == FieldType.Link) {
      return await this.prepareLinkField(fieldRo);
    }

    if (fieldRo.type == FieldType.Formula) {
      return await this.prepareFormulaField(fieldRo, batchFieldRos);
    }

    return fieldRo;
  }

  private async generateSymmetricField(
    prisma: Prisma.TransactionClient,
    tableId: string,
    foreignTableId: string,
    field: LinkFieldDto
  ) {
    const { name: tableName } = await prisma.tableMeta.findUniqueOrThrow({
      where: { id: foreignTableId },
      select: { name: true },
    });

    // lookup field id is the primary field of the table to which it is linked
    // console.log('tableId:', tableId);
    const { id: lookupFieldId } = await prisma.field.findFirstOrThrow({
      where: { tableId, isPrimary: true },
      select: { id: true },
    });

    const relationship = RelationshipRevert[field.options.relationship];
    return createFieldInstanceByRo({
      id: field.options.symmetricFieldId,
      name: tableName,
      type: FieldType.Link,
      options: {
        relationship,
        foreignTableId: tableId,
        lookupFieldId,
        dbForeignKeyName: field.options.dbForeignKeyName,
        symmetricFieldId: field.id,
      },
    }) as LinkFieldDto;
  }

  private async createForeignKeyField(
    prisma: Prisma.TransactionClient,
    tableId: string, // tableId for current field belongs to
    field: LinkFieldDto
  ) {
    if (field.options.relationship !== Relationship.ManyOne) {
      throw new Error('only many-one relationship should create foreign key field');
    }

    const dbTableName = await this.getDbTableName(prisma, tableId);
    const alterTableQuery = this.knex.schema
      .alterTable(dbTableName, (table) => {
        table.string(field.options.dbForeignKeyName).unique().nullable();
      })
      .toQuery();
    await prisma.$executeRawUnsafe(alterTableQuery);
  }

  async supplementByCreate(prisma: Prisma.TransactionClient, tableId: string, field: LinkFieldDto) {
    if (field.type !== FieldType.Link) {
      throw new Error('only link field need to create supplement field');
    }

    const foreignTableId = field.options.foreignTableId;
    const symmetricField = await this.generateSymmetricField(
      prisma,
      tableId,
      foreignTableId,
      field
    );

    if (symmetricField.options.relationship === Relationship.ManyOne) {
      await this.createForeignKeyField(prisma, foreignTableId, symmetricField);
    }

    if (field.options.relationship === Relationship.ManyOne) {
      await this.createForeignKeyField(prisma, tableId, field);
    }

    return symmetricField;
  }

  async createReference(prisma: Prisma.TransactionClient, field: IFieldInstance) {
    if (field.isLookup) {
      return await this.createLookupReference(prisma, field);
    }

    switch (field.type) {
      case FieldType.Formula:
        return await this.createFormulaReference(prisma, field);
      case FieldType.Link:
        return await this.createLinkReference(prisma, field);
      default:
        break;
    }
  }

  private async createLookupReference(prisma: Prisma.TransactionClient, field: IFieldInstance) {
    const toFieldId = field.id;
    if (!field.lookupOptions) {
      throw new Error('lookupOptions is required');
    }
    const { lookupFieldId, symmetricFieldId } = field.lookupOptions;

    await prisma.reference.create({
      data: {
        fromFieldId: lookupFieldId,
        toFieldId,
      },
    });

    await prisma.reference.create({
      data: {
        fromFieldId: symmetricFieldId,
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
