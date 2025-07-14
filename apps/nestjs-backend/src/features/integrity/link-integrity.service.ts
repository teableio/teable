import { Injectable, Logger } from '@nestjs/common';
import { FieldType, type ILinkFieldOptions } from '@teable/core';
import type { Field } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { IntegrityIssueType, type IIntegrityCheckVo, type IIntegrityIssue } from '@teable/openapi';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { createFieldInstanceByRaw } from '../field/model/factory';
import type { LinkFieldDto } from '../field/model/field-dto/link-field.dto';
import { ForeignKeyIntegrityService } from './foreign-key.service';
import { LinkFieldIntegrityService } from './link-field.service';
import { UniqueIndexService } from './unique-index.service';

@Injectable()
export class LinkIntegrityService {
  private readonly logger = new Logger(LinkIntegrityService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly foreignKeyIntegrityService: ForeignKeyIntegrityService,
    private readonly linkFieldIntegrityService: LinkFieldIntegrityService,
    private readonly uniqueIndexService: UniqueIndexService,
    @InjectDbProvider() private readonly dbProvider: IDbProvider
  ) {}

  async linkIntegrityCheck(baseId: string): Promise<IIntegrityCheckVo> {
    const mainBase = await this.prismaService.base.findFirstOrThrow({
      where: { id: baseId, deletedTime: null },
      select: { id: true, name: true },
    });

    const tables = await this.prismaService.tableMeta.findMany({
      where: { baseId, deletedTime: null },
      select: {
        id: true,
        name: true,
        dbTableName: true,
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
          baseId: mainBase.id,
          baseName: mainBase.name,
          issues: tableIssues,
        });
      }
      const uniqueIndexIssues = await this.uniqueIndexService.checkUniqueIndex(table);
      if (uniqueIndexIssues.length > 0) {
        linkFieldIssues.push({
          baseId: mainBase.id,
          baseName: mainBase.name,
          tableId: table.id,
          tableName: table.name,
          issues: uniqueIndexIssues,
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
          issues: tableIssues,
        });
      }
    }

    const referenceFieldIssues = await this.checkReferenceField(baseId);
    if (referenceFieldIssues.length > 0) {
      linkFieldIssues.push({
        baseId: mainBase.id,
        baseName: mainBase.name,
        issues: referenceFieldIssues,
      });
    }

