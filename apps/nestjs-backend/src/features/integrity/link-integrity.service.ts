import { Injectable, Logger } from '@nestjs/common';
import { FieldType, type ILinkFieldOptions } from '@teable/core';
import type { Field } from '@teable/db-main-prisma';
import { Prisma, PrismaService } from '@teable/db-main-prisma';
import { IntegrityIssueType, type IIntegrityCheckVo, type IIntegrityIssue } from '@teable/openapi';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';

@Injectable()
export class LinkIntegrityService {
  private readonly logger = new Logger(LinkIntegrityService.name);

  constructor(
    private readonly prismaService: PrismaService,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  async linkIntegrityCheck(baseId: string): Promise<IIntegrityCheckVo> {
    const tables = await this.prismaService.tableMeta.findMany({
      where: { baseId, deletedTime: null },
      select: {
        id: true,
        name: true,
        fields: {
          where: { type: FieldType.Link, isLookup: null, deletedTime: null },
        },
      },
    });

    const crossBaseLinkFieldsQuery = this.dbProvider.optionsQuery(FieldType.Link, 'baseId', baseId);
    const crossBaseLinkFieldsRaw =
      await this.prismaService.$queryRawUnsafe<Field[]>(crossBaseLinkFieldsQuery);

    const crossBaseLinkFields = crossBaseLinkFieldsRaw.filter(
      (field) => !tables.find((table) => table.id === field.tableId)
    );

    const linkFieldIssues: IIntegrityCheckVo['linkFieldIssues'] = [];

    for (const table of tables) {
      const tableIssues = await this.checkTableLinkFields(table);
      if (tableIssues.length > 0) {
        linkFieldIssues.push({
          tableId: table.id,
          tableName: table.name,
          fieldName: table.fields[0].name,
          fieldId: table.fields[0].id,
          issues: tableIssues,
        });
      }
    }

    for (const field of crossBaseLinkFields) {
      const table = await this.prismaService.tableMeta.findFirst({
        where: {
          id: field.tableId,
          deletedTime: null,
          base: { deletedTime: null, space: { deletedTime: null } },
        },
        select: { id: true, name: true, baseId: true },
      });

      if (!table) {
        continue;
      }

      const tableIssues = await this.checkTableLinkFields({
        id: table.id,
        name: table.name,
        fields: [field],
      });

      const base = await this.prismaService.base.findFirstOrThrow({
        where: { id: table.baseId, deletedTime: null },
        select: { id: true, name: true },
      });

      if (tableIssues.length > 0) {
        linkFieldIssues.push({
          baseId: base.id,
          baseName: base.name,
          tableId: field.tableId,
          tableName: table.name,
          fieldId: field.id,
          fieldName: field.name,
          issues: tableIssues,
        });
      }
    }

    return {
      hasIssues: linkFieldIssues.length > 0,
      linkFieldIssues,
    };
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async checkTableLinkFields(table: {
    id: string;
    name: string;
    fields: Field[];
  }): Promise<IIntegrityIssue[]> {
    const issues: IIntegrityIssue[] = [];

    for (const field of table.fields) {
      const options = JSON.parse(field.options as string) as ILinkFieldOptions;

      const foreignTable = await this.prismaService.tableMeta.findFirst({
        where: { id: options.foreignTableId, deletedTime: null },
        select: { id: true, baseId: true, dbTableName: true },
      });

      if (!foreignTable) {
        issues.push({
          type: IntegrityIssueType.ForeignTableNotFound,
          message: `Foreign table with ID ${options.foreignTableId} not found for link field (Field Name: ${field.name}, Field ID: ${field.id}) in table ${table.name}`,
        });
      }

      const tableExistsSql = this.dbProvider.checkTableExist(options.fkHostTableName);
      const tableExists =
        await this.prismaService.$queryRawUnsafe<{ exists: boolean }[]>(tableExistsSql);

      if (!tableExists[0].exists) {
        issues.push({
          type: IntegrityIssueType.ForeignKeyHostTableNotFound,
          message: `Foreign key host table ${options.fkHostTableName} not found for link field (Field Name: ${field.name}, Field ID: ${field.id}) in table ${table.name}`,
        });
      } else {
        const selfKeyExists = await this.dbProvider.checkColumnExist(
          options.fkHostTableName,
          options.selfKeyName,
          this.prismaService
        );

        const foreignKeyExists = await this.dbProvider.checkColumnExist(
          options.fkHostTableName,
          options.foreignKeyName,
          this.prismaService
        );

        if (!selfKeyExists) {
          issues.push({
            type: IntegrityIssueType.ForeignKeyNotFound,
            message: `Self key name "${options.selfKeyName}" is missing for link field (Field Name: ${field.name}, Field ID: ${field.id}) in table ${table.name}`,
          });
        }

        if (!foreignKeyExists) {
          issues.push({
            type: IntegrityIssueType.ForeignKeyNotFound,
            message: `Foreign key name "${options.foreignKeyName}" is missing for link field (Field Name: ${field.name}, Field ID: ${field.id}) in table ${table.name}`,
          });
        }
      }

      if (options.symmetricFieldId) {
        const symmetricField = await this.prismaService.field.findFirst({
          where: { id: options.symmetricFieldId, deletedTime: null },
        });

        if (!symmetricField) {
          issues.push({
            type: IntegrityIssueType.SymmetricFieldNotFound,
            message: `Symmetric field ID ${options.symmetricFieldId} not found for link field (Field Name: ${field.name}, Field ID: ${field.id}) in table ${table.name}`,
          });
        }
      }

      if (foreignTable) {
        const invalidReferences = await this.checkInvalidRecordReferences(table.id, field, options);

        if (invalidReferences.length > 0) {
          issues.push(...invalidReferences);
        }
      }
    }

    return issues;
  }

  private async checkInvalidRecordReferences(
    tableId: string,
    field: { id: string; name: string },
    options: ILinkFieldOptions
  ): Promise<IIntegrityIssue[]> {
    const { foreignTableId, fkHostTableName, foreignKeyName, selfKeyName } = options;

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

    const issues: IIntegrityIssue[] = [];

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
          type: IntegrityIssueType.InvalidRecordReference,
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

  async linkIntegrityFix(baseId: string): Promise<IIntegrityIssue[]> {
    const checkResult = await this.linkIntegrityCheck(baseId);
    const fixResults: IIntegrityIssue[] = [];

    for (const issues of checkResult.linkFieldIssues) {
      for (const issue of issues.issues) {
        // eslint-disable-next-line sonarjs/no-small-switch
        switch (issue.type) {
          case IntegrityIssueType.InvalidRecordReference: {
            const result = await this.fixInvalidRecordReferences(issues.tableId, issues.fieldId);
            result && fixResults.push(result);
            break;
          }
          default:
            break;
        }
      }
    }

    return fixResults;
  }

  async fixInvalidRecordReferences(
    tableId: string,
    fieldId: string
  ): Promise<IIntegrityIssue | undefined> {
    const field = await this.prismaService.field.findFirstOrThrow({
      where: { id: fieldId, type: FieldType.Link, isLookup: null, deletedTime: null },
    });

    const options = JSON.parse(field.options as string) as ILinkFieldOptions;
    const { foreignTableId, fkHostTableName, foreignKeyName, selfKeyName } = options;

    const { dbTableName: selfTableDbTableName } =
      await this.prismaService.tableMeta.findFirstOrThrow({
        where: { id: tableId, deletedTime: null },
        select: { dbTableName: true },
      });

    const { dbTableName: foreignTableDbTableName } =
      await this.prismaService.tableMeta.findFirstOrThrow({
        where: { id: foreignTableId, deletedTime: null },
        select: { dbTableName: true },
      });

    let totalDeleted = 0;

    // Fix invalid self references
    if (selfTableDbTableName !== fkHostTableName) {
      const selfDeleted = await this.deleteInvalidReferences({
        fkHostTableName,
        targetTableName: selfTableDbTableName,
        keyName: selfKeyName,
      });
      totalDeleted += selfDeleted;
    }

    // Fix invalid foreign references
    if (foreignTableDbTableName !== fkHostTableName) {
      const foreignDeleted = await this.deleteInvalidReferences({
        fkHostTableName,
        targetTableName: foreignTableDbTableName,
        keyName: foreignKeyName,
      });
      totalDeleted += foreignDeleted;
    }

    if (totalDeleted > 0) {
      return {
        type: IntegrityIssueType.InvalidRecordReference,
        message: `Fixed ${totalDeleted} invalid references for link field (Field Name: ${field.name}, Field ID: ${field.id})`,
      };
    }
  }

  private async deleteInvalidReferences({
    fkHostTableName,
    targetTableName,
    keyName,
  }: {
    fkHostTableName: string;
    targetTableName: string;
    keyName: string;
  }) {
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
