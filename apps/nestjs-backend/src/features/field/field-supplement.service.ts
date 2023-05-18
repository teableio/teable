import { Injectable } from '@nestjs/common';
import { FieldType, generateFieldId, Relationship, RelationshipRevert } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import knex from 'knex';
import type { ISupplementService } from '../../share-db/interface';
import type { IFieldInstance } from './model/factory';
import { createFieldInstanceByRo } from './model/factory';
import type { FormulaFieldDto } from './model/field-dto/formula-field.dto';
import type { LinkFieldDto } from './model/field-dto/link-field.dto';

@Injectable()
export class FieldSupplementService implements ISupplementService {
  knex: ReturnType<typeof knex>;
  constructor() {
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
    const fieldId = generateFieldId();
    return createFieldInstanceByRo({
      id: fieldId,
      name: tableName,
      type: FieldType.Link,
      options: {
        relationship,
        foreignTableId: foreignTableId,
        lookupFieldId,
        dbForeignKeyName:
          // only OneMany relationShip should generate new foreign key field
          relationship === Relationship.OneMany
            ? this.getForeignKeyFieldName(fieldId)
            : field.options.dbForeignKeyName,
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

    for (const fromFieldId in fieldIds) {
      await prisma.reference.create({
        data: {
          fromFieldId,
          toFieldId,
        },
      });
    }
  }
}
