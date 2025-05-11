import { Injectable, Logger } from '@nestjs/common';
import { FieldType, type ILinkFieldOptions } from '@teable/core';
import { Prisma, PrismaService } from '@teable/db-main-prisma';
import { IntegrityIssueType, type IIntegrityIssue } from '@teable/openapi';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import type { LinkFieldDto } from '../field/model/field-dto/link-field.dto';

@Injectable()
export class ForeignKeyIntegrityService {
  private readonly logger = new Logger(ForeignKeyIntegrityService.name);

  constructor(
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  async getIssues(tableId: string, field: LinkFieldDto): Promise<IIntegrityIssue[]> {
    const { foreignTableId, fkHostTableName, foreignKeyName, selfKeyName } = field.options;
    const issues: IIntegrityIssue[] = [];

    const { name: selfTableName, dbTableName: selfTableDbTableName } =
      await this.prismaService.tableMeta.findFirstOrThrow({
        where: { id: tableId, deletedTime: null },
        select: { name: true, dbTableName: true },
      });

    const { name: foreignTableName, dbTableName: foreignTableDbTableName } =
      await this.prismaService.tableMeta.findFirstOrThrow({
        where: { id: foreignTableId, deletedTime: null },
        select: { name: true, dbTableName: true },
      });

    // Check self references
    if (selfTableDbTableName !== fkHostTableName) {
      const selfIssues = await this.checkInvalidReferences({
        fkHostTableName,
        targetTableName: selfTableDbTableName,
        keyName: selfKeyName,
        field,
        referencedTableName: selfTableName,
        isSelfReference: true,
      });
      issues.push(...selfIssues);
    }

    // Check foreign references
    if (foreignTableDbTableName !== fkHostTableName) {
      const foreignIssues = await this.checkInvalidReferences({
        fkHostTableName,
        targetTableName: foreignTableDbTableName,
        keyName: foreignKeyName,
        field,
        referencedTableName: foreignTableName,
        isSelfReference: false,
      });
      issues.push(...foreignIssues);
    }

    return issues;
  }

  private async checkInvalidReferences({
    fkHostTableName,
    targetTableName,
    keyName,
    field,
    referencedTableName,
    isSelfReference,
  }: {
    fkHostTableName: string;
    targetTableName: string;
    keyName: string;
    field: { id: string; name: string };
    referencedTableName: string;
    isSelfReference: boolean;
  }): Promise<IIntegrityIssue[]> {
    const issues: IIntegrityIssue[] = [];

    const invalidQuery = this.knex(fkHostTableName)
      .leftJoin(targetTableName, `${fkHostTableName}.${keyName}`, `${targetTableName}.__id`)
      .whereNull(`${targetTableName}.__id`)
      .count(`${fkHostTableName}.${keyName} as count`)
      .first()
      .toQuery();

    try {
      const invalidRefs =
        await this.prismaService.$queryRawUnsafe<{ count: bigint }[]>(invalidQuery);
      const refCount = Number(invalidRefs[0]?.count || 0);

      if (refCount > 0) {
        const message = isSelfReference
          ? `Found ${refCount} invalid self references in table ${referencedTableName}`
          : `Found ${refCount} invalid foreign references to table ${referencedTableName}`;
        issues.push({
          type: IntegrityIssueType.MissingRecordReference,
          fieldId: field.id,
          message: `${message} (Field Name: ${field.name}, Field ID: ${field.id})`,
        });
      }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2010') {
        console.error('error ignored:', error);
      } else {
        throw error;
      }
    }

    return issues;
  }

  async fix(fieldId: string): Promise<IIntegrityIssue | undefined> {
    const field = await this.prismaService.field.findFirstOrThrow({
      where: { id: fieldId, type: FieldType.Link, isLookup: null, deletedTime: null },
    });

    const tableId = field.tableId;

    const options = JSON.parse(field.options as string) as ILinkFieldOptions;
    const { foreignTableId, fkHostTableName, foreignKeyName, selfKeyName } = options;
    const table = await this.prismaService.tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { id: true, name: true, dbTableName: true },
    });
    const foreignTable = await this.prismaService.tableMeta.findFirstOrThrow({
      where: { id: foreignTableId, deletedTime: null },
      select: { id: true, name: true, dbTableName: true },
    });

    let totalFixed = 0;

    // Fix invalid self references
    if (table.dbTableName !== fkHostTableName) {
      const selfDeleted = await this.deleteMissingReferences({
        fkHostTableName,
        targetTableName: table.dbTableName,
        keyName: selfKeyName,
      });
      totalFixed += selfDeleted;
    }

    // Fix invalid foreign references
    if (foreignTable.dbTableName !== fkHostTableName) {
      const foreignDeleted = await this.deleteMissingReferences({
        fkHostTableName,
        targetTableName: foreignTable.dbTableName,
        keyName: foreignKeyName,
      });
      totalFixed += foreignDeleted;
    }

    if (totalFixed > 0) {
      return {
        type: IntegrityIssueType.MissingRecordReference,
        fieldId,
        message: `Fixed ${totalFixed} invalid references and inconsistent links for link field (Field Name: ${field.name}, Field ID: ${field.id})`,
      };
    }
  }

  private async deleteMissingReferences({
    fkHostTableName,
    targetTableName,
    keyName,
  }: {
    fkHostTableName: string;
    targetTableName: string;
    keyName: string;
  }) {
    if (!fkHostTableName.split('.')[1].startsWith('junction_')) {
      throw new Error(`fkHostTableName: ${fkHostTableName} is not a junction table`);
    }

    const deleteQuery = this.knex(fkHostTableName)
      .whereNotExists(
        this.knex
          .select('__id')
          .from(targetTableName)
          .where('__id', this.knex.ref(`${fkHostTableName}.${keyName}`))
      )
      .delete()
      .toQuery();
    return await this.prismaService.$executeRawUnsafe(deleteQuery);
  }
}
