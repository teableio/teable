import { Injectable } from '@nestjs/common';
import type { LinkFieldOptions } from '@teable-group/core';
import { FieldType, generateFieldId, Relationship, RelationshipRevert } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import knex from 'knex';
import { PrismaService } from '../../prisma.service';
import type { ISupplementService } from '../../share-db/interface';
import type { CreateFieldRo } from './model/create-field.ro';
import type { IFieldInstance } from './model/factory';
import { createFieldInstanceByRo } from './model/factory';
import type { FormulaFieldDto } from './model/field-dto/formula-field.dto';
import type { LinkFieldDto } from './model/field-dto/link-field.dto';

@Injectable()
export class FieldSupplementService implements ISupplementService {
  knex: ReturnType<typeof knex>;
  constructor(private readonly prismaService: PrismaService) {
    this.knex = knex({ client: 'sqlite3' });
  }

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

  async prepareFieldOptions(field: CreateFieldRo): Promise<CreateFieldRo & { id?: string }> {
    if (field.type !== FieldType.Link) {
      return field;
    }
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

  async generateSymmetricField(
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

  async createForeignKeyField(
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

    await this.createLinkReference(prisma, field);
    await this.createLinkReference(prisma, symmetricField);

    return symmetricField;
  }

  async createReference(prisma: Prisma.TransactionClient, fields: IFieldInstance[]) {
    for (const field of fields) {
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