    return {
      hasIssues: linkFieldIssues.length > 0,
      linkFieldIssues,
    };
  }

  private async checkReferenceField(baseId: string): Promise<IIntegrityIssue[]> {
    const tables = await this.prismaService.tableMeta.findMany({
      where: { baseId, deletedTime: null },
      select: {
        id: true,
        name: true,
        fields: {
          where: { deletedTime: null },
          select: { id: true },
        },
      },
    });

    const allFieldIds = tables.reduce<string[]>((acc, table) => {
      return [...acc, ...table.fields.map((f) => f.id)];
    }, []);

    const references = await this.prismaService.reference.findMany({
      where: {
        OR: [{ fromFieldId: { in: allFieldIds } }, { toFieldId: { in: allFieldIds } }],
      },
    });

    const fieldIds = new Set<string>();
    for (const reference of references) {
      fieldIds.add(reference.fromFieldId);
      fieldIds.add(reference.toFieldId);
    }

    const fields = await this.prismaService.field.findMany({
      where: { id: { in: Array.from(fieldIds) } },
      select: { id: true, name: true, deletedTime: true },
    });

    const deletedFields = fields.filter((f) => f.deletedTime);

    // exist in references but not in fields
    const cannotFindFields = Array.from(fieldIds).filter((id) => !fields.find((f) => f.id === id));

    const issues: IIntegrityIssue[] = [];
    for (const field of deletedFields) {
      issues.push({
        fieldId: field.id,
        type: IntegrityIssueType.ReferenceFieldNotFound,
        message: `Reference field ${field.name} is deleted`,
      });
    }

    for (const fieldId of cannotFindFields) {
      issues.push({
        fieldId,
        type: IntegrityIssueType.ReferenceFieldNotFound,
        message: `Reference field ${fieldId} not found`,
      });
    }

    return issues;
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
          fieldId: field.id,
          type: IntegrityIssueType.ForeignTableNotFound,
          message: `Foreign table with ID ${options.foreignTableId} not found for link field (Field Name: ${field.name}, Field ID: ${field.id}) in table ${table.name}`,
        });
      }

      const tableExistsSql = this.dbProvider.checkTableExist(options.fkHostTableName);
      const tableExists =
        await this.prismaService.$queryRawUnsafe<{ exists: boolean }[]>(tableExistsSql);

      if (!tableExists[0].exists) {
        issues.push({
          fieldId: field.id,
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
            fieldId: field.id,
            type: IntegrityIssueType.ForeignKeyNotFound,
            message: `Self key name "${options.selfKeyName}" is missing for link field (Field Name: ${field.name}, Field ID: ${field.id}) in table ${table.name}`,
          });
        }

        if (!foreignKeyExists) {
          issues.push({
            fieldId: field.id,
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
            fieldId: field.id,
            type: IntegrityIssueType.SymmetricFieldNotFound,
            message: `Symmetric field ID ${options.symmetricFieldId} not found for link field (Field Name: ${field.name}, Field ID: ${field.id}) in table ${table.name}`,
          });
        }
      }

      if (!options.isOneWay && !options.symmetricFieldId) {
        issues.push({
          fieldId: field.id,
          type: IntegrityIssueType.SymmetricFieldNotFound,
          message: `Symmetric is missing for link field (Field Name: ${field.name}, Field ID: ${field.id}) in table ${table.name}`,
        });
      }

      if (foreignTable) {
        const linkField = createFieldInstanceByRaw(field) as LinkFieldDto;
        const invalidReferences = await this.foreignKeyIntegrityService.getIssues(
          table.id,
          linkField
        );
        const invalidLinks = await this.linkFieldIntegrityService.getIssues(table.id, linkField);

        if (invalidReferences.length > 0) {
          issues.push(...invalidReferences);
        }
        if (invalidLinks.length > 0) {
          issues.push(...invalidLinks);
        }
      }
    }

    return issues;
  }

  async linkIntegrityFix(baseId: string): Promise<IIntegrityIssue[]> {
    const checkResult = await this.linkIntegrityCheck(baseId);
    const fixResults: IIntegrityIssue[] = [];
    for (const issues of checkResult.linkFieldIssues) {
      for (const issue of issues.issues) {
        switch (issue.type) {
          case IntegrityIssueType.MissingRecordReference: {
            const result = await this.foreignKeyIntegrityService.fix(issue.fieldId);
            result && fixResults.push(result);
            break;
          }
          case IntegrityIssueType.InvalidLinkReference: {
            const result = await this.linkFieldIntegrityService.fix(issue.fieldId);
            result && fixResults.push(result);
            break;
          }
          case IntegrityIssueType.SymmetricFieldNotFound: {
            const result = await this.fixOneWayLinkField(issue.fieldId);
            result && fixResults.push(result);
            break;
          }
          case IntegrityIssueType.ReferenceFieldNotFound: {
            const result = await this.fixReferenceField(issue.fieldId);
            result && fixResults.push(result);
            break;
          }
          case IntegrityIssueType.UniqueIndexNotFound: {
            const result = await this.uniqueIndexService.fixUniqueIndex(
              issues.tableId,
              issue.fieldId
            );
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

  async fixReferenceField(fieldId: string): Promise<IIntegrityIssue | undefined> {
    const deleted = await this.prismaService.reference.deleteMany({
      where: {
        OR: [{ fromFieldId: fieldId }, { toFieldId: fieldId }],
      },
    });

    if (deleted.count <= 0) {
      return;
    }

    return {
      type: IntegrityIssueType.InvalidLinkReference,
      fieldId,
      message: 'InvalidLinkReference fixed',
    };
  }

  async fixOneWayLinkField(fieldId: string): Promise<IIntegrityIssue | undefined> {
    const field = await this.prismaService.field.findFirstOrThrow({
      where: { id: fieldId, deletedTime: null },
    });

    const options = JSON.parse(field.options as string) as ILinkFieldOptions;

    if (!options.isOneWay && !options.symmetricFieldId) {
      await this.prismaService.field.update({
        where: { id: fieldId },
        data: {
          options: JSON.stringify({
            ...options,
            isOneWay: true,
          }),
        },
      });
    }

    if (options.isOneWay && options.symmetricFieldId) {
      await this.prismaService.field.update({
        where: { id: fieldId },
        data: {
          options: JSON.stringify({
            ...options,
            isOneWay: undefined,
          }),
        },
      });
    }

    return {
      type: IntegrityIssueType.SymmetricFieldNotFound,
      fieldId: field.id,
      message: `fixed one way link field (Field Name: ${field.name}, Field ID: ${field.id})`,
    };
  }
}
