import { HttpException, Injectable } from '@nestjs/common';
import type { LinkFieldOptions } from '@teable-group/core';
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

  private async prepareLinkFieldOptions(field: LinkFieldDto) {
    const { relationship, foreignTableId } = field.options as LinkFieldDto['options'];
    const { id: lookupFieldId } = await this.prismaService.field.findFirstOrThrow({
      where: { tableId: foreignTableId, isPrimary: true },
      select: { id: true },
    });
    const fieldId = generateFieldId();
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
      } as LinkFieldOptions,
    };
  }

  private async prepareLookupField(field: CreateFieldRo) {
    const { lookupOptions } = field;
    if (!lookupOptions) {
      throw new HttpException('lookupOptions is required', HttpStatusCode.BadRequest);
    }

    let optionsRaw: string;
    try {
      const linkFieldId = lookupOptions.linkFieldId;
      const { options } = await this.prismaService.field.findFirstOrThrow({
        where: { id: linkFieldId, deletedTime: null, type: FieldType.Link },
        select: { options: true },
      });
      optionsRaw = options as string;
    } catch (e) {
      throw new HttpException('linkFieldId is invalid', HttpStatusCode.BadRequest);
    }
    const options = JSON.parse(optionsRaw as string) as LinkFieldOptions;

    return {
      ...field,
      options: {
        ...field.options,
        relationship: options.relationship,
      },
    };
  }

  private async prepareFormulaField(field: FormulaFieldDto) {
    const fieldIds = FormulaFieldDto.getReferenceFieldIds(field.options.expression);

    const fieldRaws = await this.prismaService.field.findMany({
      where: { id: { in: fieldIds }, deletedTime: null },
    });

    const fields = fieldRaws.map((fieldRaw) => createFieldInstanceByRaw(fieldRaw));
    const fieldMap = keyBy(fields, 'id');
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

  async prepareField(field: CreateFieldRo): Promise<CreateFieldRo & { id?: string }> {
    if (field.isLookup) {
      field = await this.prepareLookupField(field);
    }

    if (field.type == FieldType.Link) {
      return await this.prepareLinkFieldOptions(field as LinkFieldDto);
    }

    if (field.type == FieldType.Formula) {
      return await this.prepareFormulaField(field as FormulaFieldDto);
    }

    return field;
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
    switch (field.type) {
      case FieldType.Formula:
        await this.createFormulaReference(prisma, field);
        break;
      case FieldType.Link:
        await this.createLinkReference(prisma, field);
        break;
      default:
        break;
    }
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
